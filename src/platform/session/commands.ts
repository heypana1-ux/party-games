"use client";

import type { DispatchResult } from "@/games/contract/types";

/*
  The client half of the command pipeline.

  Every call carries a `clientActionId` minted once per user intent. If the
  network drops and the request is retried, the id comes along unchanged, so
  the server recognises the retry and applies the move exactly once. Minting a
  fresh id per attempt would turn one tap into three.
*/

export interface ActionResponse {
  revision: number;
  seq: number | null;
  duplicate: boolean;
  finished: boolean;
  resultId: string | null;
  wasBehind: boolean;
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new CommandError(
      typeof payload.error === "string" ? payload.error : "server_error",
      typeof payload.message === "string" ? payload.message : "Something went wrong.",
    );
  }
  return payload as T;
}

export class CommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

export function sendAction(
  roomId: string,
  sessionId: string,
  input: { clientActionId: string; expectedRevision: number; action: unknown },
): Promise<ActionResponse> {
  return post<ActionResponse>(
    `/api/rooms/${roomId}/sessions/${sessionId}/actions`,
    input,
  );
}

export function startSession(
  roomId: string,
  input: { gameId: string; config: unknown; seatedUserIds?: string[] },
): Promise<{ sessionId: string; revision: number }> {
  return post(`/api/rooms/${roomId}/sessions`, input);
}

export function undo(
  roomId: string,
  sessionId: string,
): Promise<{ revision: number; undoneSeq: number }> {
  return post(`/api/rooms/${roomId}/sessions/${sessionId}/undo`);
}

export async function abortSession(roomId: string, sessionId: string): Promise<void> {
  const response = await fetch(`/api/rooms/${roomId}/sessions/${sessionId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new CommandError(payload.error ?? "server_error", "Could not end the round.");
  }
}

export function ok(revision: number): DispatchResult {
  return { ok: true, revision };
}
