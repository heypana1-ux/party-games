"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "party-games:name";

/*
  Remembers the name you last used, so the second night out is one tap shorter.

  localStorage is the right home for this and only this: it is a per-device
  convenience, it is never read back by the server, and losing it costs the user
  one text field. Anything that has to survive a reinstall or be seen by other
  players lives in Postgres.

  Read through useSyncExternalStore rather than an effect, so the server render
  and the first client render agree on an empty value and the real one arrives
  without a second render pass.
*/

let cached: string | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): string {
  if (cached === null) {
    try {
      cached = localStorage.getItem(KEY) ?? "";
    } catch {
      // Private mode, or site data blocked. An empty name is a fine fallback.
      cached = "";
    }
  }
  return cached;
}

/** There is no localStorage on the server; everyone starts with a blank field. */
function getServerSnapshot(): string {
  return "";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useStoredName(): [string, (name: string) => void] {
  const name = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const store = useCallback((next: string) => {
    cached = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Ignored on purpose — see above.
    }
    for (const listener of listeners) listener();
  }, []);

  return [name, store];
}
