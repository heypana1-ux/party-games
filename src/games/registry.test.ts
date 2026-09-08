import { describe, expect, it } from "vitest";
import { GAME_MODULES, assertRegistryIsSound, gameCatalog, getModule } from "@/games/registry";

describe("game registry", () => {
  it("has no duplicate ids", () => {
    expect(() => assertRegistryIsSound()).not.toThrow();
  });

  it("resolves every registered module by id", () => {
    for (const meta of gameCatalog) {
      expect(getModule(meta.id)).not.toBeNull();
    }
  });

  it("returns null for an unknown game rather than throwing", () => {
    // A session can outlive the module that started it, so this path is real.
    expect(getModule("game-that-was-removed")).toBeNull();
  });

  it("exposes catalogue metadata without reducers", () => {
    expect(gameCatalog).toHaveLength(GAME_MODULES.length);
    for (const meta of gameCatalog) {
      expect(meta).not.toHaveProperty("reduce");
    }
  });
});
