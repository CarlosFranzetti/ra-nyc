/**
 * Offline support.
 *
 * This is a phone app people open on the way out, and the walk to the venue is
 * mostly underground. The query cache already persists to localStorage, so a
 * returning visitor sees their last day painted from disk — but that only works
 * if the *app itself* loads, and with no signal it did not load at all.
 *
 * Hand-written rather than a Workbox build. The whole policy is a handful of
 * rules, and a plugin would add a build step and ~15 kB to save writing them.
 *
 * ## The rules
 *
 * - **Navigations** — network first, falling back to the cached shell. A stale
 *   shell that renders beats a dinosaur.
 * - **Hashed assets** (`/assets/*`) — cache first. Vite content-hashes them, so
 *   a given URL's bytes never change and revalidating is pure waste.
 * - **`/api/events`** — stale-while-revalidate, retained for roughly a
 *   5-months-back / 1-month-ahead window of days (see `MAX_DATA_ENTRIES`). The
 *   listings you looked at last are the listings you want on the platform; the
 *   network updates them if it can. This is the rule that actually makes the
 *   app usable offline. A day with no saved copy at all degrades to a
 *   well-formed empty response rather than an error — see `handleEvents`.
 * - **RA flyers** (`images.ra.co`, direct, and `/api/image`, our own proxy
 *   fallback) — cache first, capped at `MAX_IMG_ENTRIES` with the oldest
 *   *touch* evicted first. This is the one deliberate exception to leaving
 *   other origins alone below: the whole point is to make a flyer that has
 *   already been seen open instantly, which needs its bytes in *our* cache,
 *   not just RA's CDN having served them once.
 *
 * Everything else — search, artist resolution, venue geocoding, tiles, and
 * every third-party request a set's player makes — is left alone entirely.
 * They are answers to questions asked *now* (a stale one is worse than an
 * honest failure), or bytes this file has no business touching.
 *
 * ## What this can't do: keep a playing set alive offline
 *
 * The transport plays sets through each provider's own iframe/widget (see
 * `src/lib/players/soundcloud.ts` and friends) — a separate browsing context
 * on the provider's origin, streaming through *their* infrastructure with
 * *their* own request patterns (chunked, ranged, token-signed). This worker's
 * scope is this origin; it never sees those requests and has no way to make
 * them replayable offline. Saying otherwise here would be exactly the kind of
 * claim nobody could verify until the signal actually drops. If SoundCloud
 * (etc.) buffered ahead, playback survives a short dropout on its own — that's
 * their player, not something built here.
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
const IMG_CACHE = `ra-img-${VERSION}`;

/** Enough to render the app with no network at all. */
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/ra-favicon.svg"];

/**
 * Bounds the data cache. One entry per `date=` visited, and the ask is for
 * roughly five months back and a month ahead to survive — ~150 + ~30 days —
 * so 200 gives that room without being "cache every day anyone ever looked
 * at". Oldest-*fetched*-first eviction (see `trim`), which in practice means
 * the window that survives is whatever the person actually browsed, not a
 * literal date cutoff — nothing here can look at a query string date and
 * decide it's "too old to keep" without also running the risk of evicting a
 * day someone deliberately jumped back to five minutes ago.
 */
const MAX_DATA_ENTRIES = 200;

/**
 * Bounds the flyer cache. Sized off the priority window product design asked
 * for — 3 weeks back to 1 week ahead, ~28 nights, at maybe ten-ish flyers a
 * night — rounded up so that window comfortably fits with slack left over for
 * whatever opportunistic caching happens outside it. Eviction is a *touch*
 * order (see `handleImage`), not insertion order, so a flyer from outside the
 * window that nobody has reopened is what ages out first — the priority
 * window stays warm for free, by virtue of being what people keep reopening,
 * with no per-entry date bookkeeping required to enforce it.
 */
const MAX_IMG_ENTRIES = 300;

/**
 * RA's flyer CDN. The only cross-origin host this file ever touches — see the
 * exception carved out in `fetch` below. `/api/image` (our own same-origin
 * proxy fallback, used when this host's hotlink protection blocks a direct
 * browser request) is matched separately, by path, since it's same-origin.
 */
const IMG_HOSTS = new Set(["images.ra.co"]);

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
  const keep = new Set([SHELL_CACHE, ASSET_CACHE, DATA_CACHE, IMG_CACHE]);
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
  if (response) return response;

  // Nothing saved for this day and no network to ask: a 503 with a bare error
  // body used to land here, which the app renders as the same red "failed to
  // load" screen a real RA outage produces — indistinguishable from an actual
  // bug while just being offline. The app already has a rendering for
  // "nothing here, and here's why" (the `stale` banner over an empty list —
  // see `EventsResponse` / `HomePage`), so answer in that shape instead: a
  // normal 200, not fabricated events, just an honest zero. `stale` here means
  // exactly what it always means to the UI — don't trust this as current —
  // it's just this file saying it instead of the API.
  const date = new URL(request.url).searchParams.get("date") ?? "";
  return new Response(
    JSON.stringify({ date, events: [], count: 0, stale: true }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Cache-first for RA flyers, whichever of the two paths a request took to get
 * here (see `IMG_HOSTS` / the `/api/image` match in `fetch`).
 *
 * A cache hit is returned immediately and, in the background, re-inserted —
 * delete then put — so its position in `cache.keys()` moves to the end. That
 * turns the plain insertion-order `trim` above into an actual LRU for this
 * cache: what gets evicted is whatever has gone longest *unopened*, not
 * whatever merely arrived first. A flyer inside the priority window is, by
 * definition, one people keep reopening, so this is what keeps it resident
 * without this file ever having to compute what the window is.
 */
async function handleImage(request) {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    void cache.delete(request).then(() => cache.put(request, cached.clone()));
    return cached;
  }

  try {
    const response = await fetch(request);
    // A direct cross-origin image request is `no-cors`, so the response here
    // is opaque — status 0, body unreadable to this script, and there is no
    // way to tell a real flyer from a hotlink-protection rejection apart from
    // one another. Caching it anyway is the only way to cache a directly
    // loaded flyer at all; a same-origin `/api/image` response can be checked
    // properly, so that branch only caches an actual 2xx.
    const cacheable = response.type === "opaque" || response.ok;
    if (cacheable) {
      await cache.put(request, response.clone());
      void trim(IMG_CACHE, MAX_IMG_ENTRIES);
    }
    return response;
  } catch {
    // No cache, no network: let the caller's own fallback (EventThumb's
    // proxied retry, or its venue-initial placeholder) handle it — a flyer is
    // never worth blocking on, so this never throws past `respondWith`.
    return new Response(null, { status: 504, statusText: "Offline" });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // The one deliberate exception to "leave other origins alone" below — see
  // `IMG_HOSTS`. Checked before the origin bail-out because this host is, by
  // definition, cross-origin.
  if (IMG_HOSTS.has(url.hostname)) {
    event.respondWith(handleImage(request));
    return;
  }

  // Third-party requests — tiles, players, fonts — are left entirely alone.
  // Caching another origin's bytes here would be both wasteful and a quiet
  // way to break their own cache policy.
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
    return;
  }

  if (url.pathname === "/api/image") {
    event.respondWith(handleImage(request));
  }
});
