"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { createRoom } from "@/platform/rooms/client";
import { useStoredName } from "@/platform/auth/useStoredName";
import { DisplayName } from "@/lib/validation/shared";

export function CreateRoomForm() {
  const router = useRouter();
  const [storedName, setStoredName] = useStoredName();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const value = name || storedName;

  function submit() {
    const parsed = DisplayName.safeParse(value);
    if (!parsed.success) {
      setError("Pick a name between 2 and 24 characters.");
      return;
    }
    setError(null);
    setStoredName(parsed.data);

    startTransition(async () => {
      try {
        const { code } = await createRoom(parsed.data);
        router.push(`/room/${code}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not create the room.");
      }
    });
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="host" size="block">
          <Plus className="h-5 w-5" /> Start a room
        </Button>
      </SheetTrigger>

      <SheetContent title="What should everyone call you?">
        <form
          className="flex flex-col gap-4 pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="host-name">Your name</Label>
            <Input
              id="host-name"
              autoFocus
              maxLength={24}
              autoComplete="nickname"
              placeholder="e.g. Sam"
              value={value}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" variant="host" size="lg" disabled={busy}>
            {busy ? <Spinner className="border-t-gold-ink" /> : "Create the room"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
