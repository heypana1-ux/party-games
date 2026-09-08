import { z } from "zod";

/*
  Validators for the platform's own vocabulary. Games validate their own
  actions; these cover the things the shell itself accepts from a client.
*/

/** The room-code alphabet: no I/1/L and no O/0, because people read these aloud. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const RoomCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/, "invalid_code");

export const DisplayName = z
  .string()
  .trim()
  .min(2, "name_too_short")
  .max(24, "name_too_long")
  // Control characters and newlines let a name break out of the layout or
  // impersonate UI text in a player list.
  .regex(/^[^\p{Cc}\p{Cf}]+$/u, "invalid_name");

export const Uuid = z.string().uuid();

export const RoomSettings = z.object({
  max_players: z.number().int().min(1).max(24).optional(),
  is_locked: z.boolean().optional(),
});

/** Body of a game action command. The `action` itself is opaque here — only
 *  the game module knows its shape, and it is parsed against the module's own
 *  schema one layer further in. */
export const ActionCommand = z.object({
  clientActionId: Uuid,
  expectedRevision: z.number().int().min(0),
  action: z.unknown(),
});

export const StartSessionCommand = z.object({
  gameId: z.string().min(1).max(64),
  config: z.unknown(),
  seatedUserIds: z.array(Uuid).min(1).max(24).optional(),
});

export const UndoCommand = z.object({
  expectedRevision: z.number().int().min(0),
});
