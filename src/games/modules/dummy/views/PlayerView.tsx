"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DummyViewProps } from "../index";

/*
  What a player sees.

  Note what this component does NOT have: a database client, a router, a store.
  It gets a state and a `dispatch` and that is the whole of its access to the
  application — the same as every other game will get.
*/
export default function PlayerView({
  state,
  me,
  players,
  pending,
  connection,
  dispatch,
}: DummyViewProps) {
  const myScore = me ? (state.taps[me.userId] ?? 0) : 0;
  const leader = players
    .map((p) => ({ ...p, score: state.taps[p.userId] ?? 0 }))
    .sort((a, b) => b.score - a.score)[0];

  const disabled = connection !== "live" || state.winner !== null;

  return (
    <div className="flex min-h-[70dvh] flex-col gap-6 py-4">
      <div className="text-center">
        <p className="text-sm text-ink-muted">First to {state.target}</p>
        <motion.p
          key={myScore}
          initial={{ scale: 1.25 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.16 }}
          className="tabular mt-1 text-7xl font-semibold"
        >
          {myScore}
        </motion.p>
        {/* Unconfirmed taps are shown, but shown as provisional: the score can
            still change when the server's answer arrives. */}
        {pending.length > 0 && (
          <p className="mt-1 text-xs text-ink-faint">{pending.length} sending…</p>
        )}
      </div>

      <div className="flex flex-1 items-center justify-center">
        <Button
          size="block"
          className="h-40 w-40 rounded-full text-2xl"
          disabled={disabled}
          onClick={() => void dispatch({ type: "tap" })}
        >
          Tap
        </Button>
      </div>

      <ul className="flex flex-col gap-1.5">
        {players.map((player) => {
          const score = state.taps[player.userId] ?? 0;
          return (
            <li
              key={player.userId}
              className={cn(
                "flex items-center gap-3 rounded-[var(--radius-control)] px-4 py-2.5 text-sm",
                player.userId === me?.userId ? "bg-accent-soft" : "bg-surface-2",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{player.displayName}</span>
              {state.winner === player.userId && (
                <span className="text-xs font-semibold text-gold">winner</span>
              )}
              <span className="tabular font-semibold">{score}</span>
            </li>
          );
        })}
      </ul>

      {leader && state.winner === null && (
        <p className="text-center text-xs text-ink-faint">
          {leader.displayName} leads with {leader.score}
        </p>
      )}
    </div>
  );
}
