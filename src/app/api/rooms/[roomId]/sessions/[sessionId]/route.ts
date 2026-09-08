import { NextResponse } from "next/server";
import { abortSession } from "@/platform/server/lifecycle";
import { respondWithError } from "@/platform/server/respond";

/** Host ends the round early. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ roomId: string; sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    await abortSession(sessionId);
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return respondWithError(cause);
  }
}
