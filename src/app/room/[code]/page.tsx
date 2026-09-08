import { notFound } from "next/navigation";
import { RoomClient } from "@/components/shell/RoomClient";
import { RoomCode } from "@/lib/validation/shared";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const parsed = RoomCode.safeParse(code);
  if (!parsed.success) notFound();

  return <RoomClient code={parsed.data} />;
}
