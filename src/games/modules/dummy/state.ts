import { z } from "zod";

/*
  Schemas for the dummy module.

  Declared once with zod so the TypeScript type and the runtime validator can
  never drift apart: `Config`, `State` and `Action` below are inferred from
  these, and the same objects are what the server parses untrusted input with.
*/

export const ConfigSchema = z.object({
  /** Taps needed to win. */
  targetTaps: z.number().int().min(1).max(50),
  /** Whether a tap can score two instead of one, decided by the seeded RNG. */
  bonusEnabled: z.boolean(),
});

export const StateSchema = z.object({
  target: z.number().int().min(1),
  bonusEnabled: z.boolean(),
  /** userId -> score. A plain record, so it survives jsonb unchanged. */
  taps: z.record(z.string(), z.number().int().min(0)),
  /** What the last tap scored, per player. Purely for the UI. */
  lastGain: z.record(z.string(), z.number().int()),
  totalTaps: z.number().int().min(0),
  winner: z.string().nullable(),
});

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tap") }),
  z.object({ type: z.literal("reset") }),
]);

export type Config = z.infer<typeof ConfigSchema>;
export type State = z.infer<typeof StateSchema>;
export type Action = z.infer<typeof ActionSchema>;
