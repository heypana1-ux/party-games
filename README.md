# Party Games

A collection of party and drinking games that a group plays together on their own phones.
One person hosts a room, everyone else joins with a six-character code, and the host picks
what to play. Guests need no account — a name is enough.

This repository is the **platform**, plus one deliberately boring game (`dummy`, "Tap Test")
that exists to prove the platform works. Real games arrive as modules.

## The one idea worth knowing

The platform never lets a phone decide what happened.

```
phone ──"I'd like to tap"──▶ Next.js Route Handler ──▶ Postgres
                             1. who is calling? (session cookie)
                             2. are they in this room? (RLS)
                             3. is the action well-formed? (zod)
                             4. may they do it now? (module.authorize)
                             5. what happens? (module.reduce — pure)
                             6. commit with compare-and-swap
                                        │
     all phones ◀── Realtime: the whole new state ──┘
```

A client sends an *intent* and an idempotency key. It never sends a state, an actor, or an
outcome. Every game state change in the app goes through
[`src/platform/server/applyAction.ts`](src/platform/server/applyAction.ts), and no table has
an insert/update/delete policy that a browser could use.

Because Realtime carries the **whole** state on every change, a phone that missed a message
is correct again after the next one. That is what makes reconnecting — a locked screen, a tab
switch, a lift — a non-event: read the snapshot, done.

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in your own Supabase project
npm run dev
```

Supabase setup — creating the project, applying the migrations, **enabling anonymous
sign-in**, and wiring up hCaptcha — is in [`supabase/README.md`](supabase/README.md). The app
needs its own Supabase project; do not point it at another app's.

Without `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` the captcha is skipped, so `npm run dev` works
against a project that has Attack Protection turned off. Turn the two on together: Supabase
refusing sign-ins that carry no captcha token looks exactly like anonymous sign-in being
disabled.

```bash
npm run typecheck   # next typegen + tsc
npm run lint        # includes the module-boundary rules
npm test            # unit + contract tests
npm run e2e         # Playwright, phone viewports
```

## Adding a game

A game is a folder and one line. Nothing in the shell changes.

1. Create `src/games/modules/<your-game>/` with a module that satisfies
   [`GameModule`](src/games/contract/types.ts).
2. Add it to the array in [`src/games/registry.ts`](src/games/registry.ts).
3. Run the contract test against it:

   ```ts
   import { runGameModuleContract } from "@/games/contract/testing/contract";
   runGameModuleContract(yourModule, { players, happyPath, invalidActions, unauthorized });
   ```

`src/games/modules/dummy/` is the worked example, in about 150 lines.

### Three rules a module must follow

The contract test enforces all three, because none of them is visible to the type system and
all three are load-bearing:

1. **`reduce` is pure.** No mutation of the state it is handed.
2. **No ambient randomness or time.** Use `ctx.rng` and `ctx.now`, never `Math.random()` or
   `Date.now()`. Undo works by replaying the action log; a reducer that reads the clock or
   draws its own randomness would replay into a *different game*.
3. **State is JSON.** No `Date`, `Map`, `Set` or `undefined` — it lives in a `jsonb` column
   and travels over Realtime.

In exchange, the platform gives every module undo, reconnect, host handover, presence,
history and authorisation for free. A module never writes an inverse of its own moves and
never talks to the database.

## Layout

```
src/
  app/              routes; /api holds the state-changing endpoints
  platform/         the shell. Knows that games exist, not what any of them is.
    server/         the only code with write authority
    session/        realtime store, optimistic buffer, resync
  games/
    contract/       the GameModule interface, seeded RNG, contract test
    registry.ts     ← the only file a new game touches
    modules/        one folder per game
  components/ui/    shadcn-style primitives
  components/shell/ game-agnostic UI: lobby, host bar, states
supabase/migrations/ schema, RLS, RPCs, retention
tests/               integration (needs a live project) and E2E
```

Three ESLint rules keep those boundaries real: the shell cannot import a game, a game cannot
import the shell or the database, and server authority cannot be pulled into a client bundle.
Try it and the lint fails — the boundary is not a convention.

## Design

Dark only, casino-and-bar rather than playful, built for one hand. Primary actions sit in the
lower half of the screen and are at least 48px tall. **Gold means host**: it is used for
nothing else, so nobody has to wonder whether a control is theirs to press. Players do not see
host controls greyed out — they do not see them at all.

## Deliberately not built yet

- No real game. The horse-racing card game is the first module to port, and it is next.
- No hidden information. Games where players hold private cards need a `projectState` step in
  the contract before a full state broadcast is safe. The place it goes is known; it is not
  built, because nothing needs it yet.
- No offline queueing. A tap that lands thirty seconds late is worse than one that never
  happened, so the app says it is offline and disables the controls instead.
