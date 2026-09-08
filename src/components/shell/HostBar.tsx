"use client";

import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";

/*
  The host's controls live in one fixed strip at the bottom of the screen.

  Two reasons it is separate rather than mixed into the page: it is always in
  the thumb's reach on a phone, and it is the only gold surface in the app, so
  players never wonder whether a control is theirs to press. Players do not see
  this bar at all — not greyed out, absent.
*/
export function HostBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-gold/25 bg-surface/95 backdrop-blur",
        "px-4 pt-3 pb-safe",
        className,
      )}
    >
      <div className="mx-auto flex max-w-md flex-col gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-gold/80 uppercase">
          <Crown className="h-3.5 w-3.5" />
          Host controls
        </div>
        {children}
      </div>
    </div>
  );
}
