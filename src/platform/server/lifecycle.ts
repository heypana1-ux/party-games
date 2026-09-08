import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { PlatformError } from "@/platform/errors";
import { loadSessionForActor, requireActor } from "@/platform/server/context";

/** Host ends the round early. The session is archived as aborted, with no
 *  result row — an abandoned game is not a match anyone won. */
export async function abortSession(sessionId: string): Promise<void> {
  const actor = await requireActor();
  const loaded = await loadSessionForActor(sessionId, actor);
  if (!loaded.isHost) throw new PlatformError("not_host", 403);

  const admin = getAdminClient();
  const { data, error } = await admin.rpc("abort_session", {
    p_session_id: sessionId,
    p_actor: actor.userId,
  });

  if (error) throw new PlatformError("server_error", 500, error.message);
  if (data === "not_host") throw new PlatformError("not_host", 403);
  if (data === "not_found") throw new PlatformError("session_gone", 410);
}
