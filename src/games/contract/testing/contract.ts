import { describe, expect, it } from "vitest";
import { createRng } from "@/games/contract/rng";
import type {
  ActionContext,
  GameModule,
  SeatRef,
  SystemAction,
} from "@/games/contract/types";

/*
  The contract test.

  Server authority, undo and reconnect all rest on the same three assumptions:
  a reducer is pure, it is deterministic, and its state survives a round trip
  through JSON. Those assumptions are invisible in the type system — a reducer
  that calls Math.random() type-checks perfectly and breaks undo in a way that
  only shows up as "the cards changed" on someone's phone at 1am.

  So every module runs this suite. A game that passes it can be trusted by the
  platform; a game that does not is not integrable, however good it looks.
*/

export interface ContractFixtures<A, C> {
  readonly config?: C;
  readonly players: readonly SeatRef[];
  /** A sequence of legal actions that plays a full game to its end. */
  readonly happyPath: ReadonlyArray<{ action: A; bySeat: number }>;
  /** Payloads that must fail schema validation. */
  readonly invalidActions: readonly unknown[];
  /** Legal-looking actions that the wrong person must not be allowed to do. */
  readonly unauthorized: ReadonlyArray<{
    action: A;
    bySeat: number | "nonmember";
  }>;
  /** One stored state per older state version, if the module has any. */
  readonly legacyStates?: ReadonlyArray<{ version: number; state: unknown }>;
}

const SEED = "contract-test-seed";

