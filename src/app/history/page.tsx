import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMeta } from "@/games/registry";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { formatRoomCode } from "@/lib/utils";

/*
  Match history.

  Read through the user-scoped client, so RLS decides what is visible: a result
  is readable only by the people who were in it. There is no owner check written
  here to forget, and no way to widen the query into someone else's evening.
*/
export default async function HistoryPage() {
  let results: Array<{
    id: string;
    game_id: string;
    room_code: string;
    finished_at: string;
    players: Array<{ display_name: string; placement: number | null; score: number | null }>;
  }> = [];

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("match_results")
      .select("id, game_id, room_code, finished_at")
      .order("finished_at", { ascending: false })
      .limit(30);

    const ids = (data ?? []).map((r) => r.id);
    const { data: players } = ids.length
      ? await supabase
          .from("match_result_players")
          .select("result_id, display_name, placement, score")
          .in("result_id", ids)
      : { data: [] };

    results = (data ?? []).map((r) => ({
      ...r,
      players: (players ?? [])
        .filter((p) => p.result_id === r.id)
        .sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99)),
    }));
  } catch {
    // Supabase not configured yet: an empty history is the honest answer.
    results = [];
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-5 pt-safe pb-10">
      <header className="py-6">
        <h1 className="text-3xl font-semibold tracking-tight">History</h1>
        <p className="mt-2 text-ink-muted">Rounds you played in.</p>
      </header>

      {results.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-border bg-surface px-5 py-8 text-center text-ink-muted">
          Nothing here yet. Finished rounds show up after you play one.
        </p>
      ) : (
        results.map((result) => {
          const meta = getMeta(result.game_id);
          return (
            <Card key={result.id}>
              <CardContent className="pt-5">
                <div className="flex items-baseline justify-between gap-3">
                  <CardTitle>{meta?.name ?? result.game_id}</CardTitle>
                  <span className="tabular text-xs text-ink-faint">
                    {formatRoomCode(result.room_code)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-faint">
                  {new Date(result.finished_at).toLocaleString()}
                </p>
                <ol className="mt-3 flex flex-col gap-1">
                  {result.players.map((player) => (
                    <li
                      key={`${result.id}-${player.display_name}`}
                      className="flex items-center gap-3 text-sm"
                    >
                      <span
                        className={`tabular w-5 text-right ${
                          player.placement === 1 ? "text-gold" : "text-ink-faint"
                        }`}
                      >
                        {player.placement ?? "–"}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{player.display_name}</span>
                      {player.score !== null && (
                        <span className="tabular text-ink-muted">{player.score}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          );
        })
      )}

      <Button asChild variant="surface" size="lg" className="mt-4">
        <Link href="/">Back</Link>
      </Button>
    </main>
  );
}
