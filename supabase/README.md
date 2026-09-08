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

## 4. Turn on the captcha

Anonymous sign-in without a captcha is an open account factory: one unauthenticated POST
mints a permanent `auth.users` row, and nothing rate-limits a script doing that in a loop.

**Do these two steps in this order, or every guest sign-in breaks in between.**

1. Put the hCaptcha **site** key in the app's environment first and deploy it:

   ```
   NEXT_PUBLIC_HCAPTCHA_SITE_KEY=<site-key>
   ```

2. Then in Supabase: Authentication → **Attack Protection** → Captcha → provider
   **hCaptcha**, and paste the hCaptcha **secret** key.

The secret key lives only here. Supabase Auth is what calls hCaptcha's `siteverify`, so the
app never needs it — there is no backend verification step to write, and the `curl` example
in hCaptcha's own quickstart does not apply to this setup.

With the site key unset the app skips the captcha entirely, which is what makes local
development and CI work. hCaptcha's always-passing test key is
`10000000-ffff-ffff-ffff-000000000001` if you want the code path exercised without a
challenge.

## 5. Optional: pg_cron for retention

Dashboard → Database → Extensions → enable `pg_cron`, then re-run the `DO` block at the end
of `0004_retention.sql`. Without it the reaper functions still exist and can be called
manually or from any scheduler.

## What is deliberately not here

There is no policy that lets a client `insert`, `update` or `delete` anything except its own
profile. Every mutation goes through a `security definer` RPC, and the RPCs that accept a
game **state** are granted to `service_role` only. If those were callable from a browser, a
player could simply hand in a state where they had won.
