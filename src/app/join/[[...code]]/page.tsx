import { JoinForm } from "@/components/shell/JoinForm";

/*
  Joining.

  The optional catch-all segment makes `/join/ABC234` work as a shareable deep
  link while `/join` still shows an empty field — one route, both entry points.
  `params` is a Promise in Next.js 16.
*/
export default async function JoinPage({
  params,
}: {
  params: Promise<{ code?: string[] }>;
}) {
  const { code } = await params;
  return <JoinForm initialCode={code?.[0]?.toUpperCase() ?? ""} />;
}
