import { NextResponse } from "next/server";
import { PlatformError } from "@/platform/errors";
import { applyAction } from "@/platform/server/applyAction";
import { readJson, respondWithError } from "@/platform/server/respond";
import { ActionCommand } from "@/lib/validation/shared";

/*
  The command endpoint. Every move in every game arrives here.

  The body carries an intent and an idempotency key — never a state, never an
  actor, never an outcome. Who is acting comes from the session cookie.
*/
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string; sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const parsed = ActionCommand.safeParse(await readJson(request));
    if (!parsed.success) throw new PlatformError("invalid_action", 422);

    const result = await applyAction({
      sessionId,
      clientActionId: parsed.data.clientActionId,
      expectedRevision: parsed.data.expectedRevision,
      action: parsed.data.action,
    });

    return NextResponse.json(result);
  } catch (cause) {
    return respondWithError(cause);
  }
}
