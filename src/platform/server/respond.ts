import "server-only";

import { NextResponse } from "next/server";
import { ERROR_STATUS, PlatformError, errorMessage } from "@/platform/errors";

/**
 * One error shape for every handler.
 *
 * `detail` is included because it is diagnostic, never secret: it says which
 * rule refused an action, not anything about other players or the database.
 */
export function respondWithError(cause: unknown): NextResponse {
  if (cause instanceof PlatformError) {
    return NextResponse.json(
      { error: cause.code, message: errorMessage(cause.code), detail: cause.detail },
      { status: cause.status || ERROR_STATUS[cause.code] },
    );
  }

  console.error("[party-games] unhandled error", cause);
  return NextResponse.json(
    { error: "server_error", message: errorMessage("server_error") },
    { status: 500 },
  );
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