function makeCtx(
  players: readonly SeatRef[],
  seq: number,
  actor: SeatRef | null,
): ActionContext {
  return {
    sessionId: "00000000-0000-4000-8000-000000000000",
    seq,
    // Fixed, not Date.now(): the suite must give the same answer at 3am as at
    // noon, and a reducer that reads real time should fail here, not in prod.
    now: 1_700_000_000_000,
    rng: createRng(SEED, seq),
    actor,
    players,
    hostUserId: players[0]?.userId ?? "host",
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function seatOf(players: readonly SeatRef[], index: number): SeatRef {
  const seat = players[index];
  if (!seat) throw new Error(`fixture refers to seat ${index}, which does not exist`);
  return seat;
}

/** Folds a log from the initial state — exactly what undo does on the server. */
function fold<S, A, C>(
  mod: GameModule<S, A, C>,
  initial: S,
  log: ReadonlyArray<{ action: A; bySeat: number; seq: number }>,
  players: readonly SeatRef[],
): S {
  let state = initial;
  for (const entry of log) {
    const ctx = makeCtx(players, entry.seq, seatOf(players, entry.bySeat));
    state = mod.reduce(state, entry.action, ctx);
  }
  return state;
}

export function runGameModuleContract<S, A, C>(
  mod: GameModule<S, A, C>,
  fixtures: ContractFixtures<A, C>,
): void {
  const { players } = fixtures;
  const config = fixtures.config ?? mod.defaultConfig;

  const initial = () =>
    mod.createInitialState({
      config,
      players,
      ctx: makeCtx(players, 0, null),
    });

  describe(`GameModule contract: ${mod.meta.id}`, () => {
    it("declares coherent metadata", () => {
      const m = mod.meta;
      expect(m.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(m.moduleVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(Number.isInteger(m.stateVersion)).toBe(true);
      expect(m.stateVersion).toBeGreaterThanOrEqual(1);
      expect(m.minPlayers).toBeGreaterThanOrEqual(1);
      expect(m.maxPlayers).toBeGreaterThanOrEqual(m.minPlayers);
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.tagline.length).toBeGreaterThan(0);
      if (m.supportsSpectatorView) expect(mod.views.Spectator).toBeDefined();
      if (m.supportsUndo) expect(typeof mod.canUndo).toBe("function");
    });

    it("accepts the fixture player count", () => {
      expect(players.length).toBeGreaterThanOrEqual(mod.meta.minPlayers);
      expect(players.length).toBeLessThanOrEqual(mod.meta.maxPlayers);
    });

    it("validates its own default config", () => {
      expect(mod.schemas.config.safeParse(mod.defaultConfig).success).toBe(true);
    });

    it("exposes setup fields that exist on the config", () => {
      for (const field of mod.setupSchema) {
        expect(Object.keys(mod.defaultConfig as object)).toContain(field.key);
      }
    });

    it("builds a deterministic initial state", () => {
      expect(initial()).toStrictEqual(initial());
    });

    it("produces a JSON round-trip safe initial state", () => {
      const state = initial();
      // Dates, Maps, Sets and undefined all survive in memory and quietly
      // change shape in jsonb. This is where that gets caught.
      expect(JSON.parse(JSON.stringify(state))).toStrictEqual(state);
      expect(mod.schemas.state.safeParse(state).success).toBe(true);
    });

    it("does not mutate the state it is given", () => {
      const state = deepFreeze(initial());
      const first = fixtures.happyPath[0];
      if (!first) return;
      const ctx = makeCtx(players, 1, seatOf(players, first.bySeat));
      // Frozen input: a reducer that assigns into `state` throws in strict mode.
      expect(() => mod.reduce(state, first.action, ctx)).not.toThrow();
    });

    it("is deterministic for a repeated action", () => {
      const state = initial();
      const first = fixtures.happyPath[0];
      if (!first) return;
      const ctx = () => makeCtx(players, 1, seatOf(players, first.bySeat));
      expect(mod.reduce(state, first.action, ctx())).toStrictEqual(
        mod.reduce(state, first.action, ctx()),
      );
    });

    it("takes randomness and time only from the context", () => {
      const state = initial();
      const first = fixtures.happyPath[0];
      if (!first) return;

      const realRandom = Math.random;
      const realNow = Date.now;
      Math.random = () => {
        throw new Error("reducer called Math.random — use ctx.rng");
      };
      Date.now = () => {
        throw new Error("reducer called Date.now — use ctx.now");
      };
      try {
        const ctx = makeCtx(players, 1, seatOf(players, first.bySeat));
        expect(() => mod.reduce(state, first.action, ctx)).not.toThrow();
      } finally {
        Math.random = realRandom;
        Date.now = realNow;
      }
    });

    it("rejects malformed actions at the schema", () => {
      expect(fixtures.invalidActions.length).toBeGreaterThan(0);
      for (const bad of fixtures.invalidActions) {
        expect(mod.schemas.action.safeParse(bad).success).toBe(false);
      }
    });

    it("refuses actions from the wrong actor", () => {
      const state = initial();
      for (const entry of fixtures.unauthorized) {
        const actor =
          entry.bySeat === "nonmember"
            ? null
            : seatOf(players, entry.bySeat);
        const ctx = makeCtx(players, 1, actor);
        const verdict = mod.authorize(state, entry.action, ctx);
        expect(verdict.ok).toBe(false);
      }
    });

    it("authorizes every action on the happy path", () => {
      let state = initial();
      let seq = 1;
      for (const entry of fixtures.happyPath) {
        if (mod.isFinished(state)) break;
        const ctx = makeCtx(players, seq, seatOf(players, entry.bySeat));
        expect(mod.authorize(state, entry.action, ctx)).toStrictEqual({ ok: true });
        state = mod.reduce(state, entry.action, ctx);
        seq += 1;
      }
    });

    it("reaches a finished state on the happy path", () => {
      let state = initial();
      let seq = 1;
      for (const entry of fixtures.happyPath) {
        if (mod.isFinished(state)) break;
        state = mod.reduce(
          state,
          entry.action,
          makeCtx(players, seq, seatOf(players, entry.bySeat)),
        );
        seq += 1;
      }
      expect(mod.isFinished(state)).toBe(true);
    });

    it("reproduces the final state by replaying the log", () => {
      // This is undo. If folding the log from scratch does not land on the same
      // state, undo silently rewrites the game instead of stepping it back.
      const log: Array<{ action: A; bySeat: number; seq: number }> = [];
      let state = initial();
      let seq = 1;
      for (const entry of fixtures.happyPath) {
        if (mod.isFinished(state)) break;
        log.push({ ...entry, seq });
        state = mod.reduce(
          state,
          entry.action,
          makeCtx(players, seq, seatOf(players, entry.bySeat)),
        );
        seq += 1;
      }
      expect(fold(mod, initial(), log, players)).toStrictEqual(state);
    });

    it("steps back correctly when the last action is undone", () => {
      if (!mod.meta.supportsUndo) return;
      const log: Array<{ action: A; bySeat: number; seq: number }> = [];
      let state = initial();
      let seq = 1;
      for (const entry of fixtures.happyPath) {
        if (mod.isFinished(state)) break;
        log.push({ ...entry, seq });
        state = mod.reduce(
          state,
          entry.action,
          makeCtx(players, seq, seatOf(players, entry.bySeat)),
        );
        seq += 1;
      }
      if (log.length < 2) return;

      const before = fold(mod, initial(), log.slice(0, -1), players);
      // Surviving actions keep their original seq, so they keep their RNG draw.
      expect(fold(mod, initial(), log.slice(0, -1), players)).toStrictEqual(before);
      expect(before).not.toStrictEqual(state);
    });

    it("returns a complete, consistent result", () => {
      let state = initial();
      let seq = 1;
      for (const entry of fixtures.happyPath) {
        if (mod.isFinished(state)) break;
        state = mod.reduce(
          state,
          entry.action,
          makeCtx(players, seq, seatOf(players, entry.bySeat)),
        );
        seq += 1;
      }

      const result = mod.getResult(state, players);
      expect(result.players).toHaveLength(players.length);

      const seen = new Set<string>();
      for (const p of result.players) {
        expect(players.some((s) => s.userId === p.userId)).toBe(true);
        expect(seen.has(p.userId)).toBe(false);
        seen.add(p.userId);
        expect(Number.isInteger(p.placement)).toBe(true);
        expect(p.placement).toBeGreaterThanOrEqual(1);
      }
      // Placements start at 1 and never skip past the number of players.
      expect(Math.min(...result.players.map((p) => p.placement))).toBe(1);
      expect(Math.max(...result.players.map((p) => p.placement)))
        .toBeLessThanOrEqual(players.length);

      expect(JSON.parse(JSON.stringify(result.summary))).toStrictEqual(result.summary);
    });

    it("survives the system actions the platform can inject", () => {
      const state = deepFreeze(initial());
      if (!mod.reduceSystem) return;
      const events: SystemAction[] = [
        { type: "__player_disconnected", userId: seatOf(players, 0).userId },
        { type: "__player_reconnected", userId: seatOf(players, 0).userId },
        { type: "__host_changed", userId: seatOf(players, 0).userId },
      ];
      for (const [i, event] of events.entries()) {
        const next = mod.reduceSystem(state, event, makeCtx(players, i + 1, null));
        expect(mod.schemas.state.safeParse(next).success).toBe(true);
      }
    });

    it("migrates every older state version it claims to support", () => {
      const legacy = fixtures.legacyStates ?? [];
      if (legacy.length === 0) return;
      expect(typeof mod.migrate).toBe("function");
      for (const old of legacy) {
        const migrated = mod.migrate!(old.state, old.version);
        expect(mod.schemas.state.safeParse(migrated).success).toBe(true);
        expect(JSON.parse(JSON.stringify(migrated))).toStrictEqual(migrated);
      }
    });
  });
}
