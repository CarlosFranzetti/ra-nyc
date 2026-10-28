/**
 * End-to-end checks for offline support.
 *
 * Run with:  npm run test:offline
 *
 * Runs against the **built** output served statically, not the dev server: the
 * worker is registered only in a production build, and Vite's dev module graph
 * is exactly what it must not sit in front of.
 *
 * The assertions that matter are the second load with the network cut. Anything
 * that merely proves the worker registered would pass just as happily with a
 * worker that caches nothing.
 */
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 5202);
const BASE = `http://127.0.0.1:${PORT}`;
const DIST = new URL("../dist", import.meta.url).pathname;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), ".cache", "ms-playwright"),
    join(homedir(), "Library", "Caches", "ms-playwright"),
  ].filter(Boolean);
  const binaries = [
    ["chrome-linux", "chrome"],
    ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
    ["chrome-win", "chrome.exe"],
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).filter((d) => d.startsWith("chromium"))) {
      for (const parts of binaries) {
        const candidate = join(root, entry, ...parts);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  throw new Error("No Chromium found. Run `npx playwright install chromium`.");
}

if (!existsSync(join(DIST, "index.html"))) {
  console.error("No dist/ — run `npm run build` first.");
  process.exit(1);
}

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain",
};

/**
 * The night, not the calendar date.
 *
 * The app opens on the night in progress, which before 3:30am is yesterday —
 * see lib/night.ts. This file used `toISOString().slice(0, 10)`, so between
 * midnight and 3:30am it asked the worker to refresh a day the app was not
 * looking at: the message arrived, the right query was invalidated, and the
 * list on screen — a different day — correctly did not change. The test read
 * that as the correction failing.
 *
 * A second copy of the rollover rather than an import, like the size ladder in
 * the settings suite: a change to it has to be meant.
 */
const TODAY = (() => {
  const now = new Date();
  const night = new Date(now);
  if (now.getHours() * 60 + now.getMinutes() < 3 * 60 + 30) {
    night.setDate(night.getDate() - 1);
  }
  const pad = (n) => String(n).padStart(2, "0");
  return `${night.getFullYear()}-${pad(night.getMonth() + 1)}-${pad(night.getDate())}`;
})();
/**
 * A night `n` days from the night in progress, as `yyyy-MM-dd`.
 *
 * Built from `TODAY` at local noon so that adding days across a daylight-saving
 * boundary cannot land an hour short and roll the date.
 */
const shift = (n) => {
  const [y, m, d] = TODAY.split("-").map(Number);
  const at = new Date(y, m - 1, d + n, 12);
  const pad = (v) => String(v).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};
// A night well past the worker's month of "live", so it is history: 200 days,
// which is also past the 120-day live window the client keeps on disk. And two
// nights inside the live window, beyond the week the app scans on load, so
// nothing else in this file has already asked for them.
const OLD = shift(-200);
const DEGRADED_DAY = shift(20);
const SETTLED_DAY = shift(21);
// The smallest possible valid PNG (a 1x1 transparent pixel) — enough for the
// browser to treat it as a real image (decodes, paints, no broken-image icon)
// without needing real flyer bytes.
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const FLYER_URL = "https://images.ra.co/does-not-resolve-in-this-sandbox.jpg";
/**
 * Set once the test wants the server to answer with a day that has grown since
 * it was cached — a party announced after somebody last opened that night,
 * which is the exact shape of the bug this covers.
 */
let announcedSince = false;

const extraEvent = {
  id: "e2",
  title: "Newly Announced",
  date: `${TODAY}T00:00:00.000`,
  startTime: `${TODAY}T23:00:00.000`,
  endTime: null,
  url: "https://ra.co/events/2",
  imageUrl: null,
  venue: { name: "feedbk", area: "New York" },
  artists: [],
  attending: 25,
  isPick: false,
  pickBlurb: null,
};

const payload = (stale, day = TODAY, title = stale ? "Saved Night" : "Live Night") =>
  JSON.stringify({
    date: day,
    count: announcedSince ? 2 : 1,
    stale,
    events: [
      {
        id: "e1",
        title,
        date: `${day}T00:00:00.000`,
        startTime: `${day}T22:00:00.000`,
        endTime: null,
        url: "https://ra.co/events/1",
        // A real (unreachable, from this sandbox) images.ra.co URL, so
        // `EventThumb`'s "direct" attempt fails the same way a hotlink-blocked
        // load would in production, and falls back to `/api/image?u=...` —
        // which this server serves for real, same-origin, and which the
        // worker's `ra-img-v1` cache can actually intercept and store.
        imageUrl: FLYER_URL,
        venue: { name: "Nowadays", area: "New York" },
        artists: [],
        attending: 10,
        isPick: false,
        pickBlurb: null,
      },
      ...(announcedSince ? [extraEvent] : []),
    ],
  });

