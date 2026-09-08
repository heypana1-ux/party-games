import type { SeatRef } from "@/games/contract/types";
import type { RoomStatus, SessionStatus } from "@/lib/db.types";

export interface RoomInfo {
  readonly id: string;
  readonly code: string;
  readonly status: RoomStatus;
  readonly hostId: string;
  readonly settings: Record<string, unknown>;
}

export type Presence = "online" | "away" | "disconnected";

export interface MemberInfo {
  readonly userId: string;
  readonly displayName: string;
  readonly isSpectator: boolean;
  readonly joinedAt: string;
  readonly lastSeenAt: string;
  readonly presence: Presence;
  readonly isHost: boolean;
}

export interface SessionInfo {
  readonly id: string;
  readonly gameId: string;
  readonly moduleVersion: string;
  readonly stateVersion: number;
  readonly status: SessionStatus;
  readonly state: unknown;
  readonly revision: number;
  readonly seats: readonly SeatRef[];
}

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline";

/** What the room is currently showing. Derived from room + session status so a
 *  realtime update can never leave the route and the state disagreeing. */
export type RoomPhase = "lobby" | "setup" | "play" | "result";

export const HEARTBEAT_MS = 15_000;
export const AWAY_AFTER_MS = 30_000;
export const DISCONNECTED_AFTER_MS = 90_000;
export const HOST_STALE_SECONDS = 45;

export function presenceOf(lastSeenAt: string, now: number): Presence {
  const age = now - new Date(lastSeenAt).getTime();
  if (age > DISCONNECTED_AFTER_MS) return "disconnected";
  if (age > AWAY_AFTER_MS) return "away";
  return "online";
}
