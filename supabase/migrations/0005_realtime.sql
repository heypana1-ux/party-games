-- ============================================================================
--  Realtime
--
--  Two transports, and keeping them apart is what makes the system safe:
--
--    Postgres Changes  — authoritative. Fans out the session snapshot and the
--                        lobby. Subscribers see only what the table's RLS lets
--                        them see, so an outsider gets an empty stream.
--    Broadcast/Presence— ephemeral. Who is online, reactions, "host is
--                        choosing". A forged broadcast can annoy a room; it can
--                        never change the score, because nothing in the game
--                        state is derived from it.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- The snapshot ships in full on every change, which is why a client that
    -- missed a message is still correct after the next one.
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_sessions'
    ) then
      alter publication supabase_realtime add table public.game_sessions;
    end if;

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms'
    ) then
      alter publication supabase_realtime add table public.rooms;
    end if;

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_members'
    ) then
      alter publication supabase_realtime add table public.room_members;
    end if;
  else
    raise notice 'publication supabase_realtime not found — skipping (not a Supabase database?)';
  end if;
end;
$$;

-- Private channels. Without this every signed-in user could subscribe to
-- `room:<uuid>` and read presence and broadcast traffic for a room they were
-- never in. Channel names carry the room UUID, never the joinable code.
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'realtime' and table_name = 'messages') then

    execute 'drop policy if exists "room members read channel" on realtime.messages';
    execute $p$
      create policy "room members read channel" on realtime.messages
        for select to authenticated
        using (
          realtime.topic() like 'room:%'
          and public.is_room_member(
                substring(realtime.topic() from 6)::uuid
              )
        )
    $p$;

    execute 'drop policy if exists "room members write channel" on realtime.messages';
    execute $p$
      create policy "room members write channel" on realtime.messages
        for insert to authenticated
        with check (
          realtime.topic() like 'room:%'
          and public.is_room_member(
                substring(realtime.topic() from 6)::uuid
              )
        )
    $p$;
  else
    raise notice 'realtime.messages not found — skipping private channel policies.';
  end if;
end;
$$;
