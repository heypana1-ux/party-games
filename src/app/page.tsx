import Link from "next/link";
import { Gamepad2, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateRoomForm } from "@/components/shell/CreateRoomForm";

/*
  Landing.

  Two things happen here and nothing else: start a room, or join one. Both
  actions sit low on the screen where a thumb reaches them.
*/
export default function HomePage() {
  return (
    <main className="h-screen-safe mx-auto flex max-w-md flex-col px-5 pt-safe">
      <header className="flex flex-1 flex-col justify-center py-12">
        <p className="text-sm font-medium tracking-[0.2em] text-gold uppercase">
          Party Games
        </p>
        <h1 className="mt-3 text-4xl leading-tight font-semibold tracking-tight">
          One room.
          <br />
          Everyone&apos;s phone.
        </h1>
        <p className="mt-4 text-ink-muted">
          Start a room, share the code, and pick something to play. No account
          needed — a name is enough.
        </p>
      </header>

      <div className="flex flex-col gap-3 pb-6">
        <CreateRoomForm />

        <Button asChild variant="surface" size="block">
          <Link href="/join">Join with a code</Link>
        </Button>

        <div className="mt-2 flex justify-center gap-6 text-sm text-ink-faint">
          <Link href="/games" className="flex items-center gap-1.5 hover:text-ink-muted">
            <Gamepad2 className="h-4 w-4" /> Games
          </Link>
          <Link href="/history" className="flex items-center gap-1.5 hover:text-ink-muted">
            <History className="h-4 w-4" /> History
          </Link>
        </div>
      </div>
    </main>
  );
}

export const dynamic = "force-static";
