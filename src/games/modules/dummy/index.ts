import { lazy } from "react";
import {
  allow,
  deny,
  type GameModule,
  type GameViewProps,
} from "@/games/contract/types";
import {
  ActionSchema,
  ConfigSchema,
  StateSchema,
  type Action,
  type Config,
  type State,
} from "./state";

/*
  Tap Test — the platform's own test instrument, not a game.

  It exists to prove the whole pipeline end to end with something that has no
  rules worth arguing about: a player action, a host-only action, seeded
  randomness, an end condition, a result and undo. When a real game misbehaves,
  running this first tells you whether the problem is the game or the platform.
*/

const dummyModule: GameModule<State, Action, Config> = {
  meta: {
    id: "dummy",
    moduleVersion: "1.0.0",
    stateVersion: 1,
    name: "Tap Test",
    tagline: "Technical placeholder",
    description:
      "Everyone taps. First to the target wins. Exists to verify realtime, reconnect and undo — not to be fun.",
    icon: "target",
    accent: "accent",
    minPlayers: 1,
    maxPlayers: 12,
    supportsSpectatorView: true,
    supportsUndo: true,
    estimatedMinutes: 1,
  },

  schemas: { config: ConfigSchema, action: ActionSchema, state: StateSchema },

  defaultConfig: { targetTaps: 10, bonusEnabled: true },

  setupSchema: [
    {
      kind: "number",
      key: "targetTaps",
      label: "Taps to win",
      help: "How far the first player has to get.",
      min: 1,
      max: 50,
      step: 1,
    },
    {
      kind: "toggle",
      key: "bonusEnabled",
      label: "Lucky taps",
      help: "Some taps count double. Uses the session's seeded randomness.",
    },
  ],

  createInitialState: ({ config, players }) => ({
    target: config.targetTaps,
    bonusEnabled: config.bonusEnabled,
    taps: Object.fromEntries(players.map((p) => [p.userId, 0])),
    lastGain: Object.fromEntries(players.map((p) => [p.userId, 0])),
    totalTaps: 0,
    winner: null,
  }),

  authorize: (state, action, ctx) => {
    if (state.winner !== null) return deny("game_over");
    if (action.type === "reset") {
      return ctx.actor?.userId === ctx.hostUserId ? allow : deny("host_only");
    }
    if (!ctx.actor) return deny("not_seated");
    if (!(ctx.actor.userId in state.taps)) return deny("not_seated");
    return allow;
  },

  reduce: (state, action, ctx) => {
    if (action.type === "reset") {
      return {
        ...state,
        taps: Object.fromEntries(Object.keys(state.taps).map((id) => [id, 0])),
        lastGain: Object.fromEntries(Object.keys(state.taps).map((id) => [id, 0])),
        totalTaps: 0,
        winner: null,
      };
    }

    const actor = ctx.actor;
    if (!actor) throw new Error("tap without an actor");

    // ctx.rng, never Math.random: this draw has to come out the same when the
    // log is replayed for an undo, possibly hours later on another machine.
    const gain = state.bonusEnabled && ctx.rng() < 0.25 ? 2 : 1;
    const next = (state.taps[actor.userId] ?? 0) + gain;

    return {
      ...state,
      taps: { ...state.taps, [actor.userId]: next },
      lastGain: { ...state.lastGain, [actor.userId]: gain },
      totalTaps: state.totalTaps + 1,
      winner: next >= state.target ? actor.userId : state.winner,
    };
  },

  isFinished: (state) => state.winner !== null,

  getResult: (state, players) => {
    const ranked = [...players].sort(
      (a, b) => (state.taps[b.userId] ?? 0) - (state.taps[a.userId] ?? 0),
    );

    let placement = 0;
    let previousScore: number | null = null;
    const result = ranked.map((seat, index) => {
      const score = state.taps[seat.userId] ?? 0;
      // Equal scores share a placement; the next distinct score skips ahead,
      // the way a scoreboard reads.
      if (score !== previousScore) {
        placement = index + 1;
        previousScore = score;
      }
      return {
        userId: seat.userId,
        displayName: seat.displayName,
        placement,
        score,
      };
    });

    return {
      players: result,
      summary: {
        target: state.target,
        winner: state.winner,
        totalTaps: state.totalTaps,
      },
    };
  },

  canUndo: (state) => state.totalTaps > 0,

  views: {
    Host: lazy(() => import("./views/HostView")) as GameModule<
      State,
      Action,
      Config
    >["views"]["Host"],
    Player: lazy(() => import("./views/PlayerView")) as GameModule<
      State,
      Action,
      Config
    >["views"]["Player"],
    Spectator: lazy(() => import("./views/SpectatorView")) as GameModule<
      State,
      Action,
      Config
    >["views"]["Spectator"],
  },
};

export type DummyViewProps = GameViewProps<State, Action>;
export default dummyModule;
export { dummyModule };
