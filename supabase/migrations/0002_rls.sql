-- ============================================================================
--  Row Level Security
--
--  The anon key ships to every phone, so RLS is not a second line of defence —
--  it is the only one. Two rules hold throughout this file:
--
--    1. Every table has RLS enabled and at least one policy. A table with RLS
--       on and no policy is invisible; a table with RLS off is world-readable.
--    2. There are NO insert/update/delete policies for `authenticated`, except
--       a user editing their own profile. Every mutation goes through a
--       security-definer RPC in 0003, which is what stops a client from simply
--       PATCHing `game_sessions.state` to "I win".
-- ============================================================================

-- ------------------------------------------------------------- helpers -----
-- SECURITY DEFINER matters twice here: it lets the function see rows the caller
-- cannot, and it stops the infinite recursion you would otherwise get from a
-- policy on room_members that needs to read room_members.
create or replace function public.is_room_member(p_room uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from room_members
    where room_id = p_room and user_id = (select auth.uid()) and left_at is null
  );
$$;

create or replace function public.is_room_host(p_room uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from rooms where id = p_room and host_id = (select auth.uid()));
$$;

create or replace function public.shares_room(p_other uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from room_members mine
    join room_members theirs on theirs.room_id = mine.room_id
    where mine.user_id = (select auth.uid()) and mine.left_at is null
      and theirs.user_id = p_other and theirs.left_at is null
  );
$$;

create or replace function public.was_in_result(p_result uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from match_result_players
    where result_id = p_result and user_id = (select auth.uid())
  );
$$;

-- ------------------------------------------------------------ profiles -----
alter table public.profiles enable row level security;

drop policy if exists "profiles readable to self and room mates" on public.profiles;
create policy "profiles readable to self and room mates" on public.profiles
  for select using (id = (select auth.uid()) or public.shares_room(id));

drop policy if exists "profiles insert self" on public.profiles;
create policy "profiles insert self" on public.profiles
  for insert with check (id = (select auth.uid()));

drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self" on public.profiles
  for update using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- --------------------------------------------------------------- rooms -----
alter table public.rooms enable row level security;

-- Note what is missing: there is no policy matching on `code`. A room code is
-- not a read credential — it is only redeemable through join_room(), which
-- rate-limits attempts and answers identically for wrong, full and closed
-- rooms. Without this, six characters would be enough to enumerate parties.
drop policy if exists "rooms readable to members" on public.rooms;
create policy "rooms readable to members" on public.rooms
  for select using (public.is_room_member(id));

-- ---------------------------------------------------------- memberships ----
alter table public.room_members enable row level security;

drop policy if exists "members readable to members" on public.room_members;
create policy "members readable to members" on public.room_members
  for select using (public.is_room_member(room_id));

-- -------------------------------------------------------- game sessions ----
alter table public.game_sessions enable row level security;

-- Read-only for everyone at the table. The only writer is the command pipeline
-- running as service_role.
drop policy if exists "sessions readable to members" on public.game_sessions;
create policy "sessions readable to members" on public.game_sessions
  for select using (public.is_room_member(room_id));

alter table public.session_players enable row level security;

drop policy if exists "session players readable to members" on public.session_players;
create policy "session players readable to members" on public.session_players
  for select using (
    exists (
      select 1 from game_sessions s
      where s.id = session_id and public.is_room_member(s.room_id)
    )
  );

-- ----------------------------------------------------------- action log ----
alter table public.game_actions enable row level security;

drop policy if exists "actions readable to members" on public.game_actions;
create policy "actions readable to members" on public.game_actions
  for select using (
    exists (
      select 1 from game_sessions s
      where s.id = session_id and public.is_room_member(s.room_id)
    )
  );

-- -------------------------------------------------------------- history ----
alter table public.match_results enable row level security;

drop policy if exists "results readable to participants" on public.match_results;
create policy "results readable to participants" on public.match_results
  for select using (public.was_in_result(id));

alter table public.match_result_players enable row level security;

drop policy if exists "result players readable to participants" on public.match_result_players;
create policy "result players readable to participants" on public.match_result_players
  for select using (public.was_in_result(result_id));

-- ------------------------------------------------- default privileges ------
-- Belt and braces: even if a policy were added by mistake, the roles have no
-- table-level write grant on the state-bearing tables.
revoke insert, update, delete on public.rooms            from anon, authenticated;
revoke insert, update, delete on public.room_members     from anon, authenticated;
revoke insert, update, delete on public.game_sessions    from anon, authenticated;
revoke insert, update, delete on public.session_players  from anon, authenticated;
revoke insert, update, delete on public.game_actions     from anon, authenticated;
revoke insert, update, delete on public.match_results    from anon, authenticated;
revoke insert, update, delete on public.match_result_players from anon, authenticated;
