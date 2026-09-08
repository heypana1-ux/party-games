import "server-only";

import { getModule } from "@/games/registry";
import { PlatformError } from "@/platform/errors";
import { getAdminClient } from "@/lib/supabase/admin";
import type { AnyGameModule, Json } from "@/games/contract/types";
import type { Database } from "@/lib/db.types";

type Session = Database["public"]["Tables"]["game_sessions"]["Row"];

/**
 * Finds the module a session belongs to, and refuses clearly when it cannot.
 *
 * Three failure modes matter here, and conflating them would leave players
 * staring at a spinner:
 *   - the game was removed from the build entirely
 *   - the stored state is newer than this deployment understands
 *   - the stored state is older and needs lifting first
 */
export function resolveModule(session: Session): AnyGameModule {
  const mod = getModule(session.game_id);
  if (!mod) throw new PlatformError("module_unavailable", 409, session.game_id);

  if (session.state_version > mod.meta.stateVersion) {
    // This server is behind the state, not the other way round. Refusing is the
    // only safe answer: a reducer from an older version would misread the state.
    throw new PlatformError("update_required", 426, session.game_id);
  }
  return mod;
}

export interface CurrentState {
  readonly state: unknown;
  readonly revision: number;
  readonly nextSeq: number;
  readonly status: Session["status"];
}

/**
 * Reads the authoritative state, migrating it first if the module has moved on.
 *
 * The migration is persisted as its own revision bump rather than being applied
 * on the fly for each request, so every client converges on the new shape and
 * the work happens once.
 */
export async function loadCurrentState(
  session: Session,
  mod: AnyGameModule,
): Promise<CurrentState> {
  const admin = getAdminClient();

  const { data: fresh, error } = await admin
    .from("game_sessions")
    .select("state, initial_state, revision, next_seq, status, state_version")
    .eq("id", session.id)
    .maybeSingle();

  if (error || !fresh) throw new PlatformError("session_gone", 410);

  if (fresh.state_version === mod.meta.stateVersion) {
    return {
      state: fresh.state,
      revision: fresh.revision,
      nextSeq: fresh.next_seq,
      status: fresh.status,
    };
  }

  if (!mod.migrate) {
    throw new PlatformError("module_unavailable", 409, "no migration path");
  }

  const migrated = mod.migrate(fresh.state, fresh.state_version);
  // The starting snapshot is migrated alongside the live one, because undo
  // replays the log from it and a stale shape there would surface much later
  // as a corrupted state rather than as an error here.
  const migratedInitial = mod.migrate(fresh.initial_state, fresh.state_version);

  const check = mod.schemas.state.safeParse(migrated);
  const initialCheck = mod.schemas.state.safeParse(migratedInitial);
  if (!check.success || !initialCheck.success) {
    throw new PlatformError("module_unavailable", 409, "migration produced an invalid state");
  }

  const { data: rows } = await admin.rpc("migrate_session_state", {
    p_session_id: session.id,
    p_expected_revision: fresh.revision,
    p_new_state: migrated as Json,
    p_new_initial_state: migratedInitial as Json,
    p_state_version: mod.meta.stateVersion,
    p_module_version: mod.meta.moduleVersion,
  });

  const row = rows?.[0];
  if (!row || row.result !== "migrated" || row.revision === null) {
    // Someone migrated it underneath us; read again rather than fight over it.
    return loadCurrentState(session, mod);
  }

  return {
    state: migrated,
    revision: row.revision,
    nextSeq: fresh.next_seq,
    status: fresh.status,
  };
}
