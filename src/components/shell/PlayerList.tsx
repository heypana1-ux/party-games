"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Crown, Eye } from "lucide-react";
import { listItemVariants } from "@/components/motion/presets";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MemberInfo } from "@/platform/session/types";

const PRESENCE_LABEL = {
  online: "",
  away: "away",
  disconnected: "offline",
} as const;

export function PlayerList({
  members,
  meId,
}: {
  members: readonly MemberInfo[];
  meId: string;
}) {
  return (
    <ul className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {members.map((member) => (
          <motion.li
            key={member.userId}
            layout
            variants={listItemVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className={cn(
              "flex items-center gap-3 rounded-[var(--radius-control)] border px-4 py-3",
              member.presence === "disconnected"
                ? "border-border bg-surface/60 opacity-60"
                : "border-border bg-surface-2",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "h-2.5 w-2.5 shrink-0 rounded-full",
                member.presence === "online" && "bg-good",
                member.presence === "away" && "bg-warn",
                member.presence === "disconnected" && "bg-ink-faint",
              )}
            />
            <span className="min-w-0 flex-1 truncate font-medium">
              {member.displayName}
              {member.userId === meId && (
                <span className="ml-1.5 text-ink-faint">(you)</span>
              )}
            </span>

            {member.isSpectator && (
              <Badge tone="neutral">
                <Eye className="h-3 w-3" /> watching
              </Badge>
            )}
            {member.isHost && (
              <Badge tone="host">
                <Crown className="h-3 w-3" /> host
              </Badge>
            )}
            {PRESENCE_LABEL[member.presence] && (
              <span className="text-xs text-ink-faint">
                {PRESENCE_LABEL[member.presence]}
              </span>
            )}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
