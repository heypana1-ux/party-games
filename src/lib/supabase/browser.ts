"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db.types";

/*
  The browser client. Reads with it; never writes game state with it — there are
  no write policies for it to use, by design.

  Cookie-backed (not localStorage) so the same session is visible to Route
  Handlers and Server Components. That is what lets the server know who is
  acting without the client telling it.
*/

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getBrowserClient() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error(
        "Supabase is not configured. Copy .env.example to .env.local and fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
    }
    client = createBrowserClient<Database>(url, key);
  }
  return client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
