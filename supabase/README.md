# Supabase setup

This app needs **its own Supabase project**. Do not point it at a project used by another
app — the migrations create tables and RPCs in `public` and change `supabase_realtime`.

## 1. Create the project

Create a new project at https://supabase.com/dashboard, then copy the URL and keys into
`.env.local` (see `.env.example`).

## 2. Apply the migrations

Either with the CLI:

```bash
supabase link --project-ref <your-ref>
supabase db push
```

…or by pasting `migrations/0001` … `0005` into the SQL editor **in order**.

## 3. Enable anonymous sign-in

Dashboard → Authentication → Providers → **Anonymous sign-ins: enabled**.

Guests are real `auth.users` rows. That is what makes `auth.uid()` the single identity
primitive everywhere — RLS, RPCs and Realtime all work the same for a guest and a
registered user, and reconnecting is a lookup on a unique key rather than a guess.

Turn on **Attack protection → Captcha** as well. Anonymous sign-in without a captcha is an
open account factory.

## 4. Optional: pg_cron for retention

Dashboard → Database → Extensions → enable `pg_cron`, then re-run the `DO` block at the end
of `0004_retention.sql`. Without it the reaper functions still exist and can be called
manually or from any scheduler.

## What is deliberately not here

There is no policy that lets a client `insert`, `update` or `delete` anything except its own
profile. Every mutation goes through a `security definer` RPC, and the RPCs that accept a
game **state** are granted to `service_role` only. If those were callable from a browser, a
player could simply hand in a state where they had won.
