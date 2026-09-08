"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
  Buttons.

  Sizes start at 48px because this is a phone app used one-handed, often by
  someone not paying full attention — the default `lg` is 56px, which is what a
  primary action in the thumb zone should be.

  The `host` variant is gold and is reserved for controls only the host can
  press. Nothing else in the app uses gold, so "can I press this?" is answered
  by colour before anyone reads the label.
*/
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] font-semibold transition-[transform,background-color,box-shadow] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 select-none",
  {
    variants: {
      variant: {
        player:
          "bg-accent text-accent-ink shadow-[var(--shadow-glow-accent)] hover:brightness-110",
        host: "bg-gold text-gold-ink shadow-[var(--shadow-glow-gold)] hover:brightness-110",
        surface:
          "bg-surface-2 text-ink border border-border hover:border-border-strong",
        ghost: "bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink",
        danger: "bg-danger-soft text-danger border border-danger/40 hover:bg-danger/20",
        outline:
          "bg-transparent text-ink border border-border-strong hover:bg-surface-2",
      },
      size: {
        lg: "h-14 px-6 text-base",
        md: "h-12 px-5 text-sm",
        sm: "h-10 px-4 text-sm",
        icon: "h-12 w-12",
        block: "h-16 w-full px-6 text-lg",
      },
    },
    defaultVariants: { variant: "player", size: "lg" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export { buttonVariants };