/**
 * A real static server rather than Playwright routing, because a service worker
 * is not installed for routes the browser never actually fetched.
 */
let apiHits = 0;
let imageHits = 0;
/** Requests that reached the network, by `date=`. */
const hitsByDate = new Map();
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", BASE);

  if (url.pathname === "/api/events") {
    apiHits += 1;
    const date = url.searchParams.get("date") ?? "";
    hitsByDate.set(date, (hitsByDate.get(date) ?? 0) + 1);
    res.writeHead(200, { "Content-Type": "application/json" });
    // A past night is settled: the same listings every time, and a distinct
    // title so a test can tell it from tonight's. The degraded day is the
    // API's answer when RA is down — a plain 200 whose body says `stale`.
    if (date === OLD) res.end(payload(false, OLD, "Old Night"));
    else if (date === DEGRADED_DAY) res.end(payload(true, DEGRADED_DAY));
    else if (date === SETTLED_DAY) res.end(payload(false, SETTLED_DAY));
    else res.end(payload(false));
    return;
  }

  if (url.pathname === "/api/image") {
    imageHits += 1;
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
    res.end(PIXEL_PNG);
    return;
  }

  // Everything under /api that isn't events or image: not cached by the worker.
  if (url.pathname.startsWith("/api/")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
    return;
  }

  const rel = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, rel);
  if (!file.startsWith(DIST)) file = join(DIST, "index.html");
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");

  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": file.endsWith("sw.js") ? "no-cache" : "public, max-age=60",
  });
  createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const browser = await chromium.launch({ executablePath: findChromium() });
const context = await browser.newContext({ serviceWorkers: "allow" });
const page = await context.newPage();

// ── first visit: everything from the network, worker installs behind it
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector("text=Live Night", { timeout: 20000 });
check("the app renders online", true);

const registered = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return Boolean(reg.active);
});
check("a service worker takes control", registered === true);

// Give the worker a moment to populate its caches from the requests it saw.
await page.waitForTimeout(1500);
await page.reload({ waitUntil: "load" });
await page.waitForSelector("text=Live Night", { timeout: 20000 });

const cacheNames = await page.evaluate(() => caches.keys());
check("it keeps separate caches for shell, assets, data and images",
  cacheNames.some((n) => n.startsWith("ra-shell")) &&
    cacheNames.some((n) => n.startsWith("ra-assets")) &&
    cacheNames.some((n) => n.startsWith("ra-data")) &&
    cacheNames.some((n) => n.startsWith("ra-img")),
  cacheNames.join(", "));

const cachedDay = await page.evaluate(async () => {
  const names = await caches.keys();
  const data = names.find((n) => n.startsWith("ra-data"));
  if (!data) return 0;
  return (await (await caches.open(data)).keys()).length;
});
check("the day's listings were saved", cachedDay > 0, `${cachedDay} entries`);

// The flyer's "direct" load (images.ra.co) is unreachable from this sandbox,
// so `EventThumb` should have fallen back to `/api/image?u=...` — same-origin,
// and the one path a flyer request can actually take through the worker here.
const proxiedFlyer = await page.evaluate(async (flyerUrl) => {
  const names = await caches.keys();
  const img = names.find((n) => n.startsWith("ra-img"));
  if (!img) return false;
  const cache = await caches.open(img);
  const url = `${location.origin}/api/image?u=${encodeURIComponent(flyerUrl)}`;
  return Boolean(await cache.match(url));
}, FLYER_URL);
check("the flyer's proxied fallback landed in the image cache", proxiedFlyer);

// ── a flyer served from the cache stays in the cache
//
// The hit path re-inserts the entry to move it to the back of the LRU, and
// for two months it did so by deleting first and cloning a body the page was
// already reading — the clone threw, the delete stood, and every flyer was
// evicted the moment it was served. One reload hid it (the cache was still
// full when the reload started); the second reload re-fetched everything.
// Three reloads, checking after each, is the smallest thing that sees it.
const hitsBefore = imageHits;
let stayed = true;
for (let i = 0; i < 3; i += 1) {
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("text=Live Night", { timeout: 20000 });
  await page.waitForTimeout(800);
  const present = await page.evaluate(async (flyerUrl) => {
    const names = await caches.keys();
    const img = names.find((n) => n.startsWith("ra-img"));
    if (!img) return false;
    const cache = await caches.open(img);
    const url = `${location.origin}/api/image?u=${encodeURIComponent(flyerUrl)}`;
    return Boolean(await cache.match(url));
  }, FLYER_URL);
  stayed = stayed && present;
}
check("a flyer served from the cache stays in it across three reloads", stayed);
check("and the proxy is not asked for it again", imageHits === hitsBefore, `${hitsBefore} -> ${imageHits}`);

