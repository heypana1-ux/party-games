import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createRng, createSeed } from "@/games/contract/rng";
import { getModule } from "@/games/registry";
import { PlatformError } from "@/platform/errors";
import { requireActor } from "@/platform/server/context";
import type { ActionContext, Json, SeatRef } from "@/games/contract/types";

export interface StartSessionInput {
  readonly roomId: string;
  readonly gameId: string;
  readonly config: unknown;
  /** Optional explicit seating. Defaults to everyone present who is playing. */
  readonly seatedUserIds?: readonly string[];
}

export interface StartSessionOutput {
  readonly sessionId: string;
  readonly revision: number;
}

export async function startSession(
  input: StartSessionInput,
): Promise<StartSessionOutput> {
  const actor = await requireActor();
  const supabase = await createClient();

  // Read as the caller: a non-member sees no room and gets no further.
  const { data: room } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", input.roomId)
    .maybeSingle();

  if (!room) throw new PlatformError("not_a_member", 403);
  if (room.host_id !== actor.userId) throw new PlatformError("not_host", 403);
  if (room.status !== "lobby") throw new PlatformError("conflict", 409, "room_busy");

  const mod = getModule(input.gameId);
  if (!mod) throw new PlatformError("module_unavailable", 409, input.gameId);

  const parsedConfig = mod.schemas.config.safeParse(input.config);
  if (!parsedConfig.success) throw new PlatformError("invalid_action", 422, "invalid_config");

  const { data: members } = await supabase
    .from("room_members")
    .select("user_id, display_name, is_spectator")
    .eq("room_id", input.roomId)
    .is("left_at", null)
    .order("joined_at", { ascending: true });

  const eligible = (members ?? []).filter((m) => !m.is_spectator);
  const chosen = input.seatedUserIds
    ? eligible.filter((m) => input.seatedUserIds!.includes(m.user_id))
    : eligible;

  if (chosen.length < mod.meta.minPlayers) {
    throw new PlatformError("invalid_action", 422, "too_few_players");
  }
  if (chosen.length > mod.meta.maxPlayers) {
    throw new PlatformError("invalid_action", 422, "too_many_players");
  }

  const seats: SeatRef[] = chosen.map((m, index) => ({
    userId: m.user_id,
    seatIndex: index,
    // Snapshotted: a rename mid-game must not change what the reducer saw.
    displayName: m.display_name,
  }));

  // One seed per session, drawn once and stored. Every RNG draw for the whole
  // game derives from it, which is what makes the log replayable.
  const seed = createSeed();

  const ctx: ActionContext = {
    sessionId: "pending",
    seq: 0,
    now: Date.now(),
    rng: createRng(seed, 0),
    actor: null,
    players: seats,
    hostUserId: room.host_id,
  };

  const initialState = mod.createInitialState({
    config: parsedConfig.data,
    players: seats,
    ctx,
  });

  const stateCheck = mod.schemas.state.safeParse(initialState);
  if (!stateCheck.success) {
    throw new PlatformError("server_error", 500, "module produced an invalid initial state");
  }

  const admin = getAdminClient();
  const { data: rows, error } = await admin.rpc("start_session", {
    p_room_id: input.roomId,
    p_host: actor.userId,
    p_game_id: mod.meta.id,
    p_module_version: mod.meta.moduleVersion,
    p_state_version: mod.meta.stateVersion,
    p_config: parsedConfig.data as Json,
    p_seed: seed,
    p_initial_state: initialState as Json,
    p_players: seats.map((s) => ({
      user_id: s.userId,
      seat_index: s.seatIndex,
      display_name: s.displayName,
    })) as unknown as Json,
  });

  if (error) throw new PlatformError("server_error", 500, error.message);
  const row = rows?.[0];
  if (!row) throw new PlatformError("server_error", 500, "empty rpc result");

  if (row.result === "not_host") throw new PlatformError("not_host", 403);
  if (row.result === "not_found") throw new PlatformError("room_gone", 410);
  if (row.result === "room_busy" || row.result === "already_running") {
    throw new PlatformError("conflict", 409, row.result);
  }
  if (!row.session_id) throw new PlatformError("server_error", 500, "no session id");

  return { sessionId: row.session_id, revision: row.revision ?? 0 };
}
