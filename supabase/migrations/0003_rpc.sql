-- ============================================================================
--  RPCs — the only way anything in this schema changes.
--
--  Two tiers, and the split is the core security property of the platform:
--
--    authenticated  — functions that take only parameters the database itself
--                     can validate (a code, a name, a room id).
--    service_role   — functions that accept a game STATE. If a phone could call
--                     these, it could hand in any state it liked and the whole
--                     server-authority design would be decoration.
-- ============================================================================

-- Failed join attempts, kept only long enough to rate-limit code guessing.
-- Reaped by 0004.
create table if not exists public.join_attempts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  ok           boolean not null,
  attempted_at timestamptz not null default now()
);
create index if not exists join_attempts_idx
  on public.join_attempts (user_id, attempted_at desc);
alter table public.join_attempts enable row level security;
-- No policy at all: nobody reads this but security-definer functions.

-- ---------------------------------------------------------- room codes -----
-- 31 characters, chosen by removing every pair a person could misread aloud or
-- mistype from a screen: no I/1/L, no O/0. 31^6 ≈ 887 million.
--
-- Uniform, not merely random: a byte mod 32 is exactly uniform over 0..31
-- because 32 divides 256, and rejecting the one leftover value (31) leaves a
-- bias-free draw over the 31 characters. Using random() here would be faster
-- and predictable — the wrong trade for something that guards a private room.
create or replace function public.gen_room_code(p_len int default 6)
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  out_code text := '';
  v int;
begin
  while char_length(out_code) < p_len loop
    v := get_byte(extensions.gen_random_bytes(1), 0) % 32;
    if v < 31 then
      out_code := out_code || substr(alphabet, v + 1, 1);
    end if;
  end loop;
  return out_code;
end;
$$;

