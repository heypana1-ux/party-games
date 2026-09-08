import { describe, expect, it } from "vitest";
import { runGameModuleContract } from "@/games/contract/testing/contract";
import { createRng } from "@/games/contract/rng";
import dummyModule from "@/games/modules/dummy";
import type { SeatRef } from "@/games/contract/types";
import type { Action } from "../state";

const players: SeatRef[] = [
  { userId: "u-host", seatIndex: 0, displayName: "Sam" },
  { userId: "u-two", seatIndex: 1, displayName: "Alex" },
  { userId: "u-three", seatIndex: 2, displayName: "Robin" },
];

const tap: Action = { type: "tap" };
const reset: Action = { type: "reset" };

// Every module in the app runs this. If a future game cannot pass it, the
// platform's undo and reconnect guarantees do not hold for that game.
runGameModuleContract(dummyModule, {
  config: { targetTaps: 3, bonusEnabled: true },
  players,
  happyPath: [
    { action: tap, bySeat: 0 },
    { action: tap, bySeat: 0 },
    { action: tap, bySeat: 0 },
    { action: tap, bySeat: 0 },
    { action: tap, bySeat: 0 },
  ],
  invalidActions: [
    { type: "nope" },
    {},
    null,
    "tap",
    { type: 42 },
  ],
  unauthorized: [
    // Only the host may reset, and the contract requires the module to say so
    // rather than relying on the button being hidden.
    { action: reset, bySeat: 1 },
    { action: tap, bySeat: "nonmember" },
  ],
});

describe("dummy module specifics", () => {
  const ctx = (seq: number, seat: number | null) => ({
    sessionId: "s",
    seq,
    now: 1_700_000_000_000,
    rng: createRng("seed", seq),
    actor: seat === null ? null : players[seat]!,
    players,
    hostUserId: players[0]!.userId,
  });

  const initial = (target = 5, bonus = false) =>
    dummyModule.createInitialState({
      config: { targetTaps: target, bonusEnabled: bonus },
      players,
      ctx: ctx(0, null),
    });

  it("scores exactly one per tap when bonuses are off", () => {
    const after = dummyModule.reduce(initial(5, false), tap, ctx(1, 0));
    expect(after.taps["u-host"]).toBe(1);
    expect(after.lastGain["u-host"]).toBe(1);
  });

  it("declares a winner at the target", () => {
    let state = initial(2, false);
    state = dummyModule.reduce(state, tap, ctx(1, 0));
    expect(dummyModule.isFinished(state)).toBe(false);
    state = dummyModule.reduce(state, tap, ctx(2, 0));
    expect(state.winner).toBe("u-host");
    expect(dummyModule.isFinished(state)).toBe(true);
  });

  it("refuses further taps once someone has won", () => {
    let state = initial(1, false);
    state = dummyModule.reduce(state, tap, ctx(1, 0));
    expect(dummyModule.authorize(state, tap, ctx(2, 1)).ok).toBe(false);
  });

  it("gives the same bonus for the same seq, and can differ across seqs", () => {
    const state = initial(50, true);
    const a1 = dummyModule.reduce(state, tap, ctx(7, 0));
    const a2 = dummyModule.reduce(state, tap, ctx(7, 0));
    expect(a1).toStrictEqual(a2);

    // Over a spread of seqs the draw must actually vary, or the seeding is
    // broken and every "random" outcome in every game would be identical.
    const gains = new Set(
      Array.from({ length: 60 }, (_, i) =>
        dummyModule.reduce(state, tap, ctx(i + 1, 0)).lastGain["u-host"],
      ),
    );
    expect(gains.size).toBeGreaterThan(1);
  });

  it("ranks ties at the same placement", () => {
    const state = initial(10, false);
    const result = dummyModule.getResult(state, players);
    expect(result.players.every((p) => p.placement === 1)).toBe(true);
  });

  it("resets every score, not just the leader's", () => {
    let state = initial(10, false);
    state = dummyModule.reduce(state, tap, ctx(1, 0));
    state = dummyModule.reduce(state, tap, ctx(2, 1));
    const after = dummyModule.reduce(state, reset, ctx(3, 0));
    expect(Object.values(after.taps)).toEqual([0, 0, 0]);
    expect(after.totalTaps).toBe(0);
  });
});
