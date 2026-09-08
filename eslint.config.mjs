import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

/*
  Module boundaries.

  The three rules below are the only thing that keeps the platform a platform.
  Nothing about the folder layout physically stops the shell from importing a
  game, or a game from reaching into the shell — and both are one convenient
  import away at 2am. Left unenforced, the second game is the one that hurts:
  by then the shell has quietly grown knowledge of the first.
*/
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTypeScript,

  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),

  {
    // The shell may know that games exist. It may not know what any of them is.
    files: ["src/platform/**/*.{ts,tsx}", "src/components/shell/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/games/modules/*", "**/games/modules/*"],
              message:
                "The shell must not import a concrete game. Go through @/games/registry.",
            },
          ],
        },
      ],
    },
  },

  {
    // A game gets the contract and shared UI. Never the shell, never the database.
    files: ["src/games/modules/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/platform/**", "**/platform/**"],
              message:
                "Game modules must not reach into the shell. Everything a module needs arrives via GameViewProps and ActionContext.",
            },
            {
              group: ["@/lib/supabase/*", "**/lib/supabase/*"],
              message:
                "Game modules never talk to the database. The platform persists state for them.",
            },
          ],
        },
      ],
    },
  },

  {
    // Server authority must not be bundled into a client component.
    files: ["src/components/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/platform/server/*", "@/lib/supabase/admin"],
              message:
                "Server-only code (service-role key, authoritative reducers) must stay out of client bundles.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
