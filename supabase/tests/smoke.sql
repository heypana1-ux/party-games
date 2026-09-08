-- ============================================================================
--  Migration smoke test.
--
--  Run against a plain PostgreSQL instance after local_shim.sql and the
--  migrations. Checks the properties that would fail silently in production:
--  the compare-and-swap under a stale revision, idempotent retries, seq never
--  being reissued, the grants that keep state-writing RPCs away from browsers,
--  and RLS actually hiding other people's rooms.
--
--    createdb partytest
--    psql -d partytest -f supabase/tests/local_shim.sql
--    psql -d partytest -f supabase/migrations/0001_platform_core.sql   # …0005
--    psql -d partytest -v ON_ERROR_STOP=1 -f supabase/tests/smoke.sql
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

create or replace function assert_eq(got anyelement, want anyelement, label text)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL %: got % want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end;
$$;

do $$
declare
  v_host    uuid;
  v_alex    uuid;
  v_robin   uuid;
  v_room    uuid;
  v_code    text;
  v_session uuid;
  v_res     record;
  v_count   int;
  v_seq     int;
begin
  insert into auth.users (is_anonymous) values (true) returning id into v_host;
  insert into auth.users (is_anonymous) values (true) returning id into v_alex;
  insert into auth.users (is_anonymous) values (true) returning id into v_robin;

  -- ---------------------------------------------------------------- rooms --
  perform auth.become(v_host);
  select * into v_res from create_room('Sam', '{}'::jsonb);
  v_room := v_res.room_id;
  v_code := v_res.code;

  perform assert_eq(v_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$', true,
                    'room code uses the unambiguous alphabet');

  perform auth.become(v_alex);
  select * into v_res from join_room('ZZZZZZ', 'Alex');
  perform assert_eq(v_res.result, 'invalid_code', 'a wrong code is refused');

  select * into v_res from join_room(v_code, 'Alex');
  perform assert_eq(v_res.result, 'joined', 'a correct code joins');

  -- The whole reconnect story: same identity, same seat, no duplicate.
  select * into v_res from join_room(v_code, 'Alex');
  perform assert_eq(v_res.result, 'rejoined', 'joining twice is a rejoin');

  select count(*) into v_count from room_members
   where room_id = v_room and user_id = v_alex;
  perform assert_eq(v_count, 1, 'rejoining creates no second participant');

  perform auth.become(v_robin);
  select * into v_res from join_room(v_code, 'alex');
  perform assert_eq(v_res.result, 'name_taken', 'two people cannot share a name');
  select * into v_res from join_room(v_code, 'Robin');
  perform assert_eq(v_res.result, 'joined', 'a free name joins');

  -- --------------------------------------------------------------- session --
  select * into v_res from start_session(
    v_room, v_host, 'dummy', '1.0.0', 1,
    '{"targetTaps": 100, "bonusEnabled": false}'::jsonb,
    'test-seed', '{"counter": 0}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('user_id', v_host,  'seat_index', 0, 'display_name', 'Sam'),
      jsonb_build_object('user_id', v_alex,  'seat_index', 1, 'display_name', 'Alex'),
      jsonb_build_object('user_id', v_robin, 'seat_index', 2, 'display_name', 'Robin')
    )
  );
  perform assert_eq(v_res.result, 'started', 'the host can start a session');
  v_session := v_res.session_id;

  -- A player who is not the host is refused before anything else is examined.
  select * into v_res from start_session(
    v_room, v_alex, 'dummy', '1.0.0', 1, '{}'::jsonb, 's', '{}'::jsonb, '[]'::jsonb);
  perform assert_eq(v_res.result, 'not_host', 'only the host may start a game');

  -- And the host cannot start a second game while one is running.
  select * into v_res from start_session(
    v_room, v_host, 'dummy', '1.0.0', 1, '{}'::jsonb, 's', '{}'::jsonb, '[]'::jsonb);
  perform assert_eq(v_res.result, 'room_busy', 'a second session cannot start');

  -- ----------------------------------------------------------- the pipeline --
  select * into v_res from apply_game_action(
    v_session, 0, gen_random_uuid(), v_host,
    '{"type":"tap"}'::jsonb, '{"counter":1}'::jsonb);
  perform assert_eq(v_res.result, 'applied', 'an action on the current revision applies');
  perform assert_eq(v_res.revision, 1::bigint, 'revision advances by one');
  perform assert_eq(v_res.seq, 1, 'the first action takes seq 1');

  -- A client that computed against revision 0 must not overwrite revision 1.
  select * into v_res from apply_game_action(
    v_session, 0, gen_random_uuid(), v_alex,
    '{"type":"tap"}'::jsonb, '{"counter":99}'::jsonb);
  perform assert_eq(v_res.result, 'stale', 'a stale revision is refused');

  select state ->> 'counter' into v_code from game_sessions where id = v_session;
  perform assert_eq(v_code, '1', 'the refused action did not touch the state');

  -- ------------------------------------------------------------ idempotency --
  declare v_action uuid := gen_random_uuid();
  begin
    select * into v_res from apply_game_action(
      v_session, 1, v_action, v_alex, '{"type":"tap"}'::jsonb, '{"counter":2}'::jsonb);
    perform assert_eq(v_res.result, 'applied', 'a fresh action id applies');

    for i in 1..4 loop
      select * into v_res from apply_game_action(
        v_session, 2, v_action, v_alex, '{"type":"tap"}'::jsonb, '{"counter":3}'::jsonb);
      perform assert_eq(v_res.result, 'duplicate', 'a repeated action id is a no-op');
    end loop;

    select revision into v_seq from game_sessions where id = v_session;
    perform assert_eq(v_seq, 2, 'five sends of one intent scored once');
  end;

  -- ------------------------------------------------------------------- undo --
  select next_seq into v_seq from game_sessions where id = v_session;
  perform assert_eq(v_seq, 3, 'next_seq is ahead of the last issued seq');

  select * into v_res from undo_last_action(v_session, 2, 2, '{"counter":1}'::jsonb);
  perform assert_eq(v_res.result, 'undone', 'the last action can be undone');

  select next_seq into v_seq from game_sessions where id = v_session;
  perform assert_eq(v_seq, 3, 'undo does not rewind next_seq, so no seed is reused');

  select count(*) into v_count from game_actions
   where session_id = v_session and undone_at is null;
  perform assert_eq(v_count, 1, 'one action survives the undo');

  select * into v_res from undo_last_action(v_session, 3, 2, '{"counter":1}'::jsonb);
  perform assert_eq(v_res.result, 'stale', 'undoing an already undone seq is refused');

  -- ----------------------------------------------------------------- finish --
  select * into v_res from finish_session(
    v_session, 3, '{"counter":1}'::jsonb, '{"winner":"Sam"}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('user_id', v_host, 'display_name', 'Sam',   'placement', 1, 'score', 1),
      jsonb_build_object('user_id', v_alex, 'display_name', 'Alex',  'placement', 2, 'score', 0),
      jsonb_build_object('user_id', v_robin,'display_name', 'Robin', 'placement', 2, 'score', 0)
    ));
  perform assert_eq(v_res.result, 'finished', 'a finished session is archived');

  select status into v_code from rooms where id = v_room;
  perform assert_eq(v_code, 'lobby', 'the room returns to the lobby');

  select * into v_res from finish_session(
    v_session, 4, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb);
  perform assert_eq(v_res.result, 'already_finished', 'finishing twice makes one result');

  select count(*) into v_count from match_result_players
   where result_id = (select id from match_results where session_id = v_session);
  perform assert_eq(v_count, 3, 'every seat is recorded in the result');

  -- ----------------------------------------------------------- host rescue --
  update room_members set last_seen_at = now() - interval '3 minutes'
   where room_id = v_room and user_id = v_host;

  perform auth.become(v_alex);
  select * into v_res from claim_host(v_room, 45);
  perform assert_eq(v_res.result, 'claimed', 'an abandoned room can be taken over');

  perform auth.become(v_robin);
  select * into v_res from claim_host(v_room, 45);
  perform assert_eq(v_res.result, 'host_alive', 'a live host cannot be displaced');

  raise notice '--- functional checks passed ---';
