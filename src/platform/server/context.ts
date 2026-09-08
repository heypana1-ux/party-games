import "server-only";

import { createClient } from "@/lib/supabase/server";
import { PlatformError } from "@/platform/errors";
import type { Database } from "@/lib/db.types";
import type { SeatRef } from "@/games/contract/types";

type Session = Database["public"]["Tables"]["game_sessions"]["Row"];
type Room = Database["public"]["Tables"]["rooms"]["Row"];

export interface Actor {
  readonly userId: string;
  readonly isAnonymous: boolean;
}

/**
 * Who is calling.
 *
 * The id comes from the verified session cookie and from nowhere else — never
 * from a request body, a header the client controls, or a query parameter.
 * Every authorisation decision downstream starts here.
 */
export async function requireActor(): Promise<Actor> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new PlatformError("not_authenticated", 401);
  return {
    userId: data.user.id,
    isAnonymous: data.user.is_anonymous ?? false,
  };
}

export interface LoadedSession {
  readonly session: Session;
  readonly room: Room;
  readonly seats: readonly SeatRef[];
  readonly actorSeat: SeatRef | null;
  readonly isHost: boolean;
}

/**
 * Loads a session as the caller.
 *
 * Deliberately uses the user-scoped client: if the caller is not a member of
 * the room, RLS returns nothing and the read fails. Membership is therefore
 * enforced by the database on every single command, rather than by a check
 * each new handler has to remember to write.
 */
export async function loadSessionForActor(
  sessionId: string,
  actor: Actor,
): Promise<LoadedSession> {
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("game_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) throw new PlatformError("not_a_member", 403);

  const { data: room } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", session.room_id)
    .maybeSingle();

  if (!room) throw new PlatformError("room_gone", 410);

  const { data: players } = await supabase
    .from("session_players")
    .select("user_id, seat_index, display_name")
    .eq("session_id", sessionId)
    .order("seat_index", { ascending: true });

  const seats: SeatRef[] = (players ?? []).map((p) => ({
    userId: p.user_id,
    seatIndex: p.seat_index,
    displayName: p.display_name,
  }));

  return {
    session,
    room,
    seats,
    actorSeat: seats.find((s) => s.userId === actor.userId) ?? null,
    isHost: room.host_id === actor.userId,
  };
}
