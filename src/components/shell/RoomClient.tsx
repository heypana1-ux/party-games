"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RoomProvider } from "@/platform/session/RoomProvider";
import { RoomExperience } from "@/components/shell/RoomExperience";
import { ErrorState, LoadingState } from "@/components/shell/States";
import { ensureIdentity } from "@/platform/auth/identity";

export function RoomClient({ code }: { code: string }) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    ensureIdentity()
      .then((identity) => active && setUserId(identity.userId))
      .catch((cause: Error) => active && setFailed(cause.message));
    return () => {
      active = false;
    };
  }, []);

  if (failed) {
    return (
      <ErrorState
        title="Could not sign you in"
        description={failed}
        action={{ label: "Try again", onClick: () => window.location.reload() }}
      />
    );
  }

  if (!userId) return <LoadingState label="Getting you in…" />;

  return (
    <RoomProvider
      code={code}
      userId={userId}
      // Rooms are only visible to their members, so "no room came back" means
      // you are not in it — send the person to the join screen with the code
      // already filled in rather than showing an error.
      onMissing={() => router.replace(`/join/${code}`)}
    >
      <RoomExperience />
    </RoomProvider>
  );
}