end;
$$;

-- --------------------------------------------------------------- grants -----
do $$
begin
  perform assert_eq(
    has_function_privilege('authenticated',
      'public.apply_game_action(uuid,bigint,uuid,uuid,jsonb,jsonb,text,timestamptz)', 'execute'),
    false, 'a phone cannot execute apply_game_action');

  perform assert_eq(
    has_function_privilege('authenticated',
      'public.start_session(uuid,uuid,text,text,int,jsonb,text,jsonb,jsonb)', 'execute'),
    false, 'a phone cannot execute start_session');

  perform assert_eq(
    has_function_privilege('authenticated',
      'public.finish_session(uuid,bigint,jsonb,jsonb,jsonb)', 'execute'),
    false, 'a phone cannot execute finish_session');

  perform assert_eq(
    has_function_privilege('authenticated',
      'public.undo_last_action(uuid,bigint,int,jsonb)', 'execute'),
    false, 'a phone cannot execute undo_last_action');

  perform assert_eq(
    has_function_privilege('service_role',
      'public.apply_game_action(uuid,bigint,uuid,uuid,jsonb,jsonb,text,timestamptz)', 'execute'),
    true, 'the command pipeline can execute apply_game_action');

  perform assert_eq(
    has_function_privilege('authenticated', 'public.join_room(text,text)', 'execute'),
    true, 'a phone can execute join_room');

  perform assert_eq(has_table_privilege('authenticated', 'public.game_sessions', 'update'),
                    false, 'a phone has no update grant on game state');
  perform assert_eq(has_table_privilege('authenticated', 'public.game_sessions', 'select'),
                    true, 'a phone may read game state');
  perform assert_eq(has_table_privilege('anon', 'public.game_sessions', 'select'),
                    false, 'a caller who never signed in reads nothing');
  perform assert_eq(has_table_privilege('anon', 'public.rooms', 'select'),
                    false, 'a caller who never signed in cannot list rooms');
  perform assert_eq(has_table_privilege('authenticated', 'public.match_results', 'delete'),
                    false, 'a phone cannot delete history');
  perform assert_eq(has_table_privilege('authenticated', 'public.profiles', 'update'),
                    true, 'a phone may edit its own profile');

  raise notice '--- grant checks passed ---';
