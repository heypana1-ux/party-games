import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db.types";

/*
  The service-role client.

  This exists for exactly one reason: the RPCs that accept a game *state* are
  granted to `service_role` and to nobody else. The command pipeline verifies
  who is acting with the user-scoped client first, then uses this client to
  commit the state the reducer produced.

  `server-only` makes importing this from a client component a build error
  rather than a leaked key.
*/

let admin: ReturnType<typeof createClient<Database>> | null = null;

export function getAdminClient() {
  if (!admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is missing. The command pipeline cannot write game state without it.",
      );
    }
    admin = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
