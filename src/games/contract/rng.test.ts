import { describe, expect, it } from "vitest";
import { createRng, createSeed, shuffle } from "@/games/contract/rng";

/*
  These properties are what undo rests on. If any of them stops holding, replay
  produces a different game than the one that was played.
*/
describe("deterministic rng", () => {
  it("gives the same sequence for the same seed and seq", () => {
    const a = createRng("seed-a", 3);
    const b = createRng("seed-a", 3);
    const first = Array.from({ length: 20 }, () => a());
    const second = Array.from({ length: 20 }, () => b());
    expect(first).toEqual(second);
  });

  it("separates draws by seq", () => {
    expect(createRng("seed-a", 1)()).not.toBe(createRng("seed-a", 2)());
  });

  it("separates draws by seed", () => {
    expect(createRng("seed-a", 1)()).not.toBe(createRng("seed-b", 1)());
  });

  it("stays inside [0, 1)", () => {
    const rng = createRng("bounds", 1);
    for (let i = 0; i < 5000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("shuffles reproducibly and keeps every element", () => {
    const cards = Array.from({ length: 52 }, (_, i) => i);
    const a = shuffle(cards, createRng("deck", 1));
    const b = shuffle(cards, createRng("deck", 1));
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(cards);
    expect(a).not.toEqual(cards);
  });

  it("does not mutate the input", () => {
    const cards = [1, 2, 3, 4, 5];
    shuffle(cards, createRng("x", 1));
    expect(cards).toEqual([1, 2, 3, 4, 5]);
  });

  it("mints distinct seeds", () => {
    const seeds = new Set(Array.from({ length: 200 }, () => createSeed()));
    expect(seeds.size).toBe(200);
  });
});
