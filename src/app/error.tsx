"use client";

import { ErrorState } from "@/components/shell/States";

export default function RouteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      title="Something went wrong"
      description="The page hit an error. Trying again usually clears it — the room itself is unaffected."
      action={{ label: "Try again", onClick: reset }}
    />
  );
}
