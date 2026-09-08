import { ErrorState } from "@/components/shell/States";

export default function OfflinePage() {
  return (
    <ErrorState
      title="You're offline"
      description="Party Games needs a connection — everyone's phones have to agree on what is happening. This page will work again as soon as you're back."
      action={{ label: "Back to the start", href: "/" }}
    />
  );
}
