-- ============================================================================
--  Retention
--
--  A party room is interesting for one evening. Results are interesting
--  forever. Everything in between is a liability: rooms nobody closed, action
--  logs for games that ended weeks ago, and guest accounts created by people
--  who joined once and never came back.
-- ============================================================================

create or replace function public.reap_stale_rooms()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  with closed as (
    update rooms set status = 'closed', closed_at = now()
     where status <> 'closed' and last_activity_at < now() - interval '12 hours'
    returning id
  )
  select count(*) into v_count from closed;

  update game_sessions set status = 'aborted', updated_at = now()
   where status in ('setup', 'running')
     and room_id in (select id from rooms where status = 'closed');

  return v_count;
end;
$$;

-- Closed rooms cascade to memberships, sessions and actions. Results survive
-- because match_results.room_id is ON DELETE SET NULL and carries a snapshot of
-- the room code and every player's name.
create or replace function public.reap_closed_rooms()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  with gone as (
    delete from rooms
     where status = 'closed' and closed_at < now() - interval '7 days'
    returning id
  )
  select count(*) into v_count from gone;
  return v_count;
end;
$$;

-- The action log exists for undo and for post-mortem debugging. Once a session
-- is finished and archived, the final snapshot plus the result row say
-- everything a player will ever ask about.
create or replace function public.reap_finished_action_logs()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  with gone as (
    delete from game_actions a
     using game_sessions s
     where a.session_id = s.id
       and s.status in ('finished', 'aborted')
       and s.updated_at < now() - interval '7 days'
    returning a.id
  )
  select count(*) into v_count from gone;
  return v_count;
end;
$$;

create or replace function public.reap_join_attempts()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  with gone as (
    delete from join_attempts where attempted_at < now() - interval '1 day'
    returning id
  )
  select count(*) into v_count from gone;
  return v_count;
end;
$$;

-- Anonymous sign-in makes guest play frictionless; it also mints a permanent
-- auth row for every person who ever tapped "join". Without this the auth table
-- grows without bound and never shrinks.
create or replace function public.reap_anonymous_users()
returns int
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_count int;
begin
  with gone as (
    delete from auth.users u
     where u.is_anonymous
       and u.created_at < now() - interval '30 days'
       and not exists (
         select 1 from public.room_members m
          join public.rooms r on r.id = m.room_id
          where m.user_id = u.id and m.left_at is null and r.status <> 'closed'
       )
    returning u.id
  )
  select count(*) into v_count from gone;
  return v_count;
end;
$$;

revoke all on function public.reap_stale_rooms()          from public, anon, authenticated;
revoke all on function public.reap_closed_rooms()         from public, anon, authenticated;
revoke all on function public.reap_finished_action_logs() from public, anon, authenticated;
revoke all on function public.reap_join_attempts()        from public, anon, authenticated;
revoke all on function public.reap_anonymous_users()      from public, anon, authenticated;

-- Scheduling is optional: the functions above are the contract, pg_cron is just
-- one way to call them. If the extension is not enabled the migration still
-- applies cleanly and the reapers can be run from anywhere.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('party-reap-stale-rooms',   '*/15 * * * *', 'select public.reap_stale_rooms()');
    perform cron.schedule('party-reap-closed-rooms',  '17 3 * * *',   'select public.reap_closed_rooms()');
    perform cron.schedule('party-reap-action-logs',   '27 3 * * *',   'select public.reap_finished_action_logs()');
    perform cron.schedule('party-reap-join-attempts', '37 3 * * *',   'select public.reap_join_attempts()');
    perform cron.schedule('party-reap-anon-users',    '47 3 * * 0',   'select public.reap_anonymous_users()');
  else
    raise notice 'pg_cron not installed — enable it and re-run the DO block at the end of 0004 to schedule retention.';
  end if;
end;
$$;