// ── a day that changed after it was cached corrects itself
//
// This is the other half of stale-while-revalidate, and its absence was a real
// reported bug: a new party was missing from a night the listings showed, while
// search — which reads the database rather than the cache — could find it.
//
// The worker was serving its saved copy and refreshing behind it, but nothing
// ever showed the refreshed copy, so the day stayed as it was when it was first
// opened. The fetch below is what a visit does: it comes back from cache
// instantly, the worker notices upstream has changed, and the page corrects
// itself in place rather than on some later visit.
announcedSince = true;
await page.evaluate((day) => {
  void fetch(`/api/events?date=${day}`);
}, TODAY);
const corrected = await page
  .waitForSelector("text=Newly Announced", { timeout: 10000 })
  .then(() => true)
  .catch(() => false);
check("a night that grew since it was cached corrects itself, with no reload",
  corrected);

// And the cached copy is the new one, so the next cold start is right too.
const cachedNow = await page.evaluate(async (day) => {
  const names = await caches.keys();
  const data = names.find((n) => n.startsWith("ra-data"));
  const cache = await caches.open(data);
  // By date, not `keys[0]`: the opening week scan leaves seven days in here,
  // and the first of them is not necessarily the one that changed.
  const key = (await cache.keys()).find((k) => k.url.includes(`date=${day}`));
  if (!key) return false;
  return (await (await cache.match(key)).text()).includes("Newly Announced");
}, TODAY);
check("and the saved copy was updated too", cachedNow);

// Back to the one-event day for the offline checks below, so what they assert
// is unchanged by the block above.
announcedSince = false;

// ── the actual test: no network at all
await context.setOffline(true);
const offlinePage = await context.newPage();
await offlinePage.goto(BASE, { waitUntil: "load" });

const rendered = await offlinePage
  .waitForSelector("text=Live Night", { timeout: 20000 })
  .then(() => true)
  .catch(() => false);
check("the app loads and shows listings with no network at all", rendered);

// The logo is a lockup of two spans, not one text node, so this matches the
// mark rather than the whole string — `text=RA NYC Events` only ever matched
// while the title was a single <h1> of plain text.
const shellVisible = await offlinePage.locator(".logo-mark").count();
check("the shell renders offline, not a browser error page", shellVisible > 0);

// The cache-first point of `ra-img-v1`: with the network cut entirely, the
// same proxied request still resolves from the worker's cache rather than
// failing — this is what "feels instant" cashes out to.
const imageOffline = await offlinePage.evaluate(async (flyerUrl) => {
  const url = `${location.origin}/api/image?u=${encodeURIComponent(flyerUrl)}`;
  const response = await caches.match(url);
  return Boolean(response);
}, FLYER_URL);
check("a cached flyer is still servable with no network at all", imageOffline);

await offlinePage.close();
await context.setOffline(false);

// ── third-party and non-events API requests must not be intercepted
//
// Settled first: the correction check above deliberately causes a refetch, and
// an in-flight `/api/events` landing after the counter is sampled would be
// read as this endpoint having been fetched when it was not.
await page.waitForTimeout(1500);
const before = apiHits;
await page.evaluate(() => fetch("/api/search?q=test").then((r) => r.text()));
check("only /api/events is cached, other endpoints stay network-only",
  apiHits === before);

// ── a degraded answer is not kept
//
// When RA is down the API serves what it has with `stale: true` — as a 200. The
// worker's guard against caching it was `response.ok`, which that answer
// passes, so the comment saying it was never cached described a check that
// could not fail. The settled day beside it is the control: it goes through the
// same path and *is* kept, so a pass here means the body was read, not that
// nothing is ever stored.
/** How many entries for `day` the cache whose name starts with `prefix` holds; null if there is no such cache. */
const keysIn = (prefix, day) =>
  page.evaluate(async ({ d, p }) => {
    const names = await caches.keys();
    const name = names.find((n) => n.startsWith(p));
    if (!name) return null;
    return (await (await caches.open(name)).keys()).filter((k) => k.url.includes(`date=${d}`)).length;
  }, { d: day, p: prefix });
const degradedBody = await page.evaluate(async (day) => {
  const body = await (await fetch(`/api/events?date=${day}`)).json();
  return { stale: body.stale, count: body.events.length };
}, DEGRADED_DAY);
await page.evaluate((day) => fetch(`/api/events?date=${day}`).then((r) => r.text()), SETTLED_DAY);
check("a degraded answer still reaches the page", degradedBody.stale === true && degradedBody.count === 1,
  JSON.stringify(degradedBody));
