import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createRng } from "@/games/contract/rng";
import { PlatformError } from "@/platform/errors";
import { loadSessionForActor, requireActor } from "@/platform/server/context";
import { loadCurrentState, resolveModule } from "@/platform/server/module";
import type { ActionContext, AnyGameModule, Json, SeatRef } from "@/games/contract/types";

/*
  Undo.

  Games do not implement it. They are not asked for an inverse of "deal seven
  cards and shuffle the rest", because writing correct inverses is where undo
  implementations go wrong. Instead the platform marks the last action as undone
  and folds the surviving log from the starting snapshot.

  That works only because reducers are pure and every random draw is keyed to
  an action's `seq`, which is never reissued. Every surviving action therefore
  replays with exactly the draw it was originally decided with.
*/

const MAX_ATTEMPTS = 3;

export interface UndoOutput {
  readonly revision: number;
  readonly undoneSeq: number;
}

export async function undoLastAction(sessionId: string): Promise<UndoOutput> {
  const actor = await requireActor();
  const loaded = await loadSessionForActor(sessionId, actor);

  // Undo rewrites what everyone in the room is looking at, so it is the host's
  // call, not any player's.
  if (!loaded.isHost) throw new PlatformError("not_host", 403);
  if (loaded.session.status !== "running") throw new PlatformError("session_gone", 410);

  const mod = resolveModule(loaded.session);
  const admin = getAdminClient();
  const supabase = await createClient();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const current = await loadCurrentState(loaded.session, mod);

    const { data: log } = await supabase
      .from("game_actions")
      .select("seq, action, actor_user_id, acted_at")
      .eq("session_id", sessionId)
      .is("undone_at", null)
      .order("seq", { ascending: true });

    const actions = log ?? [];
    const last = actions[actions.length - 1];
    if (!last) throw new PlatformError("invalid_action", 422, "nothing_to_undo");

    if (mod.canUndo && !mod.canUndo(current.state, last.action)) {
      throw new PlatformError("not_authorized", 403, "undo_not_allowed");
    }

    const replayed = replay(mod, loaded.session.initial_state, actions.slice(0, -1), {
      sessionId,
      seed: loaded.session.seed,
      seats: loaded.seats,
      hostUserId: loaded.room.host_id,
    });

    const { data: rows, error } = await admin.rpc("undo_last_action", {
      p_session_id: sessionId,
      p_expected_revision: current.revision,
      p_undo_seq: last.seq,
      p_new_state: replayed as Json,
    });

    if (error) throw new PlatformError("server_error", 500, error.message);
    const row = rows?.[0];
    if (!row) throw new PlatformError("server_error", 500, "empty rpc result");

    if (row.result === "nothing_to_undo") {
      throw new PlatformError("invalid_action", 422, "nothing_to_undo");
    }
    if (row.result === "stale") {
      // A move landed while we were folding. Fold again against the new log.
      if (attempt < MAX_ATTEMPTS) continue;
      throw new PlatformError("stale_revision", 409);
    }

    return { revision: row.revision ?? current.revision + 1, undoneSeq: last.seq };
  }

  throw new PlatformError("conflict", 409);
}

interface ReplayEnv {
  readonly sessionId: string;
  readonly seed: string;
  readonly seats: readonly SeatRef[];
  readonly hostUserId: string;
}

interface LoggedAction {
  seq: number;
  /** Straight out of jsonb, so untyped until the module's schema accepts it. */
  action: unknown;
  actor_user_id: string | null;
  acted_at: string;
}

/**
 * Folds an action log back into a state.
 *
 * Each action is re-validated on the way through. A module that dropped an
 * action type it used to accept would otherwise replay into a corrupted state;
 * failing loudly here means the worst case is a refused undo, not a wrong game.
 */
function replay(
  mod: AnyGameModule,
  initialState: unknown,
  actions: readonly LoggedAction[],
  env: ReplayEnv,
): unknown {
  let state = initialState;

  for (const entry of actions) {
    const parsed = mod.schemas.action.safeParse(entry.action);
    if (!parsed.success) {
      throw new PlatformError(
        "module_unavailable",
        409,
        `action at seq ${entry.seq} is no longer valid for ${mod.meta.id}@${mod.meta.moduleVersion}`,
      );
    }

    const ctx: ActionContext = {
      sessionId: env.sessionId,
      seq: entry.seq,
      // Both taken from the log, never from the clock or a fresh draw.
      now: new Date(entry.acted_at).getTime(),
      rng: createRng(env.seed, entry.seq),
      actor: env.seats.find((s) => s.userId === entry.actor_user_id) ?? null,
      players: env.seats,
      hostUserId: env.hostUserId,
    };

    state = mod.reduce(state, parsed.data, ctx);
  }

  return state;
}
