"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { DoorOpen, Share2, Undo2, X } from "lucide-react";
import { phaseVariants } from "@/components/motion/presets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ConnectionBanner } from "@/components/shell/ConnectionBanner";
import { PlayerList } from "@/components/shell/PlayerList";
import { HostBar } from "@/components/shell/HostBar";
import { GamePicker } from "@/components/shell/GamePicker";
import { ResultView } from "@/components/shell/ResultView";
import { ErrorState, LoadingState } from "@/components/shell/States";
import { GameSlot } from "@/platform/session/GameSlot";
import { useRoom } from "@/platform/session/RoomProvider";
import { abortSession, undo } from "@/platform/session/commands";
import { leaveRoom } from "@/platform/rooms/client";
import { getMeta } from "@/games/registry";
import { formatRoomCode } from "@/lib/utils";

/*
  One route, four phases.

  Lobby, setup, play and result are states of this component rather than
  separate routes. With separate routes a realtime update would move the page
  out from under whoever is looking at it, and the browser back button would
  drop a player into the lobby mid-game. Here the phase always follows the
  room and session status, so the screen and the truth cannot disagree.
*/
export function RoomExperience() {
  const room = useRoom();
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [leaving, setLeaving] = useState(false);
  // The host dismisses the standings to get back to the game picker. Players
  // keep seeing them until a new round actually starts, which is the more
  // useful thing to look at while the host decides.
  const [dismissedResult, setDismissedResult] = useState<string | null>(null);

  const handleUndo = useCallback(() => {
    if (!room.room || !room.session) return;
    startTransition(async () => {
      await undo(room.room!.id, room.session!.id).catch(() => {});
    });
  }, [room.room, room.session]);

  const handleAbort = useCallback(() => {
    if (!room.room || !room.session) return;
    startTransition(async () => {
      await abortSession(room.room!.id, room.session!.id).catch(() => {});
    });
  }, [room.room, room.session]);

  const handleLeave = useCallback(() => {
    if (!room.room) return;
    setLeaving(true);
    startTransition(async () => {
      await leaveRoom(room.room!.id).catch(() => {});
      router.replace("/");
    });
  }, [room.room, router]);

  if (!room.room) return <LoadingState label="Finding the room…" />;
  if (room.room.status === "closed") {
    return (
      <ErrorState
        title="This room is closed"
        description="The host ended it. Start a new one or join another."
        action={{ label: "Back to the start", href: "/" }}
      />
    );
  }

  const meta = room.session ? getMeta(room.session.gameId) : null;
  const phase =
    room.phase === "result" && dismissedResult === room.session?.id
      ? "lobby"
      : room.phase;
  const showHostBar = room.isHost && phase === "play";

  return (
    <div className="h-screen-safe flex flex-col">
      <ConnectionBanner status={room.connection} />

      <header className="flex items-center justify-between gap-3 px-5 pt-safe pb-3">
        <div className="min-w-0">
          <p className="text-xs tracking-widest text-ink-faint uppercase">Room</p>
          <p className="tabular text-2xl leading-none font-semibold tracking-[0.15em]">
            {formatRoomCode(room.room.code)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {room.isHost && <Badge tone="host">You host</Badge>}
          <ShareButton code={room.room.code} />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Leave the room"
            onClick={handleLeave}
            disabled={leaving}
          >
            {leaving ? <Spinner /> : <DoorOpen className="h-5 w-5" />}
          </Button>
        </div>
      </header>

      <main
        className={`flex-1 overflow-y-auto px-5 pb-8 ${showHostBar ? "pb-40" : ""}`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            variants={phaseVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            {phase === "lobby" && <LobbyPhase />}
            {phase === "setup" && <LoadingState label="Setting up…" />}
            {phase === "play" && (
              <GameSlot
                view={room.mySeat ? (room.isHost ? "host" : "player") : "spectator"}
                onAbort={handleAbort}
              />
            )}
            {phase === "result" && (
              <ResultView
                onDismiss={() => setDismissedResult(room.session?.id ?? null)}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {showHostBar && meta && (
        <HostBar>
          <div className="flex gap-2">
            {meta.supportsUndo && (
              <Button
                variant="host"
                size="md"
                className="flex-1"
                onClick={handleUndo}
                disabled={busy}
              >
                <Undo2 className="h-4 w-4" /> Undo
              </Button>
            )}
            <Button
              variant="danger"
              size="md"
              className="flex-1"
              onClick={handleAbort}
              disabled={busy}
            >
              <X className="h-4 w-4" /> End round
            </Button>
          </div>
        </HostBar>
      )}
    </div>
  );
}

function LobbyPhase() {
  const room = useRoom();
  const playing = room.members.filter((m) => !m.isSpectator);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-ink-muted uppercase">
          In the room · {playing.length}
        </h2>
        <PlayerList members={room.members} meId={room.me?.userId ?? ""} />
      </section>

      {room.isHost ? (
        <GamePicker />
      ) : (
        <p className="rounded-[var(--radius-card)] border border-border bg-surface px-5 py-6 text-center text-ink-muted">
          Waiting for the host to pick a game.
        </p>
      )}
    </div>
  );
}

function ShareButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = `${window.location.origin}/join/${code}`;
    // The native share sheet is the fastest path on a phone; the clipboard is
    // the fallback where it is not available.
    if (navigator.share) {
      await navigator.share({ title: "Join my room", text: `Room code ${code}`, url })
        .catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="ghost" size="icon" aria-label="Share the room" onClick={share}>
      {copied ? (
        <span className="text-xs font-semibold text-good">✓</span>
      ) : (
        <Share2 className="h-5 w-5" />
      )}
    </Button>
  );
}
