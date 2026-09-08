import Link from "next/link";
import { gameCatalog } from "@/games/registry";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** The catalogue, rendered straight from the registry. A new game appears here
 *  the moment it is registered — there is nothing to update. */
export default function GamesPage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-5 pt-safe pb-10">
      <header className="py-6">
        <h1 className="text-3xl font-semibold tracking-tight">Games</h1>
        <p className="mt-2 text-ink-muted">
          {gameCatalog.length} {gameCatalog.length === 1 ? "game" : "games"} in the app.
        </p>
      </header>

      {gameCatalog.map((meta) => (
        <Card key={meta.id}>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{meta.name}</CardTitle>
                <CardDescription className="mt-1">{meta.tagline}</CardDescription>
              </div>
              <Badge tone="accent">
                {meta.minPlayers}–{meta.maxPlayers}
              </Badge>
            </div>
            <p className="mt-3 text-sm text-ink-muted">{meta.description}</p>
            {meta.estimatedMinutes && (
              <p className="mt-2 text-xs text-ink-faint">
                About {meta.estimatedMinutes} min
              </p>
            )}
          </CardContent>
        </Card>
      ))}

      <Button asChild variant="surface" size="lg" className="mt-4">
        <Link href="/">Back</Link>
      </Button>
    </main>
  );
}
