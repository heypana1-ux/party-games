import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { createRng } from "@/games/contract/rng";
import { PlatformError } from "@/platform/errors";
import { loadSessionForActor, requireActor } from "@/platform/server/context";
import { loadCurrentState, resolveModule } from "@/platform/server/module";
import { finishSession } from "@/platform/server/finish";
import type { ActionContext, AnyGameModule, Json } from "@/games/contract/types";

/*
  The command pipeline.

  This is the single place where a game's state changes, and the order of the
  steps is the security model:

    1. establish who is calling, from the session cookie
    2. load the session AS THEM, so RLS proves membership
    3. find the module and lift the state to the current version
    4. parse the action against the module's own schema
    5. ask the module whether this actor may do this now
    6. run the reducer — pure, on the server, on state the client never touched
    7. commit with a compare-and-swap, retrying if we lost the race

  A client is never trusted for anything except "here is what I would like to
  do". It cannot supply a state, an actor, a revision it did not read, or an
  outcome.
*/

const MAX_ATTEMPTS = 3;

export interface ApplyActionInput {
  readonly sessionId: string;
  readonly clientActionId: string;
  /** What the client believed the revision was. Informational: the server
   *  re-evaluates against whatever the truth is now. */
  readonly expectedRevision: number;
  readonly action: unknown;
}

export interface ApplyActionOutput {
  readonly revision: number;
  readonly seq: number | null;
  readonly duplicate: boolean;
  readonly finished: boolean;
  readonly resultId: string | null;
  /** True when the client was behind, so it knows to trust the snapshot. */
  readonly wasBehind: boolean;
}

export async function applyAction(input: ApplyActionInput): Promise<ApplyActionOutput> {
  const actor = await requireActor();
  const loaded = await loadSessionForActor(input.sessionId, actor);

  if (loaded.session.status === "finished" || loaded.session.status === "aborted") {
    throw new PlatformError("session_gone", 410);
  }

  const mod = resolveModule(loaded.session);

  // The action is untrusted JSON off the wire. Nothing downstream may see it
  // before the module's own schema has accepted it.
  const parsed = mod.schemas.action.safeParse(input.action);
  if (!parsed.success) throw new PlatformError("invalid_action", 422);
  const action = parsed.data;

  if (!loaded.actorSeat) throw new PlatformError("not_seated", 403);

  const admin = getAdminClient();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const current = await loadCurrentState(loaded.session, mod);
    if (current.status === "finished" || current.status === "aborted") {
      throw new PlatformError("session_gone", 410);
    }

    const actedAt = new Date();
    const ctx: ActionContext = {
      sessionId: loaded.session.id,
      seq: current.nextSeq,
      now: actedAt.getTime(),
      rng: createRng(loaded.session.seed, current.nextSeq),
      actor: loaded.actorSeat,
      players: loaded.seats,
      hostUserId: loaded.room.host_id,
    };

    const verdict = mod.authorize(current.state, action, ctx);
    if (!verdict.ok) throw new PlatformError("not_authorized", 403, verdict.reason);

    const nextState = runReducer(mod, current.state, action, ctx);
    const finished = mod.isFinished(nextState);

    const { data: rows, error } = await admin.rpc("apply_game_action", {
      p_session_id: loaded.session.id,
      p_expected_revision: current.revision,
      p_client_action_id: input.clientActionId,
      p_actor: actor.userId,
      p_action: action as Json,
      p_new_state: nextState as Json,
      p_new_status: null,
      // The instant the reducer saw, not the database's. Replay depends on it.
      p_acted_at: actedAt.toISOString(),
    });

    if (error) {
      // 40001 is the deliberate abort for two identical action ids racing.
      // Retrying takes the idempotent path and returns the original outcome.
      if (error.code === "40001" && attempt < MAX_ATTEMPTS) continue;
      throw new PlatformError("server_error", 500, error.message);
    }

    const row = rows?.[0];
    if (!row) throw new PlatformError("server_error", 500, "empty rpc result");

    if (row.result === "rate_limited") throw new PlatformError("rate_limited", 429);

    if (row.result === "duplicate") {
      return {
        revision: row.revision ?? current.revision,
        seq: row.seq,
        duplicate: true,
        finished: false,
        resultId: null,
        wasBehind: input.expectedRevision !== current.revision,
      };
    }

    if (row.result === "stale") {
      // Somebody committed between our read and our write. Their action is
      // now part of the truth, so recompute ours against it rather than
      // overwriting a state we never evaluated.
      if (attempt < MAX_ATTEMPTS) continue;
      throw new PlatformError("stale_revision", 409);
    }

    const revision = row.revision ?? current.revision + 1;

    if (finished) {
      const outcome = await finishSession({
        session: loaded.session,
        mod,
        state: nextState,
        seats: loaded.seats,
        expectedRevision: revision,
      });
      return {
        revision: outcome.revision,
        seq: row.seq,
        duplicate: false,
        finished: true,
        resultId: outcome.resultId,
        wasBehind: input.expectedRevision !== current.revision,
      };
    }

    return {
      revision,
      seq: row.seq,
      duplicate: false,
      finished: false,
      resultId: null,
      wasBehind: input.expectedRevision !== current.revision,
    };
  }

  throw new PlatformError("conflict", 409);
}

/**
 * A reducer is allowed to throw on a move it considers impossible. That is a
 * rejected command, not a server fault — the distinction decides whether the
 * player sees "that move isn't allowed" or "something went wrong".
 */
function runReducer(
  mod: AnyGameModule,
  state: unknown,
  action: unknown,
  ctx: ActionContext,
): unknown {
  try {
    return mod.reduce(state, action, ctx);
  } catch (cause) {
    throw new PlatformError(
      "invalid_action",
      422,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}
