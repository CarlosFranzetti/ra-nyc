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

const TODAY = new Date().toISOString().slice(0, 10);
const payload = (stale) =>
  JSON.stringify({
    date: TODAY,
    count: 1,
    stale,
    events: [
      {
        id: "e1",
        title: stale ? "Saved Night" : "Live Night",
        date: `${TODAY}T00:00:00.000`,
        startTime: `${TODAY}T22:00:00.000`,
        endTime: null,
        url: "https://ra.co/events/1",
        imageUrl: null,
        venue: { name: "Nowadays", area: "New York" },
        artists: [],
        attending: 10,
        isPick: false,
        pickBlurb: null,
      },
    ],
  });

/**
 * A real static server rather than Playwright routing, because a service worker
 * is not installed for routes the browser never actually fetched.
 */
let apiHits = 0;
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", BASE);

  if (url.pathname === "/api/events") {
    apiHits += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(payload(false));
    return;
  }

  // Everything under /api that isn't events: not cached by the worker.
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
check("it keeps separate caches for shell, assets and data",
  cacheNames.some((n) => n.startsWith("ra-shell")) &&
    cacheNames.some((n) => n.startsWith("ra-assets")) &&
    cacheNames.some((n) => n.startsWith("ra-data")),
  cacheNames.join(", "));

const cachedDay = await page.evaluate(async () => {
  const names = await caches.keys();
  const data = names.find((n) => n.startsWith("ra-data"));
  if (!data) return 0;
  return (await (await caches.open(data)).keys()).length;
});
check("the day's listings were saved", cachedDay > 0, `${cachedDay} entries`);

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

// ── third-party and non-events API requests must not be intercepted
await context.setOffline(false);
const before = apiHits;
await page.evaluate(() => fetch("/api/search?q=test").then((r) => r.text()));
check("only /api/events is cached, other endpoints stay network-only",
  apiHits === before);

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
