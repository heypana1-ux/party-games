/*
  Party Games service worker.

  It caches the app shell so the app opens instantly and shows a real page when
  the phone has no signal. It caches nothing else — and that restriction is the
  point, not an omission.

  A cached game state is worse than no state at all: it would show a player a
  board from two minutes ago, with buttons that look live. So every API call and
  every Supabase request goes to the network, always, and fails visibly when the
  network is gone.
*/

const CACHE = "party-shell-v1";

const SHELL = ["/", "/join", "/games", "/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Anything that carries live truth must never be served from a cache. */
function isLiveData(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/room/") ||
    url.hostname.endsWith(".supabase.co") ||
    url.pathname.includes("/realtime/")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isLiveData(url)) return; // straight to the network, no interception

  // Navigations: network first, cached shell second, offline page last. A
  // stale shell is fine; it fetches its own live data once it boots.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match("/offline"))),
    );
    return;
  }

  // Build assets are content-hashed, so a cache hit is always correct.
  if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            return response;
          }),
      ),
    );
  }
});
