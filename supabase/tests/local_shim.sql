-- ============================================================================
--  Local Supabase shim — for validating the migrations against a plain
--  PostgreSQL instance (CI, or a laptop without the Supabase CLI).
--
--  It creates only the primitives the migrations depend on: the three Supabase
--  roles, an `auth.users` table, `auth.uid()`, and a way for a test to say who
--  it is. It is NOT a Supabase emulator and must never run against a real
--  project.
-- ============================================================================

create extension if not exists pgcrypto;
create schema if not exists extensions;
-- The migrations call extensions.gen_random_bytes, which is where Supabase
-- installs pgcrypto.
create or replace function extensions.gen_random_bytes(int)
returns bytea language sql as $$ select public.gen_random_bytes($1); $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id           uuid primary key default gen_random_uuid(),
  email        text,
  is_anonymous boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Supabase derives this from the request's JWT. Here a test sets it directly.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

/** Test helper: act as this user for the rest of the session. */
create or replace function auth.become(p_user uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', p_user::text, false);
$$;

grant usage on schema public, auth, extensions to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
