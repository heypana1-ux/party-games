"use client";

import { getBrowserClient } from "@/lib/supabase/browser";
import { ensureIdentity } from "@/platform/auth/identity";
import { DisplayName, RoomCode } from "@/lib/validation/shared";

/*
  Room operations.

  These call the RPCs directly rather than going through a Route Handler,
  because they take only parameters the database can check for itself — a code,
  a name, a room id. Nothing here accepts a game state, which is exactly the
  line that decides whether an RPC may be reachable from a phone.
*/

export type JoinOutcome =
  | { status: "joined" | "rejoined"; roomId: string; code: string; isSpectator: boolean }
  | { status: "invalid_code" | "invalid_name" | "name_taken" | "rate_limited" };

export async function createRoom(displayName: string): Promise<{ roomId: string; code: string }> {
  const name = DisplayName.parse(displayName);
  await ensureIdentity();

  const supabase = getBrowserClient();
  const { data, error } = await supabase.rpc("create_room", {
    p_display_name: name,
    p_settings: {},
  });

  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) throw new Error("Room could not be created.");
  return { roomId: row.room_id, code: row.code };
}

export async function joinRoom(code: string, displayName: string): Promise<JoinOutcome> {
  const parsedCode = RoomCode.safeParse(code);
  if (!parsedCode.success) return { status: "invalid_code" };

  const parsedName = DisplayName.safeParse(displayName);
  if (!parsedName.success) return { status: "invalid_name" };

  await ensureIdentity();

  const supabase = getBrowserClient();
  const { data, error } = await supabase.rpc("join_room", {
    p_code: parsedCode.data,
    p_display_name: parsedName.data,
  });

  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) return { status: "invalid_code" };

  if (row.result === "joined" || row.result === "rejoined") {
    return {
      status: row.result,
      roomId: row.room_id!,
      code: parsedCode.data,
      isSpectator: row.is_spectator ?? false,
    };
  }
  return { status: row.result };
}

export async function leaveRoom(roomId: string) {
  const { data, error } = await getBrowserClient().rpc("leave_room", { p_room: roomId });
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

export async function sendHeartbeat(roomId: string) {
  await getBrowserClient().rpc("heartbeat", { p_room: roomId });
}

export async function transferHost(roomId: string, toUserId: string) {
  const { data, error } = await getBrowserClient().rpc("transfer_host", {
    p_room: roomId,
    p_to: toUserId,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Take over an abandoned room. Succeeds only if the host really has gone. */
export async function claimHost(roomId: string) {
  const { data, error } = await getBrowserClient().rpc("claim_host", {
    p_room: roomId,
    p_stale_seconds: 45,
  });
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}