-- ------------------------------------------------------- create a room -----
create or replace function public.create_room(
  p_display_name text,
  p_settings jsonb default '{}'::jsonb
)
returns table (room_id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_code text;
  v_room uuid;
  v_try  int := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if char_length(btrim(p_display_name)) not between 2 and 24 then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;

  -- Retry rather than pre-check: another transaction can take the code between
  -- a SELECT and an INSERT, so the unique index is the real arbiter.
  loop
    v_try := v_try + 1;
    v_code := public.gen_room_code(6);
    begin
      insert into rooms (code, host_id, created_by, settings)
      values (v_code, v_uid, v_uid, coalesce(p_settings, '{}'::jsonb))
      returning id into v_room;
      exit;
    exception when unique_violation then
      if v_try >= 8 then
        raise exception 'code_space_exhausted' using errcode = '53400';
      end if;
    end;
  end loop;

  insert into room_members (room_id, user_id, display_name)
  values (v_room, v_uid, btrim(p_display_name));

  return query select v_room, v_code;
end;
$$;

-- --------------------------------------------------------- join a room -----
-- Returns a status string rather than raising, because "wrong code" is normal
-- user behaviour, not an exception. Note that wrong, closed and full rooms all
-- answer 'invalid_code' — anything else is an oracle that tells a guesser when
-- they have found a real room.
create or replace function public.join_room(
  p_code text,
  p_display_name text
)
returns table (result text, room_id uuid, room_status text, is_spectator boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_room     rooms%rowtype;
  v_fails    int;
  v_count    int;
  v_max      int;
  v_existing room_members%rowtype;
  v_spec     boolean := false;
  v_name     text := btrim(p_display_name);
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if char_length(v_name) not between 2 and 24 then
    return query select 'invalid_name'::text, null::uuid, null::text, null::boolean;
    return;
  end if;

  select count(*) into v_fails
    from join_attempts
   where user_id = v_uid and not ok and attempted_at > now() - interval '5 minutes';
  if v_fails >= 10 then
    return query select 'rate_limited'::text, null::uuid, null::text, null::boolean;
    return;
  end if;

  select * into v_room from rooms
   where code = upper(btrim(p_code)) and status <> 'closed'
   for update;

  if not found then
    insert into join_attempts (user_id, ok) values (v_uid, false);
    return query select 'invalid_code'::text, null::uuid, null::text, null::boolean;
    return;
  end if;

  -- Already a member? Then this is a reconnect, and it must return the person
  -- to their existing seat rather than create a second participant. This is the
  -- whole reconnect story: one unique key, one upsert, no heuristics.
  -- Tables are aliased throughout this file because `returns table (...)`
  -- puts names like room_id and revision in scope as variables, and PL/pgSQL
  -- then refuses an unqualified column of the same name as ambiguous.
  select * into v_existing from room_members m
   where m.room_id = v_room.id and m.user_id = v_uid;

  if found then
    update room_members m
       set left_at = null, last_seen_at = now()
     where m.id = v_existing.id;
    insert into join_attempts (user_id, ok) values (v_uid, true);
    return query select 'rejoined'::text, v_room.id, v_room.status, v_existing.is_spectator;
    return;
  end if;

  v_max := coalesce((v_room.settings ->> 'max_players')::int, 12);
  select count(*) into v_count from room_members m
   where m.room_id = v_room.id and m.left_at is null;
  if v_count >= v_max then
    insert into join_attempts (user_id, ok) values (v_uid, false);
    return query select 'invalid_code'::text, null::uuid, null::text, null::boolean;
    return;
  end if;

  if coalesce((v_room.settings ->> 'is_locked')::boolean, false) then
    insert into join_attempts (user_id, ok) values (v_uid, false);
    return query select 'invalid_code'::text, null::uuid, null::text, null::boolean;
    return;
  end if;

  -- Turning up mid-game is normal at a party. You watch, and you get a seat
  -- when the next session starts.
  v_spec := (v_room.status = 'in_game');

  begin
    insert into room_members (room_id, user_id, display_name, is_spectator)
    values (v_room.id, v_uid, v_name, v_spec);
  exception when unique_violation then
    insert into join_attempts (user_id, ok) values (v_uid, false);
    return query select 'name_taken'::text, null::uuid, null::text, null::boolean;
    return;
  end;

  update rooms set last_activity_at = now() where id = v_room.id;
  insert into join_attempts (user_id, ok) values (v_uid, true);
  return query select 'joined'::text, v_room.id, v_room.status, v_spec;
end;
$$;

-- -------------------------------------------------------- leave a room -----
create or replace function public.leave_room(p_room uuid)
returns table (result text, new_host uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_room     rooms%rowtype;
  v_next     uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_room from rooms r where r.id = p_room for update;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  update room_members set left_at = now()
   where room_id = p_room and user_id = v_uid and left_at is null;

  if v_room.host_id <> v_uid then
    return query select 'left'::text, v_room.host_id;
    return;
  end if;

  -- The host is leaving on purpose, so hand the room over immediately rather
  -- than making everyone wait out the disconnect timeout.
  select user_id into v_next from room_members
   where room_id = p_room and left_at is null and user_id <> v_uid
   order by joined_at asc limit 1;

  if v_next is null then
    update rooms set status = 'closed', closed_at = now() where id = p_room;
    update game_sessions set status = 'aborted', updated_at = now()
     where room_id = p_room and status in ('setup', 'running');
    return query select 'closed'::text, null::uuid;
    return;
  end if;

  update rooms set host_id = v_next, last_activity_at = now() where id = p_room;
  return query select 'host_transferred'::text, v_next;
end;
$$;

-- ----------------------------------------------------------- heartbeat -----
create or replace function public.heartbeat(p_room uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update room_members set last_seen_at = now()
   where room_id = p_room and user_id = (select auth.uid()) and left_at is null;
$$;

-- ------------------------------------------------------- host handover -----
create or replace function public.transfer_host(p_room uuid, p_to uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_room_host(p_room) then
    return 'not_host';
  end if;
  if not exists (
    select 1 from room_members
     where room_id = p_room and user_id = p_to and left_at is null
  ) then
    return 'not_a_member';
  end if;
  update rooms set host_id = p_to, last_activity_at = now() where id = p_room;
  return 'ok';
end;
$$;

-- Anyone in the room may take over, but only once the current host has
-- genuinely gone quiet. The staleness test lives inside the UPDATE's WHERE
-- clause on purpose: two phones racing to claim an abandoned room both run
-- this, and exactly one of them finds a row to update.
create or replace function public.claim_host(p_room uuid, p_stale_seconds int default 45)
returns table (result text, host_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_host uuid;
begin
  if not public.is_room_member(p_room) then
    return query select 'not_a_member'::text, null::uuid;
    return;
  end if;

  update rooms r
     set host_id = v_uid, last_activity_at = now()
   where r.id = p_room
     and r.host_id <> v_uid
     and exists (
       select 1 from room_members m
        where m.room_id = r.id and m.user_id = r.host_id
          and (m.left_at is not null
               or m.last_seen_at < now() - make_interval(secs => p_stale_seconds))
     )
   returning r.host_id into v_host;

  if found then
    return query select 'claimed'::text, v_host;
  else
    select r.host_id into v_host from rooms r where r.id = p_room;
    return query select 'host_alive'::text, v_host;
  end if;
end;
$$;

-- ============================================================================
--  service_role tier — these accept game state and must never be reachable
--  from a browser.
-- ============================================================================

create or replace function public.start_session(
  p_room_id       uuid,
  p_host          uuid,
  p_game_id       text,
  p_module_version text,
  p_state_version int,
  p_config        jsonb,
  p_seed          text,
  p_initial_state jsonb,
  p_players       jsonb          -- [{user_id, seat_index, display_name}, ...]
)
returns table (result text, session_id uuid, revision bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room    rooms%rowtype;
  v_session uuid;
begin
  select * into v_room from rooms r where r.id = p_room_id for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint;
    return;
  end if;
  if v_room.host_id <> p_host then
    return query select 'not_host'::text, null::uuid, null::bigint;
    return;
  end if;
  if v_room.status <> 'lobby' then
    return query select 'room_busy'::text, null::uuid, null::bigint;
    return;
  end if;

  begin
    insert into game_sessions (
      room_id, game_id, module_version, state_version, status,
      config, seed, initial_state, state, started_at
    ) values (
      p_room_id, p_game_id, p_module_version, p_state_version, 'running',
      p_config, p_seed, p_initial_state, p_initial_state, now()
    ) returning game_sessions.id into v_session;
  exception when unique_violation then
    -- game_sessions_active_uidx: someone else started one microseconds ago.
    return query select 'already_running'::text, null::uuid, null::bigint;
    return;
  end;

  insert into session_players (session_id, user_id, seat_index, display_name)
  select v_session,
         (p ->> 'user_id')::uuid,
         (p ->> 'seat_index')::int,
         p ->> 'display_name'
    from jsonb_array_elements(p_players) as p;

  update rooms r set status = 'in_game', last_activity_at = now() where r.id = p_room_id;

  return query select 'started'::text, v_session, 0::bigint;
end;
$$;

-- The heart of the platform. Called only by the Next.js command handler, after
-- it has verified the caller, validated the action and run the module reducer.
create or replace function public.apply_game_action(
  p_session_id        uuid,
  p_expected_revision bigint,
  p_client_action_id  uuid,
  p_actor             uuid,
  p_action            jsonb,
  p_new_state         jsonb,
  p_new_status        text default null,
  -- The wall clock the reducer actually saw. Stored instead of now() so that
  -- replaying the log feeds a reducer the same instant it was decided with;
  -- using now() here would make undo drift for any game that reads the clock.
  p_acted_at          timestamptz default now()
)
returns table (result text, revision bigint, seq int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing game_actions%rowtype;
  v_rev      bigint;
  v_seq      int;
  v_recent   int;
begin
  -- Replay of an action we already accepted (a retry after a dropped
  -- connection). Answer with the original outcome and change nothing.
  select * into v_existing from game_actions a
   where a.session_id = p_session_id and a.client_action_id = p_client_action_id;
  if found then
    return query select 'duplicate'::text, v_existing.revision_after, v_existing.seq;
    return;
  end if;

  if p_actor is not null then
    select count(*) into v_recent from game_actions a
     where a.session_id = p_session_id and a.actor_user_id = p_actor
       and a.acted_at > now() - interval '10 seconds';
    if v_recent >= 25 then
      return query select 'rate_limited'::text, null::bigint, null::int;
      return;
    end if;
  end if;

  -- Compare-and-swap. Under READ COMMITTED a second transaction blocks here
  -- until the first commits, then re-checks this WHERE clause against the new
  -- row — so the loser matches nothing and is told to recompute rather than
  -- silently overwriting a state it never saw.
  update game_sessions s
     set state      = p_new_state,
         revision   = s.revision + 1,
         next_seq   = s.next_seq + 1,
         status     = coalesce(p_new_status, s.status),
         updated_at = now()
   where s.id = p_session_id and s.revision = p_expected_revision
   returning s.revision, s.next_seq - 1 into v_rev, v_seq;

  if not found then
    return query select 'stale'::text, null::bigint, null::int;
    return;
  end if;

  insert into game_actions (
    session_id, seq, actor_user_id, action, client_action_id, revision_after, acted_at
  ) values (
    p_session_id, v_seq, p_actor, p_action, p_client_action_id, v_rev,
    coalesce(p_acted_at, now())
  ) on conflict (session_id, client_action_id) do nothing;

  if not found then
    -- Two identical action ids raced past the check above. Abort so the
    -- revision bump is rolled back too; the retry takes the duplicate path.
    raise exception 'concurrent_duplicate' using errcode = '40001';
  end if;

  update rooms r set last_activity_at = now()
   where r.id = (select s.room_id from game_sessions s where s.id = p_session_id);

  return query select 'applied'::text, v_rev, v_seq;
end;
$$;

-- Undo is a platform capability, not something modules implement. The handler
-- replays the log without the undone action and hands the result in here, so a
-- module never has to write an inverse of its own moves.
create or replace function public.undo_last_action(
  p_session_id        uuid,
  p_expected_revision bigint,
  p_undo_seq          int,
  p_new_state         jsonb
)
returns table (result text, revision bigint, undone_seq int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max int;
  v_rev bigint;
begin
  select max(a.seq) into v_max from game_actions a
   where a.session_id = p_session_id and a.undone_at is null;

  if v_max is null then
    return query select 'nothing_to_undo'::text, null::bigint, null::int;
    return;
  end if;
  if v_max <> p_undo_seq then
    -- Something landed after the state we replayed. Recompute and try again.
    return query select 'stale'::text, null::bigint, null::int;
    return;
  end if;

  update game_sessions s
     set state = p_new_state, revision = s.revision + 1, updated_at = now()
   where s.id = p_session_id and s.revision = p_expected_revision
   returning s.revision into v_rev;

  if not found then
    return query select 'stale'::text, null::bigint, null::int;
    return;
  end if;

  -- The row stays, marked. Its seq is never reissued, so every surviving
  -- action keeps the RNG draw it was decided with.
  update game_actions a set undone_at = now()
   where a.session_id = p_session_id and a.seq = p_undo_seq;

  return query select 'undone'::text, v_rev, p_undo_seq;
end;
$$;

create or replace function public.finish_session(
  p_session_id        uuid,
  p_expected_revision bigint,
  p_final_state       jsonb,
  p_summary           jsonb,
  p_players           jsonb   -- [{user_id, display_name, placement, score, payload}]
)
returns table (result text, result_id uuid, revision bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session game_sessions%rowtype;
  v_room    rooms%rowtype;
  v_result  uuid;
  v_rev     bigint;
begin
  select * into v_session from game_sessions s where s.id = p_session_id;
  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint;
    return;
  end if;

  -- Finishing twice must not create two result rows; match_results.session_id
  -- is unique and this is the friendly path to that guarantee.
  select r.id into v_result from match_results r where r.session_id = p_session_id;
  if found then
    return query select 'already_finished'::text, v_result, v_session.revision;
    return;
  end if;

  select * into v_room from rooms r where r.id = v_session.room_id for update;

  update game_sessions s
     set state = p_final_state, revision = s.revision + 1,
         status = 'finished', finished_at = now(), updated_at = now()
   where s.id = p_session_id and s.revision = p_expected_revision
   returning s.revision into v_rev;

  if not found then
    return query select 'stale'::text, null::uuid, null::bigint;
    return;
  end if;

  insert into match_results (
    session_id, room_id, room_code, game_id, module_version, summary
  ) values (
    p_session_id, v_session.room_id, v_room.code,
    v_session.game_id, v_session.module_version, coalesce(p_summary, '{}'::jsonb)
  ) returning match_results.id into v_result;

  insert into match_result_players (
    result_id, user_id, display_name, placement, score, payload
  )
  select v_result,
         nullif(p ->> 'user_id', '')::uuid,
         p ->> 'display_name',
         (p ->> 'placement')::int,
         (p ->> 'score')::numeric,
         coalesce(p -> 'payload', '{}'::jsonb)
    from jsonb_array_elements(p_players) as p;

  update rooms r set status = 'lobby', last_activity_at = now()
   where r.id = v_session.room_id;

  return query select 'finished'::text, v_result, v_rev;
end;
$$;

create or replace function public.abort_session(p_session_id uuid, p_actor uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session game_sessions%rowtype;
begin
  select * into v_session from game_sessions s where s.id = p_session_id;
  if not found then return 'not_found'; end if;

  if not exists (
    select 1 from rooms where id = v_session.room_id and host_id = p_actor
  ) then
    return 'not_host';
  end if;

  update game_sessions set status = 'aborted', updated_at = now()
   where id = p_session_id and status in ('setup', 'running');
  update rooms set status = 'lobby', last_activity_at = now()
   where id = v_session.room_id;
  return 'aborted';
end;
$$;

-- Used when a module's state schema has moved on and a stored state has to be
-- lifted to the current version before play can resume.
create or replace function public.migrate_session_state(
  p_session_id        uuid,
  p_expected_revision bigint,
  p_new_state         jsonb,
  -- initial_state has to move with it: undo replays the log from that snapshot,
  -- and folding a v1 snapshot with a v2 reducer produces silent nonsense.
  p_new_initial_state jsonb,
  p_state_version     int,
  p_module_version    text
)
returns table (result text, revision bigint)
language plpgsql
security definer
set search_path = public
as $$
declare v_rev bigint;
begin
  update game_sessions s
     set state = p_new_state, initial_state = p_new_initial_state,
         state_version = p_state_version,
         module_version = p_module_version,
         revision = s.revision + 1, updated_at = now()
   where s.id = p_session_id and s.revision = p_expected_revision
   returning s.revision into v_rev;

  if not found then
    return query select 'stale'::text, null::bigint;
  else
    return query select 'migrated'::text, v_rev;
  end if;
end;
$$;

-- ============================================================================
--  Grants. PostgreSQL grants EXECUTE to PUBLIC by default, so every
--  state-accepting function has to have that taken away explicitly.
-- ============================================================================
revoke all on function public.start_session(uuid,uuid,text,text,int,jsonb,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.apply_game_action(uuid,bigint,uuid,uuid,jsonb,jsonb,text,timestamptz) from public, anon, authenticated;
revoke all on function public.undo_last_action(uuid,bigint,int,jsonb)                        from public, anon, authenticated;
revoke all on function public.finish_session(uuid,bigint,jsonb,jsonb,jsonb)                  from public, anon, authenticated;
revoke all on function public.abort_session(uuid,uuid)                                       from public, anon, authenticated;
revoke all on function public.migrate_session_state(uuid,bigint,jsonb,jsonb,int,text)        from public, anon, authenticated;
revoke all on function public.gen_room_code(int)                                             from public, anon, authenticated;

grant execute on function public.start_session(uuid,uuid,text,text,int,jsonb,text,jsonb,jsonb) to service_role;
grant execute on function public.apply_game_action(uuid,bigint,uuid,uuid,jsonb,jsonb,text,timestamptz) to service_role;
grant execute on function public.undo_last_action(uuid,bigint,int,jsonb)                       to service_role;
grant execute on function public.finish_session(uuid,bigint,jsonb,jsonb,jsonb)                 to service_role;
grant execute on function public.abort_session(uuid,uuid)                                      to service_role;
grant execute on function public.migrate_session_state(uuid,bigint,jsonb,jsonb,int,text)       to service_role;
grant execute on function public.gen_room_code(int)                                            to service_role;

-- The parameter-only tier stays reachable from a signed-in phone.
grant execute on function public.create_room(text,jsonb)   to authenticated;
grant execute on function public.join_room(text,text)      to authenticated;
grant execute on function public.leave_room(uuid)          to authenticated;
grant execute on function public.heartbeat(uuid)           to authenticated;
grant execute on function public.transfer_host(uuid,uuid)  to authenticated;
grant execute on function public.claim_host(uuid,int)      to authenticated;