check("but is not saved in the data cache", (await keysIn("ra-data", DEGRADED_DAY)) === 0);
check("while a settled day beside it is", (await keysIn("ra-data", SETTLED_DAY)) === 1);

// ── a night from long ago is kept apart, and asked for once
//
// It lives in its own cache so that nights nobody will look at twice cannot
// push the live window out of `ra-data`, and it is cache-first with no
// revalidation: the past does not change, so a second look costs no request.
await page.evaluate((day) => fetch(`/api/events?date=${day}`).then((r) => r.text()), OLD);
check("a night 200 days back is saved in the history cache", (await keysIn("ra-history", OLD)) === 1);
check("and not in the data cache", (await keysIn("ra-data", OLD)) === 0);
const oldHitsBefore = hitsByDate.get(OLD) ?? 0;
const secondLook = await page.evaluate(async (day) => {
  const body = await (await fetch(`/api/events?date=${day}`)).json();
  return body.events[0]?.title;
}, OLD);
check("a second look at it makes no network request",
  secondLook === "Old Night" && (hitsByDate.get(OLD) ?? 0) === oldHitsBefore,
  `${oldHitsBefore} -> ${hitsByDate.get(OLD)}`);

// ── browsing the past leaves no trace on disk and warms nothing around it
//
// Reached the way a person reaches it: through the calendar. The query cache is
// serialised whole into localStorage on every change, so a night from 2026-04
// would be written out and read back on every launch for a day, for a page
// nobody opens twice. And its neighbours must not be prefetched, because each
// would ask the server to go and fetch an old day nobody asked about.
const [oy, om] = OLD.split("-").map(Number);
const [ty, tm] = TODAY.split("-").map(Number);
const monthsBack = (ty - oy) * 12 + (tm - om);
await page.locator('button[aria-label="Pick a date"]').click();
for (let i = 0; i < monthsBack; i += 1) {
  await page.locator('button[aria-label^="Go to the Previous"]').click();
}
await page.locator(`td[data-day="${OLD}"] button`).click();
const browsedOld = await page
  .waitForSelector("text=Old Night", { timeout: 10000 })
  .then(() => true)
  .catch(() => false);
check("a night picked in the calendar from 200 days back is shown", browsedOld);
// The persister writes on a two-second trailing throttle; wait it out so the
// absence below is of a write that has happened, not of one still to come.
await page.waitForTimeout(2800);
const persisted = await page.evaluate(() => localStorage.getItem("ra-nyc:query-cache") ?? "");
check("it is not written to the persisted query cache, though tonight is",
  persisted.includes(TODAY) && !persisted.includes(OLD),
  `${persisted.length} bytes, tonight ${persisted.includes(TODAY)}, old ${persisted.includes(OLD)}`);
const neighbours = [shift(-201), shift(-199), shift(-198)].filter((d) => hitsByDate.has(d));
check("and its neighbours are not prefetched", neighbours.length === 0, neighbours.join(", "));

// ── the image cache is bounded: flood it well past its cap, then let one
// more real request land through the worker's own `handleImage`, and confirm
// the cap held and eviction favoured the oldest-*touched* entry, not just
// whatever showed up first.
const IMG_CACHE_CAP = 300; // keep in sync with MAX_IMG_ENTRIES in public/sw.js
const eviction = await page.evaluate(async ({ cap, flyerUrl }) => {
  const names = await caches.keys();
  const imgCacheName = names.find((n) => n.startsWith("ra-img"));
  if (!imgCacheName) return null;
  const cache = await caches.open(imgCacheName);

  for (let i = 0; i < cap + 20; i++) {
    await cache.put(`https://images.ra.co/dummy-${i}.jpg`, new Response("x"));
  }
  // A fresh URL the worker hasn't seen — forces a real cache-miss fetch
  // through `handleImage`, which is what actually triggers `trim`.
  await fetch(`/api/image?u=${encodeURIComponent(flyerUrl)}&flush=1`);

  // The trim after a cache-miss `put` is fire-and-forget; give it a beat.
  await new Promise((resolve) => setTimeout(resolve, 300));

  const keys = await cache.keys();
  return {
    count: keys.length,
    oldestDummyGone: !(await cache.match("https://images.ra.co/dummy-0.jpg")),
    newestPresent: keys.some((k) => k.url.includes("flush=1")),
  };
}, { cap: IMG_CACHE_CAP, flyerUrl: FLYER_URL });
check(
  "the image cache is capped and evicts the oldest entries first",
  eviction !== null &&
    eviction.count === IMG_CACHE_CAP &&
    eviction.oldestDummyGone &&
    eviction.newestPresent,
  JSON.stringify(eviction),
);

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
