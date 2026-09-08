"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { joinRoom } from "@/platform/rooms/client";
import { useStoredName } from "@/platform/auth/useStoredName";
import { ROOM_CODE_ALPHABET } from "@/lib/validation/shared";

const MESSAGES: Record<string, string> = {
  invalid_code: "No room with that code. Check it and try again.",
  invalid_name: "Pick a name between 2 and 24 characters.",
  name_taken: "Someone in that room already uses this name.",
  rate_limited: "Too many tries. Wait a minute, then have another go.",
};

export function JoinForm({ initialCode }: { initialCode: string }) {
  const router = useRouter();
  const [storedName, setStoredName] = useStoredName();
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const nameValue = name || storedName;

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const outcome = await joinRoom(code, nameValue);
        if (outcome.status === "joined" || outcome.status === "rejoined") {
          setStoredName(nameValue.trim());
          router.push(`/room/${outcome.code}`);
          return;
        }
        setError(MESSAGES[outcome.status] ?? "Could not join.");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not join.");
      }
    });
  }

  return (
    <main className="h-screen-safe mx-auto flex max-w-md flex-col px-5 pt-safe">
      <div className="flex flex-1 flex-col justify-center py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Join a room</h1>
        <p className="mt-2 text-ink-muted">
          Ask the host for the six-character code on their screen.
        </p>

        <form
          className="mt-8 flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">Room code</Label>
            <Input
              id="code"
              autoFocus={!initialCode}
              value={code}
              onChange={(event) =>
                setCode(
                  event.target.value
                    .toUpperCase()
                    // Quietly drop characters the alphabet does not contain, so
                    // a mistyped O or l does not become a failed attempt.
                    .split("")
                    .filter((ch) => ROOM_CODE_ALPHABET.includes(ch))
                    .join("")
                    .slice(0, 6),
                )
              }
              maxLength={6}
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="ABC234"
              className="text-center text-3xl tracking-[0.35em] font-semibold tabular"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="join-name">Your name</Label>
            <Input
              id="join-name"
              autoFocus={Boolean(initialCode)}
              maxLength={24}
              autoComplete="nickname"
              placeholder="e.g. Alex"
              value={nameValue}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="block"
            disabled={busy || code.length !== 6 || nameValue.trim().length < 2}
          >
            {busy ? <Spinner className="border-t-accent-ink" /> : "Join"}
          </Button>
        </form>
      </div>

      <div className="pb-6 text-center">
        <Link href="/" className="text-sm text-ink-faint hover:text-ink-muted">
          Back
        </Link>
      </div>
    </main>
  );
}
