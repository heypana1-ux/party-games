"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/*
  Every failure the platform can produce has exactly one screen and exactly one
  sensible next action. Anything vaguer than this leaves a room of people
  staring at a phone with no idea what to do.
*/

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 text-ink-muted">
      <Spinner className="h-7 w-7" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { label: string; href?: string; onClick?: () => void };
}) {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="max-w-sm text-ink-muted">{description}</p>
      {action &&
        (action.href ? (
          <Button asChild variant="surface" className="mt-2">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        ) : (
          <Button variant="surface" className="mt-2" onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
    </div>
  );
}
