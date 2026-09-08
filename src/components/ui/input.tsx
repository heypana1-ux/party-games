"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-14 w-full rounded-[var(--radius-control)] border border-border bg-surface-2 px-4",
        "text-base text-ink placeholder:text-ink-faint",
        // 16px minimum, or iOS zooms the whole page when the field is focused.
        "text-[16px] outline-none transition-colors focus:border-accent",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("text-sm font-medium text-ink-muted", className)}
      {...props}
    />
  );
}
