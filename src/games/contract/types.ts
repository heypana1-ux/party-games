import type { ComponentType, LazyExoticComponent } from "react";
import type { ZodType } from "zod";

/*
  The contract between the platform and a game.

  The platform knows nothing about rules, points, cards, rounds or drinks. It
  knows how to persist a blob, hand it to a pure function together with an
  action, and store what comes back. Everything a game needs to be playable is
  declared here; everything a game needs to be *safe* is enforced by the fact
  that the reducer is pure and runs on the server.
*/

/** Anything that survives JSON.stringify / JSON.parse unchanged. */
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

/** A player's seat in a session. Names are snapshotted at start. */
export interface SeatRef {
  readonly userId: string;
  readonly seatIndex: number;
  readonly displayName: string;
}

/**
 * Everything a reducer is allowed to see besides the state and the action.
 *
 * Note what is absent: no Supabase client, no router, no fetch, no Date. A
 * module cannot reach the shell because there is nothing here to reach it
 * with, and it cannot become non-deterministic because time and randomness
 * arrive as values recorded in the action log.
 */
export interface ActionContext {
  readonly sessionId: string;
  /** Position in the action log. Never reissued, so RNG draws are stable. */
  readonly seq: number;
  /** Wall clock at the moment the action was accepted, replayed from the log. */
  readonly now: number;
  /** Deterministic for this (session seed, seq). */
  readonly rng: () => number;
  /** Who acted. Null for system actions the platform injects. */
  readonly actor: SeatRef | null;
  readonly players: readonly SeatRef[];
  readonly hostUserId: string;
}

/**
 * Events the platform feeds into the log so a module can react to them without
 * ever reading live connection state. Passing presence directly to a reducer
 * would make replay non-deterministic; passing it as a recorded action does
 * not. Modules may ignore all of these.
 */
export type SystemAction =
  | { readonly type: "__player_left"; readonly userId: string }
  | { readonly type: "__player_disconnected"; readonly userId: string }
  | { readonly type: "__player_reconnected"; readonly userId: string }
  | { readonly type: "__host_changed"; readonly userId: string }
  | { readonly type: "__force_end" };

export function isSystemAction(action: unknown): action is SystemAction {
  return (
    typeof action === "object" &&
    action !== null &&
    typeof (action as { type?: unknown }).type === "string" &&
    (action as { type: string }).type.startsWith("__")
  );
}

export type AuthorizeResult = { ok: true } | { ok: false; reason: string };

export const allow: AuthorizeResult = { ok: true };
export function deny(reason: string): AuthorizeResult {
  return { ok: false, reason };
}

/** One player's outcome. `placement` is 1-based; ties may share a placement. */
export interface ResultPlayer {
  readonly userId: string;
  readonly displayName: string;
  readonly placement: number;
  readonly score?: number;
  readonly payload?: Json;
}

export interface GameResult {
  readonly players: readonly ResultPlayer[];
  /** Stored verbatim. The platform never looks inside; the module owns it. */
  readonly summary: Json;
}

/**
 * A lobby option, declared rather than rendered. The shell draws these with its
 * own controls so that setting up any game feels the same, and so a module
 * never has to know about the design system.
 */
export type SetupField<C> =
  | {
      readonly kind: "number";
      readonly key: keyof C & string;
      readonly label: string;
      readonly help?: string;
      readonly min: number;
      readonly max: number;
      readonly step?: number;
    }
  | {
      readonly kind: "toggle";
      readonly key: keyof C & string;
      readonly label: string;
      readonly help?: string;
    }
  | {
      readonly kind: "select";
      readonly key: keyof C & string;
      readonly label: string;
      readonly help?: string;
      readonly options: ReadonlyArray<{ value: string; label: string }>;
    };

export interface GameMeta {
  /** Stable forever. Stored on every session and result row. */
  readonly id: string;
  /** Semver of the module code. */
  readonly moduleVersion: string;
  /** Schema version of the state. Bump when `migrate` is needed. */
  readonly stateVersion: number;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
  /** Key into the shell's icon set — not a component, not a URL. */
  readonly icon: string;
  /** Design token name, not a colour value. The shell owns the palette. */
  readonly accent: "accent" | "gold" | "danger" | "cool";
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly supportsSpectatorView: boolean;
  readonly supportsUndo: boolean;
  readonly estimatedMinutes?: number;
}

/** Props a game view receives. This is the module's entire window on the app. */
export interface GameViewProps<S, A> {
  readonly state: S;
  readonly revision: number;
  readonly me: SeatRef | null;
  readonly players: readonly SeatRef[];
  readonly isHost: boolean;
  readonly connection: "live" | "reconnecting" | "offline";
  /** Actions sent but not yet confirmed by the server. */
  readonly pending: readonly A[];
  /** The only way a view changes anything. Goes through the command pipeline. */
  readonly dispatch: (action: A) => Promise<DispatchResult>;
}

export type DispatchResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly error: string };

export type LazyView<P> = LazyExoticComponent<ComponentType<P>>;

/**
 * A game.
 *
 * `S` state, `A` action, `C` setup config — all three must be JSON round-trip
 * safe, because they live in jsonb columns and travel over Realtime.
 */
export interface GameModule<S, A, C> {
  readonly meta: GameMeta;

  /**
   * Runtime schemas. Compile-time types stop at the network boundary: an action
   * arrives as untrusted JSON and a state comes back out of a jsonb column, so
   * both are parsed before a reducer ever sees them.
   */
  readonly schemas: {
    readonly config: ZodType<C>;
    readonly action: ZodType<A>;
    readonly state: ZodType<S>;
  };

  readonly defaultConfig: C;
  readonly setupSchema: ReadonlyArray<SetupField<C>>;

  /** Pure. Same inputs — including ctx.rng's seed — always same output. */
  createInitialState(input: {
    config: C;
    players: readonly SeatRef[];
    ctx: ActionContext;
  }): S;

  /** May this actor do this now? Pure, no IO. Checked on the server. */
  authorize(state: S, action: A, ctx: ActionContext): AuthorizeResult;

  /** The state transition. Must not mutate `state`. Throws on the impossible. */
  reduce(state: S, action: A, ctx: ActionContext): S;

  /** Optional reaction to platform events. Same purity rules. */
  reduceSystem?(state: S, action: SystemAction, ctx: ActionContext): S;

  isFinished(state: S): boolean;
  getResult(state: S, players: readonly SeatRef[]): GameResult;

  /** Whether undo is allowed right now. The mechanism is the platform's. */
  canUndo?(state: S, lastAction: A | SystemAction | null): boolean;

  /** Lift a state written by an older version of this module. */
  migrate?(state: unknown, fromVersion: number): S;

  readonly views: {
    readonly Host: LazyView<GameViewProps<S, A>>;
    readonly Player: LazyView<GameViewProps<S, A>>;
    readonly Spectator?: LazyView<GameViewProps<S, A>>;
  };
}

/**
 * How the registry hands a module back.
 *
 * `unknown` is deliberate and load-bearing: a game id is a string that arrives
 * from the database, so the state type genuinely is not known statically at
 * that point. Pretending otherwise with `any` would let unchecked values slide
 * into the reducer. Type safety lives *inside* a module; at the registry
 * boundary safety comes from `schemas`.
 */
export type AnyGameModule = GameModule<unknown, unknown, unknown>;
