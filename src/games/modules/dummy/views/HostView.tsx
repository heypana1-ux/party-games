"use client";

import { Button } from "@/components/ui/button";
import PlayerView from "./PlayerView";
import type { DummyViewProps } from "../index";

/*
  The host plays too, so this is the player view plus one host-only control.

  The reset button is gold because gold means "only the host can press this" —
  and the reducer refuses the action for anyone else regardless, so the colour
  is a courtesy, not the enforcement.
*/
export default function HostView(props: DummyViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <PlayerView {...props} />

      <Button
        variant="host"
        size="md"
        className="w-full"
        disabled={props.connection !== "live" || props.state.totalTaps === 0}
        onClick={() => void props.dispatch({ type: "reset" })}
      >
        Reset the scores
      </Button>
    </div>
  );
}
