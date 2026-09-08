import type { AnyGameModule, GameMeta } from "@/games/contract/types";
import dummyModule from "@/games/modules/dummy";

/*
  The game registry.

  This is the only file that changes when a game is added. A new game is a new
  folder under `modules/` plus one line in the array below — no new route, no
  new table, no shell code. If adding a game ever requires touching anything
  else, the module boundary has sprung a leak.
*/

const MODULES = [
  dummyModule,
  // Future games go here, one line each:
  // horseRaceModule,
];

/*
  The cast is deliberate and is the one place static typing genuinely ends.

  A game id is a string read from a database column, so at this boundary the
  state type really is unknown — no amount of generics recovers it. Rather than
  fake it, the registry hands back `unknown` and the command pipeline re-earns
  safety at runtime through `module.schemas`. Using `any` here would let
  unvalidated values slide all the way into a reducer unnoticed.
*/
export const GAME_MODULES: readonly AnyGameModule[] =
  MODULES as unknown as readonly AnyGameModule[];

const BY_ID = new Map<string, AnyGameModule>(
  GAME_MODULES.map((m) => [m.meta.id, m]),
);

export function getModule(id: string): AnyGameModule | null {
  return BY_ID.get(id) ?? null;
}

/** Metadata only — safe to render anywhere, carries no reducer. */
export const gameCatalog: readonly GameMeta[] = GAME_MODULES.map((m) => m.meta);

export function getMeta(id: string): GameMeta | null {
  return BY_ID.get(id)?.meta ?? null;
}

/** Guards against two modules claiming the same id, which would silently
 *  shadow one of them and route sessions to the wrong reducer. */
export function assertRegistryIsSound(): void {
  const ids = GAME_MODULES.map((m) => m.meta.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length > 0) {
    throw new Error(`duplicate game ids in registry: ${duplicates.join(", ")}`);
  }
}
