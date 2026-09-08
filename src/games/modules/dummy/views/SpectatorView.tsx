"use client";

import type { DummyViewProps } from "../index";

/** A read-only board — for someone who joined mid-round, or a screen on the
 *  wall. No dispatch is used, so there is nothing here to press by accident. */
export default function SpectatorView({ state, players }: DummyViewProps) {
  const ranked = [...players]
    .map((p) => ({ ...p, score: state.taps[p.userId] ?? 0 }))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="flex flex-col gap-6 py-6">
      <p className="text-center text-sm text-ink-muted">First to {state.target}</p>

      <ul className="flex flex-col gap-2">
        {ranked.map((player, index) => (
          <li
            key={player.userId}
            className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-5 py-4"
          >
            <span className="tabular w-6 text-center text-lg text-ink-faint">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-lg">{player.displayName}</span>
            <span className="tabular text-2xl font-semibold">{player.score}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
