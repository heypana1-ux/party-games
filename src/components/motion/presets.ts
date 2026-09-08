import type { Transition, Variants } from "framer-motion";

/*
  Motion presets.

  Transitions are short and spring-free by default. A party game is played on
  whatever phone is in someone's pocket, and a 400ms flourish between "I tapped"
  and "something happened" reads as lag, not polish. Anything longer than this
  belongs to a moment the player is meant to wait for — a result reveal — not to
  ordinary interaction.

  `prefers-reduced-motion` is handled globally in globals.css, so these do not
  need to branch.
*/

export const quick: Transition = { duration: 0.16, ease: [0.4, 0, 0.2, 1] };
export const settle: Transition = { duration: 0.28, ease: [0.16, 1, 0.3, 1] };

/** Phase changes: lobby -> setup -> play -> result. */
export const phaseVariants: Variants = {
  enter: { opacity: 0, y: 12 },
  center: { opacity: 1, y: 0, transition: settle },
  exit: { opacity: 0, y: -8, transition: quick },
};

/** Items appearing in a list, e.g. a player joining the lobby. */
export const listItemVariants: Variants = {
  enter: { opacity: 0, scale: 0.96 },
  center: { opacity: 1, scale: 1, transition: quick },
  exit: { opacity: 0, scale: 0.96, transition: quick },
};
