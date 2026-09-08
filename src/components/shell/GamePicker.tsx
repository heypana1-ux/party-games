"use client";

import { useMemo, useState, useTransition } from "react";
import { Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { gameCatalog, getModule } from "@/games/registry";
import { startSession } from "@/platform/session/commands";
import { useRoom } from "@/platform/session/RoomProvider";
import type { GameMeta, SetupField } from "@/games/contract/types";

/*
  Choosing and configuring a game.

  The shell renders the options; the module only declares them. That is why
  every game's setup screen looks and behaves the same, and why adding a game
  needs no UI work here at all.
*/
export function GamePicker() {
  const room = useRoom();
  const playerCount = room.members.filter((m) => !m.isSpectator).length;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium tracking-wide text-ink-muted uppercase">
        Pick a game
      </h2>
      {gameCatalog.map((meta) => (
        <GameCard key={meta.id} meta={meta} playerCount={playerCount} />
      ))}
    </section>
  );
}

function GameCard({ meta, playerCount }: { meta: GameMeta; playerCount: number }) {
  const tooFew = playerCount < meta.minPlayers;
  const tooMany = playerCount > meta.maxPlayers;
  const blocked = tooFew || tooMany;

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>{meta.name}</CardTitle>
            <CardDescription className="mt-1">{meta.tagline}</CardDescription>
          </div>
          <Badge tone={meta.accent === "gold" ? "host" : "accent"}>
            {meta.minPlayers}–{meta.maxPlayers}
          </Badge>
        </div>

        <p className="mt-3 text-sm text-ink-muted">{meta.description}</p>

        {blocked ? (
          <p className="mt-4 text-sm text-warn">
            {tooFew
              ? `Needs at least ${meta.minPlayers} ${meta.minPlayers === 1 ? "player" : "players"}.`
              : `Too many players — this game takes up to ${meta.maxPlayers}.`}
          </p>
        ) : (
          <SetupSheet meta={meta} />
        )}
      </CardContent>
    </Card>
  );
}

function SetupSheet({ meta }: { meta: GameMeta }) {
  const room = useRoom();
  const mod = getModule(meta.id);
  const [config, setConfig] = useState<Record<string, unknown>>(
    () => ({ ...(mod?.defaultConfig as Record<string, unknown>) }),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const fields = useMemo(
    () => (mod?.setupSchema ?? []) as ReadonlyArray<SetupField<Record<string, unknown>>>,
    [mod],
  );

  if (!mod || !room.room) return null;

  function start() {
    setError(null);
    startTransition(async () => {
      try {
        await startSession(room.room!.id, { gameId: meta.id, config });
        // No navigation: the session insert arrives over realtime and the phase
        // follows it, for the host exactly as for everyone else.
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not start the game.");
      }
    });
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="host" size="lg" className="mt-4 w-full">
          <Play className="h-5 w-5" /> Set up
        </Button>
      </SheetTrigger>

      <SheetContent title={meta.name}>
        <div className="flex flex-col gap-5 pb-4">
          {fields.map((field) => (
            <SetupControl
              key={field.key}
              field={field}
              value={config[field.key]}
              onChange={(next) => setConfig((prev) => ({ ...prev, [field.key]: next }))}
            />
          ))}

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button variant="host" size="block" onClick={start} disabled={busy}>
            {busy ? <Spinner className="border-t-gold-ink" /> : "Start the game"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SetupControl({
  field,
  value,
  onChange,
}: {
  field: SetupField<Record<string, unknown>>;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  if (field.kind === "number") {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={field.key}>{field.label}</Label>
        {field.help && <p className="text-xs text-ink-faint">{field.help}</p>}
        <Input
          id={field.key}
          type="number"
          inputMode="numeric"
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          value={typeof value === "number" ? value : field.min}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    );
  }

  if (field.kind === "toggle") {
    const on = Boolean(value);
    return (
      <button
        type="button"
        onClick={() => onChange(!on)}
        aria-pressed={on}
        className="flex items-center justify-between gap-4 rounded-[var(--radius-control)] border border-border bg-surface-2 px-4 py-4 text-left"
      >
        <span>
          <span className="block font-medium">{field.label}</span>
          {field.help && (
            <span className="mt-0.5 block text-xs text-ink-faint">{field.help}</span>
          )}
        </span>
        <span
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
            on ? "bg-gold" : "bg-surface-3"
          }`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-ink transition-[left] ${
              on ? "left-6" : "left-1"
            }`}
          />
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{field.label}</Label>
      {field.help && <p className="text-xs text-ink-faint">{field.help}</p>}
      <div className="flex flex-wrap gap-2">
        {field.options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={value === option.value ? "host" : "surface"}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
