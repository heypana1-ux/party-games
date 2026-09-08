import { NextResponse } from "next/server";
import { undoLastAction } from "@/platform/server/undo";
import { respondWithError } from "@/platform/server/respond";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ roomId: string; sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    return NextResponse.json(await undoLastAction(sessionId));
  } catch (cause) {
    return respondWithError(cause);
  }
}
