<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working on this repository

## The rule that matters most

A client never decides what happened. Game state changes only in
`src/platform/server/applyAction.ts`, which runs the module's pure reducer on the server and
commits with a compare-and-swap. If you find yourself wanting a table policy that lets
`authenticated` write, or an RPC that takes a state and is callable from a browser, stop —
that removes the platform's only real security property.

## Module boundaries are enforced, not suggested

- `src/platform/**` must not import `src/games/modules/*`. Use `@/games/registry`.
- `src/games/modules/**` must not import `src/platform/**` or `src/lib/supabase/*`.
- Client components must not import `src/platform/server/*` or `src/lib/supabase/admin`.

ESLint fails on all three. Do not add exceptions; the leak is always more convenient than the
boundary, which is exactly why the rules exist.

## Three invariants every game module must keep

Undo and reconnect are implemented by replaying the action log. That only works if:

1. `reduce` is pure and does not mutate its input.
2. Randomness comes from `ctx.rng` and time from `ctx.now` — never `Math.random()` or
   `Date.now()`.
3. State is JSON round-trip safe: no `Date`, `Map`, `Set` or `undefined`.

`runGameModuleContract` in `src/games/contract/testing/contract.ts` checks all three. Every
module must pass it.

## Before you push

```bash
npm run typecheck && npm run lint && npm test
```

`typecheck` runs `next typegen` first because `tsc` needs the generated route types.
