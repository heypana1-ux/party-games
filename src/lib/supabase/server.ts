import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/db.types";

/*
  The user-scoped server client.

  Reads through this client run as the signed-in person, so RLS decides what
  they may see. The command pipeline uses it to load a session precisely so
  that "is this player in this room?" is answered by the database rather than
  by a hand-written check that someone will forget to add to the next handler.

  `cookies()` is async in Next.js 16 — synchronous access was removed, not
  merely deprecated.
*/
export async function createClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase environment variables are missing.");

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the
          // session instead, so this is safe to ignore here.
        }
      },
    },
  });
}
