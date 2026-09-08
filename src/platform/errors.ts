/*
  One vocabulary of failures, shared by the server and the client.

  Every one of these has a defined consequence in the UI, which is why they are
  a closed union rather than free-text messages: a new failure mode has to be
  given a meaning before it can be thrown.
*/
export const PLATFORM_ERRORS = {
  not_authenticated: "You are not signed in.",
  not_a_member: "You are not in this room.",
  not_host: "Only the host can do that.",
  not_seated: "You are watching this round, not playing it.",
  invalid_action: "That move does not make sense here.",
  not_authorized: "You are not allowed to do that right now.",
  stale_revision: "The game moved on. Catching up…",
  conflict: "Someone got there first.",
  rate_limited: "Slow down a moment.",
  session_gone: "This round has ended.",
  room_gone: "This room is closed.",
  module_unavailable: "This game is no longer available.",
  update_required: "Update the app to keep playing.",
  offline: "No connection.",
  server_error: "Something went wrong on our side.",
} as const;

export type PlatformErrorCode = keyof typeof PLATFORM_ERRORS;

export function isPlatformErrorCode(value: unknown): value is PlatformErrorCode {
  return typeof value === "string" && value in PLATFORM_ERRORS;
}

export function errorMessage(code: string): string {
  return isPlatformErrorCode(code) ? PLATFORM_ERRORS[code] : PLATFORM_ERRORS.server_error;
}

export class PlatformError extends Error {
  constructor(
    readonly code: PlatformErrorCode,
    readonly status: number = 400,
    readonly detail?: string,
  ) {
    super(code);
    this.name = "PlatformError";
  }
}

/** HTTP status for each code, so handlers do not each invent their own. */
export const ERROR_STATUS: Record<PlatformErrorCode, number> = {
  not_authenticated: 401,
  not_a_member: 403,
  not_host: 403,
  not_seated: 403,
  invalid_action: 422,
  not_authorized: 403,
  stale_revision: 409,
  conflict: 409,
  rate_limited: 429,
  session_gone: 410,
  room_gone: 410,
  module_unavailable: 409,
  update_required: 426,
  offline: 503,
  server_error: 500,
};
