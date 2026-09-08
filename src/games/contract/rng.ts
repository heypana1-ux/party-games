/*
  Deterministic randomness.

  A card game needs a shuffle, and a shuffle needs randomness — but the platform
  replays the action log to implement undo, and it re-runs reducers on the
  server. If a reducer called Math.random(), the same log would fold into a
  different state every time and undo would quietly deal a different hand.

  So randomness is a value, not an ambient capability: every action gets an RNG
  derived from the session seed and that action's `seq`. Because `seq` is never
  reissued — not even after an undo — an action keeps the exact draw it was
  decided with for the life of the session.
*/

/** Turns an arbitrary string into a 32-bit seed. xmur3, public domain. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** mulberry32: small, fast, good enough for shuffling cards. Public domain. */
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The RNG handed to a reducer. Same `(seed, seq)` always yields the same
 * sequence of numbers, on any machine, in any process.
 */
export function createRng(seed: string, seq: number): () => number {
  return mulberry32(xmur3(`${seed}#${seq}`)());
}

/** A fresh session seed. Only ever created once, then stored on the session. */
export function createSeed(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fisher-Yates using an injected RNG. Offered here so modules do not each
 * write their own subtly-biased shuffle — the classic mistake is
 * `floor(rng() * length)` for every index, which is not uniform.
 */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
