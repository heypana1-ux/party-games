"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import { settle } from "@/components/motion/presets";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getModule } from "@/games/registry";
import { useRoom } from "@/platform/session/RoomProvider";
import type { GameResult } from "@/games/contract/types";

/*
  The result screen.

  The standings are recomputed from the final snapshot with the module's own
  `getResult`, rather than fetched back from the history table. Both would
  agree — `finish_session` stored exactly this — but computing it here means the
  screen appears the moment the last move lands, with no extra round trip on a
  phone that may be on a weak connection.
*/
export function ResultView({ onDismiss }: { onDismiss?: () => void }) {
  const room = useRoom();

  const result = useMemo<GameResult | null>(() => {
    if (!room.session) return null;
    const mod = getModule(room.session.gameId);
    if (!mod) return null;
    try {
      return mod.getResult(room.session.state, room.session.seats);
    } catch {
      return null;
    }
  }, [room.session]);

  if (!result) {
    return (
      <p className="py-10 text-center text-ink-muted">
        This round has finished.
      </p>
    );
  }

  const ranked = [...result.players].sort((a, b) => a.placement - b.placement);

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="text-center">
        <Trophy className="mx-auto h-10 w-10 text-gold" />
        <h2 className="mt-3 text-2xl font-semibold">Round over</h2>
      </div>

      <ol className="flex flex-col gap-2">
        {ranked.map((player, index) => (
          <motion.li
            key={player.userId}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...settle, delay: index * 0.05 }}
          >
            <Card className={player.placement === 1 ? "border-gold/40" : undefined}>
              <CardContent className="flex items-center gap-4 py-4">
                <span
                  className={`tabular w-8 text-center text-xl font-semibold ${
                    player.placement === 1 ? "text-gold" : "text-ink-faint"
                  }`}
                >
                  {player.placement}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {player.displayName}
                  {player.userId === room.me?.userId && (
                    <span className="ml-1.5 text-ink-faint">(you)</span>
                  )}
                </span>
                {player.score !== undefined && (
                  <span className="tabular text-lg font-semibold">{player.score}</span>
                )}
              </CardContent>
            </Card>
          </motion.li>
        ))}
      </ol>

      {room.isHost && onDismiss && (
        <Button variant="host" size="block" onClick={onDismiss}>
          Back to the lobby
        </Button>
      )}
      {!room.isHost && (
        <p className="text-center text-sm text-ink-muted">
          Waiting for the host to pick what&apos;s next.
        </p>
      )}
    </div>
  );
}
