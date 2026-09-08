"use client";

import { useEffect } from "react";

/** Registers the service worker. Kept in its own component so the root layout
 *  stays a Server Component. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
