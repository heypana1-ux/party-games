-- ============================================================================
--  Party Games — platform core schema
--  Everything here is game-agnostic. No table, column or constraint may encode
--  the rules of a specific game; a game's rules live entirely inside the jsonb
--  columns `config`, `state` and `action`, which this schema never inspects.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- profiles --
-- Registered users only. Guests are anonymous auth.users rows with NO profile:
-- a guest's name is a property of their membership in one room, not of their
-- identity, so the same person can be "Max" in one room and "DJ" in another.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null
                 check (char_length(btrim(display_name)) between 2 and 24),
  avatar_key   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ------------------------------------------------------------------- rooms --
create table if not exists public.rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null
                     check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'),
  status           text not null default 'lobby'
                     check (status in ('lobby', 'in_game', 'closed')),
  host_id          uuid not null references auth.users(id) on delete restrict,
  created_by       uuid not null references auth.users(id) on delete restrict,
  -- Platform-level settings only (max_players, is_locked). Never game settings.
  settings         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  closed_at        timestamptz
);

-- A code only has to be unique among rooms you can still join, so codes become
-- available again once a room closes. Without the WHERE clause the 6-character
-- space would slowly fill up with dead rooms.
create unique index if not exists rooms_code_active_uidx
  on public.rooms (code) where status <> 'closed';
create index if not exists rooms_reaper_idx
  on public.rooms (last_activity_at) where status <> 'closed';
create index if not exists rooms_host_idx on public.rooms (host_id);

-- ------------------------------------------------------------ memberships --
create table if not exists public.room_members (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text not null
                 check (char_length(btrim(display_name)) between 2 and 24),
  is_spectator boolean not null default false,
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at      timestamptz,
  -- The single most important constraint in this schema: reconnecting is an
  -- upsert on a unique key, not a heuristic. One person can never become two
  -- participants, no matter how often they reload or how many tabs they open.
  constraint room_members_unique unique (room_id, user_id)
);

-- Two "Max" in one room is a usability bug, not a data bug — but it is cheap
-- to prevent here and impossible to fix later in the UI.
create unique index if not exists room_members_name_uidx
  on public.room_members (room_id, lower(btrim(display_name)))
  where left_at is null;
create index if not exists room_members_room_idx
  on public.room_members (room_id) where left_at is null;
create index if not exists room_members_seen_idx
  on public.room_members (room_id, last_seen_at);
create index if not exists room_members_user_idx on public.room_members (user_id);

-- ---------------------------------------------------------- game sessions --
-- The authoritative state of a running game. Exactly one row is the truth;
-- every client copy is a cache of it.
create table if not exists public.game_sessions (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms(id) on delete cascade,
  game_id        text not null,
  module_version text not null,   -- semver of the module that started this session
  state_version  int  not null,   -- schema version of `state`, owned by the module
  status         text not null default 'setup'
                   check (status in ('setup', 'running', 'finished', 'aborted')),
  config         jsonb  not null,
  seed           text   not null, -- deterministic RNG root; replay depends on it
  initial_state  jsonb  not null, -- kept so undo can replay instead of inverting
  state          jsonb  not null, -- ← the truth
  -- Bumped on EVERY state change (action, undo, migration). Guards the
  -- compare-and-swap that makes concurrent actions safe.
  revision       bigint not null default 0,
  -- Bumped only when an action is accepted, and never reused — not even after
  -- an undo. RNG seeds derive from it, so a reused seq would silently make two
  -- different actions share a random draw.
  next_seq       int    not null default 1,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  updated_at     timestamptz not null default now()
);

-- A room plays one game at a time. Enforced here rather than in application
-- code because two clients can both pass an "is anything running?" check.
create unique index if not exists game_sessions_active_uidx
  on public.game_sessions (room_id) where status in ('setup', 'running');
create index if not exists game_sessions_room_idx
  on public.game_sessions (room_id, created_at desc);

-- Which members hold a seat in this session. Members may sit out a round.
create table if not exists public.session_players (
  session_id   uuid not null references public.game_sessions(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  seat_index   int  not null check (seat_index >= 0),
  display_name text not null,     -- snapshot, so replay is stable if a name changes
  primary key (session_id, user_id),
  constraint session_players_seat_unique unique (session_id, seat_index)
);

-- ------------------------------------------------------------ action log ---
create table if not exists public.game_actions (
  id               bigint generated always as identity primary key,
  session_id       uuid not null references public.game_sessions(id) on delete cascade,
  seq              int  not null,
  actor_user_id    uuid references auth.users(id) on delete set null,
  action           jsonb not null,
  -- Idempotency key minted once per user intent on the client. A retry after a
  -- dropped connection carries the same id, so the action lands exactly once.
  client_action_id uuid not null,
  revision_after   bigint not null,
  -- Replay must use this, never now(): a reducer that reads the wall clock
  -- would produce a different state every time the log is folded.
  acted_at         timestamptz not null default now(),
  undone_at        timestamptz,
  constraint game_actions_idem   unique (session_id, client_action_id),
  constraint game_actions_seq_uq unique (session_id, seq)
);

create index if not exists game_actions_replay_idx
  on public.game_actions (session_id, seq) where undone_at is null;
create index if not exists game_actions_rate_idx
  on public.game_actions (session_id, actor_user_id, acted_at desc);

-- --------------------------------------------------------------- history ---
-- Deliberately denormalised: results outlive the room, the session and even the
-- guest accounts that produced them, so everything needed to render a result is
-- snapshotted into these two tables.
create table if not exists public.match_results (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid unique references public.game_sessions(id) on delete set null,
  room_id        uuid references public.rooms(id) on delete set null,
  room_code      text not null,
  game_id        text not null,
  module_version text not null,
  -- Produced by the module, stored by the platform, interpreted by neither the
  -- database nor the shell. The module owns its shape.
  summary        jsonb not null default '{}'::jsonb,
  finished_at    timestamptz not null default now()
);
create index if not exists match_results_game_idx
  on public.match_results (game_id, finished_at desc);
create index if not exists match_results_room_idx on public.match_results (room_id);

create table if not exists public.match_result_players (
  id           uuid primary key default gen_random_uuid(),
  result_id    uuid not null references public.match_results(id) on delete cascade,
  -- Null once a guest account is reaped. display_name keeps the row readable.
  user_id      uuid references auth.users(id) on delete set null,
  display_name text not null,
  placement    int,
  score        numeric,
  payload      jsonb not null default '{}'::jsonb,
  constraint match_result_players_unique unique (result_id, display_name)
);
create index if not exists mrp_user_idx on public.match_result_players (user_id);
create index if not exists mrp_result_idx on public.match_result_players (result_id);
