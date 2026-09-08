import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { PlatformError } from "@/platform/errors";
import type { AnyGameModule, Json, SeatRef } from "@/games/contract/types";
import type { Database } from "@/lib/db.types";

type Session = Database["public"]["Tables"]["game_sessions"]["Row"];

/**
 * Archives a finished session.
 *
 * The module decides who won and what the round is remembered as; the platform
 * only stores it. `summary` is written verbatim and never inspected — that is
 * what keeps the history table free of any one game's vocabulary.
 */
export async function finishSession(params: {
  session: Session;
  mod: AnyGameModule;
  state: unknown;
  seats: readonly SeatRef[];
  expectedRevision: number;
}): Promise<{ resultId: string | null; revision: number }> {
  const { session, mod, state, seats, expectedRevision } = params;
  const admin = getAdminClient();

  const result = mod.getResult(state, seats);

  const players = result.players.map((p) => ({
    user_id: p.userId,
    display_name: p.displayName,
    placement: p.placement,
    score: p.score ?? null,
    payload: p.payload ?? {},
  }));

  const { data: rows, error } = await admin.rpc("finish_session", {
    p_session_id: session.id,
    p_expected_revision: expectedRevision,
    p_final_state: state as Json,
    p_summary: result.summary as Json,
    p_players: players as unknown as Json,
  });

  if (error) throw new PlatformError("server_error", 500, error.message);

  const row = rows?.[0];
  if (!row) throw new PlatformError("server_error", 500, "empty rpc result");

  // Finishing twice is normal: two players can land the winning move within
  // milliseconds of each other. The first write wins and the second is told so.
  if (row.result === "already_finished" || row.result === "finished") {
    return { resultId: row.result_id, revision: row.revision ?? expectedRevision };
  }

  if (row.result === "stale") throw new PlatformError("stale_revision", 409);
  throw new PlatformError("server_error", 500, row.result);
}