end;
$$;

-- ------------------------------------------------------------------ RLS -----
-- RLS is not enforced for superusers, so these run as `authenticated` with a
-- JWT subject set the way Supabase would set it.

select code as target_code, host_id as member_id from rooms limit 1 \gset

insert into auth.users (is_anonymous) values (true) returning id as stranger_id \gset

-- A member: should see exactly the one room they are in.
begin;
select set_config('request.jwt.claim.sub', :'member_id', true) as _ \gset ignore_
set local role authenticated;
select count(*) as member_sees from rooms where code = :'target_code' \gset
rollback;

-- A stranger who has been handed the code: should see nothing at all.
begin;
select set_config('request.jwt.claim.sub', :'stranger_id', true) as _ \gset ignore2_
set local role authenticated;
select count(*) as stranger_sees_rooms from rooms where code = :'target_code' \gset
select count(*) as stranger_sees_sessions from game_sessions \gset
select count(*) as stranger_sees_results from match_results \gset
select count(*) as stranger_sees_actions from game_actions \gset
rollback;

\if :member_sees
\echo 'ok  a member can read their own room'
\else
\echo 'FAIL a member could not read their own room'
\quit
\endif

\if :stranger_sees_rooms
\echo 'FAIL knowing a code let a stranger read the room'
\quit
\else
\echo 'ok  knowing a code does not make a room readable'
\endif

\if :stranger_sees_sessions
\echo 'FAIL a stranger could read game state'
\quit
\else
\echo 'ok  a stranger cannot read game state'
\endif

\if :stranger_sees_results
\echo 'FAIL a stranger could read match history'
\quit
\else
\echo 'ok  a stranger cannot read someone else history'
\endif

\if :stranger_sees_actions
\echo 'FAIL a stranger could read the action log'
\quit
\else
\echo 'ok  a stranger cannot read the action log'
\endif

\echo '--- RLS checks passed ---'

drop function assert_eq(anyelement, anyelement, text);
