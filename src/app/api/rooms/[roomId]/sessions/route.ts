import { NextResponse } from "next/server";
import { PlatformError } from "@/platform/errors";
import { startSession } from "@/platform/server/startSession";
import { readJson, respondWithError } from "@/platform/server/respond";
import { StartSessionCommand } from "@/lib/validation/shared";

/** Host starts a game. `params` is a Promise in Next.js 16. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  try {
    const { roomId } = await params;
    const parsed = StartSessionCommand.safeParse(await readJson(request));
    if (!parsed.success) throw new PlatformError("invalid_action", 422);

    const result = await startSession({
      roomId,
      gameId: parsed.data.gameId,
      config: parsed.data.config,
      seatedUserIds: parsed.data.seatedUserIds,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (cause) {
    return respondWithError(cause);
  }
}
