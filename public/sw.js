/**
 * Offline support.
 *
 * This is a phone app people open on the way out, and the walk to the venue is
 * mostly underground. The query cache already persists to localStorage, so a
 * returning visitor sees their last day painted from disk — but that only works
 * if the *app itself* loads, and with no signal it did not load at all.
 *
 * Hand-written rather than a Workbox build. The whole policy is three rules,
 * and a plugin would add a build step and ~15 kB to save writing them.
 *
 * ## The rules
 *
 * - **Navigations** — network first, falling back to the cached shell. A stale
 *   shell that renders beats a dinosaur.
 * - **Hashed assets** (`/assets/*`) — cache first. Vite content-hashes them, so
 *   a given URL's bytes never change and revalidating is pure waste.
 * - **`/api/events`** — stale-while-revalidate. The listings you looked at last
 *   are the listings you want on the platform; the network updates them if it
 *   can. This is the rule that actually makes the app usable offline.
 *
 * Everything else — search, artist resolution, venue geocoding, tiles — is
 * network-only. They are answers to questions asked *now*, and a stale one is
 * worse than an honest failure.
 *
 * ## Versioning
 *
 * `skipWaiting` is deliberately NOT called. A new worker taking over mid-session
 * would leave a page holding old hashed asset URLs that the new cache no longer
 * has, and lazy chunks would start 404ing under someone's fingers. It activates
 * on the next load instead, which is one visit slower and cannot break a live
 * one.
 */

const VERSION = "v1";
const SHELL_CACHE = `ra-shell-${VERSION}`;
const ASSET_CACHE = `ra-assets-${VERSION}`;
const DATA_CACHE = `ra-data-${VERSION}`;

/** Enough to render the app with no network at all. */
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/ra-favicon.svg"];

/** Bounds the data cache; a day per entry, and nobody scrolls back for ever. */
const MAX_DATA_ENTRIES = 60;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individually, not addAll: addAll rejects the whole install if any one
      // request fails, and an install that fails leaves no worker at all.
      .then((cache) =>
        Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined))),
      ),
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, ASSET_CACHE, DATA_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Oldest-first eviction, so the cache cannot grow without bound. */
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((key) => cache.delete(key)));
}

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    // Only the shell is worth keeping; a navigation response *is* the shell,
    // because every route rewrites to index.html.
    const cache = await caches.open(SHELL_CACHE);
    cache.put("/index.html", response.clone());
    return response;
  } catch {
    const cached = (await caches.match("/index.html")) ?? (await caches.match("/"));
    if (cached) return cached;
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function handleAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(ASSET_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function handleEvents(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      // Never cache the degraded answer the API serves when RA is down — it
      // would pin a stale day in place long after RA recovered.
      if (response.ok) {
        cache.put(request, response.clone());
        void trim(DATA_CACHE, MAX_DATA_ENTRIES);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Refresh behind the scenes; the caller gets the cached copy immediately.
    void network;
    return cached;
  }

  const response = await network;
  return (
    response ??
    new Response(JSON.stringify({ error: "Offline and not saved yet" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Third-party requests — tiles, players, fonts, images — are left entirely
  // alone. Caching another origin's bytes here would be both wasteful and a
  // quiet way to break their own cache policy.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(handleAsset(request));
    return;
  }

  if (url.pathname === "/api/events") {
    event.respondWith(handleEvents(request));
  }
});
