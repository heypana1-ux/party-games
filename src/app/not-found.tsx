import { ErrorState } from "@/components/shell/States";

export default function NotFound() {
  return (
    <ErrorState
      title="Nothing here"
      description="That link doesn't lead anywhere. If you were given a room code, join with it instead."
      action={{ label: "Join with a code", href: "/join" }}
    />
  );
}
