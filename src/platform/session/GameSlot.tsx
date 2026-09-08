"use client";

import { Component, Suspense, type ReactNode } from "react";
import { getModule } from "@/games/registry";
import { LoadingState, ErrorState } from "@/components/shell/States";
import { useRoom } from "@/platform/session/RoomProvider";
import type { GameViewProps } from "@/games/contract/types";

/*
  Where a game gets rendered.

  The shell picks Host, Player or Spectator and hands over a fixed set of props.
  That prop object is the module's entire window on the application: a read-only
  state, who it is looking at, and one `dispatch`. There is no client, no
  router and no store to reach for, which is why a misbehaving module can spoil
  its own view and nothing else.
*/

class GameErrorBoundary extends Component<
  { gameName: string; onAbort?: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[party-games] game view crashed", error);
  }

  render() {
    if (this.state.failed) {
      return (
        <ErrorState
          title="This game hit a problem"
          description={`${this.props.gameName} stopped responding. The round can be ended and started again — nothing else in the room is affected.`}
          action={
            this.props.onAbort
              ? { label: "End the round", onClick: this.props.onAbort }
              : undefined
          }
        />
      );
    }
    return this.props.children;
  }
}

export function GameSlot({
  view,
  onAbort,
}: {
  view: "host" | "player" | "spectator";
  onAbort?: () => void;
}) {
  const { session, displayState, members, mySeat, isHost, connection, pending, dispatch } =
    useRoom();

  if (!session) return <LoadingState label="Starting the game…" />;

  const mod = getModule(session.gameId);

  if (!mod) {
    return (
      <ErrorState
        title="Game unavailable"
        description="This round was started with a game that is no longer part of the app. Ending the round returns everyone to the lobby."
        action={onAbort ? { label: "Back to the lobby", onClick: onAbort } : undefined}
      />
    );
  }

  // The stored state is newer than this build understands. Refusing to render is
  // the only safe answer — an older view would misread the state silently.
  if (session.stateVersion > mod.meta.stateVersion) {
    return (
      <ErrorState
        title="Update needed"
        description="This round is running a newer version of the game than your app has. Reload to get the current version."
        action={{ label: "Reload", onClick: () => window.location.reload() }}
      />
    );
  }

  const Chosen =
    view === "host"
      ? mod.views.Host
      : view === "spectator" && mod.views.Spectator
        ? mod.views.Spectator
        : mod.views.Player;

  const props: GameViewProps<unknown, unknown> = {
    state: displayState,
    revision: session.revision,
    me: mySeat,
    players: session.seats.length > 0 ? session.seats : membersAsSeats(members),
    isHost,
    connection: connection === "live" ? "live" : connection === "offline" ? "offline" : "reconnecting",
    pending,
    dispatch,
  };

  return (
    <GameErrorBoundary gameName={mod.meta.name} onAbort={onAbort}>
      <Suspense fallback={<LoadingState label={`Loading ${mod.meta.name}…`} />}>
        <Chosen {...props} />
      </Suspense>
    </GameErrorBoundary>
  );
}

function membersAsSeats(members: ReturnType<typeof useRoom>["members"]) {
  return members
    .filter((m) => !m.isSpectator)
    .map((m, index) => ({
      userId: m.userId,
      seatIndex: index,
      displayName: m.displayName,
    }));
}
