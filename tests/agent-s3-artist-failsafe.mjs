/**
 * S3 probe: what the artist sheet and search sheet show when /api/artist and
 * /api/search misbehave. Investigation only. Not part of test:all.
 *
 * Run with:  E2E_PORT=5523 node tests/agent-s3-artist-failsafe.mjs
 *
 * Every API call is stubbed with Playwright routes. Each artist scenario gets a
 * fresh browser context so the persisted react-query cache starts empty.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 5523);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = "/tmp/claude-0/-home-user-ra-nyc/29913e5a-28cc-5320-a39e-0a81327056a3/scratchpad";
const WATCH_MS = Number(process.env.WATCH_MS ?? 20000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), ".cache", "ms-playwright"),
    join(homedir(), "Library", "Caches", "ms-playwright"),
  ].filter(Boolean);
  const binaries = [["chrome-linux", "chrome"], ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"], ["chrome-win", "chrome.exe"]];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).filter((d) => d.startsWith("chromium"))) {
      for (const parts of binaries) {
        const candidate = join(root, entry, ...parts);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  throw new Error("No Chromium found");
}

const TODAY = new Date().toISOString().slice(0, 10);
const ARTIST_ID = "555";
const ARTIST_NAME = "Test DJ";
const event = {
  id: "evt-1",
  title: "Tonight Only",
  date: `${TODAY}T00:00:00.000`,
  startTime: `${TODAY}T22:00:00.000`,
  endTime: null,
  url: "https://ra.co/events/evt-1",
  imageUrl: "https://images.ra.co/x.jpg",
  venue: { name: "Jupiter Disco", area: "New York" },
  artists: [{ id: ARTIST_ID, name: ARTIST_NAME }],
  attending: 50,
  isPick: false,
  pickBlurb: null,
};

// What /api/artist returns when SoundCloud is off and nothing else matched.
// Mirrors buildLinkList(): SoundCloud search + Bandcamp search, no Mixcloud row.
const EMPTY_ARTIST = {
  id: ARTIST_ID,
  name: ARTIST_NAME,
  mixcloudUser: null,
  mixcloudUrl: null,
  soundcloudUser: null,
  soundcloudUrl: "https://soundcloud.com/search?q=Test%20DJ",
  raUrl: "https://ra.co/dj/testdj",
  bio: null,
  sets: [],
  links: [
    { label: "Bandcamp", url: "https://bandcamp.com/search?q=Test%20DJ&item_type=b", detail: "Search releases", resolved: false },
    { label: "SoundCloud", url: "https://soundcloud.com/search?q=Test%20DJ", detail: "Search", resolved: false },
  ],
  linkSource: "none",
  cached: false,
  persisted: false,
  soundcloud: "off",
};

const SCENARIOS = [
  {
    name: "a: sets [] (soundcloud off)",
    respond: async () => ({ status: 200, body: EMPTY_ARTIST }),
  },
  {
    name: "b: HTTP 429, Retry-After 5",
    respond: async () => ({
      status: 429,
      headers: {
        "Retry-After": "5",
        "Cache-Control": "no-store",
        "X-RateLimit-Limit": "60",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(Date.now() / 1000) + 5),
      },
      body: { error: "Too many requests. Please try again shortly." },
    }),
  },
  {
    name: "c: 12 s delay then sets []",
    respond: async () => {
      await sleep(12000);
      return { status: 200, body: EMPTY_ARTIST };
    },
  },
  {
    name: "d: network offline (aborted)",
    respond: async () => ({ abort: true }),
  },
];

const log = [];
const logLine = (...parts) => console.log(...parts);

const SNAPSHOT_ARTIST = () => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
    d.querySelector('[aria-label="Back to event"]'),
  );
  if (!dlg) return null;
  return {
    text: dlg.innerText.replace(/\s+/g, " ").trim().slice(0, 420),
    skeletons: dlg.querySelectorAll(".skeleton-glow").length,
  };
};

const SNAPSHOT_SEARCH = () => {
  const dlg = document.querySelector('[role="dialog"][aria-label="Search events"]');
  if (!dlg) return null;
  return { text: dlg.innerText.replace(/\s+/g, " ").trim().slice(0, 420) };
};

async function newPage(browser) {
  const context = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 140));
  });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${e.message.slice(0, 140)}`));
  await page.addInitScript(() => {
    window.va = () => {};
  });
  await page.route("**/api/events*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ date: TODAY, events: [event], count: 1 }),
    }),
  );
  await page.route("**/images.ra.co/**", (route) => route.abort());
  await page.route("**/w.soundcloud.com/**", (route) => route.abort());
  await page.route("**/player-widget.mixcloud.com/**", (route) => route.abort());
  return { context, page, consoleErrors };
}

async function runArtistScenario(browser, scenario) {
  logLine(`\n=== ${scenario.name} ===`);
  const { context, page, consoleErrors } = await newPage(browser);
  const calls = [];
  let t0 = 0;

  await page.route("**/api/artist*", async (route) => {
    const started = Date.now();
    const r = await scenario.respond();
    calls.push({ at: ((started - t0) / 1000).toFixed(1), status: r.abort ? "ABORT" : r.status });
    if (r.abort) return route.abort("internetdisconnected");
    return route.fulfill({
      status: r.status,
      headers: r.headers,
      contentType: "application/json",
      body: JSON.stringify(r.body),
    });
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Tonight Only", { timeout: 20000 });
  await page.waitForTimeout(800);

  // Open the event sheet. Its effect prefetches the lineup, so /api/artist
  // calls happen here, before the artist itself is tapped.
  await page.getByText("Tonight Only", { exact: true }).first().click();
  await page.getByRole("button", { name: ARTIST_NAME, exact: true }).first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(1500);
  const prefetchCount = calls.length;

  t0 = Date.now();
  await page.getByRole("button", { name: ARTIST_NAME, exact: true }).first().click();

  // Sample the artist sheet once a second and print only changes.
  let last = "";
  for (let elapsed = 0; elapsed <= WATCH_MS; elapsed += 1000) {
    const snap = await page.evaluate(SNAPSHOT_ARTIST);
    const key = JSON.stringify(snap);
    if (key !== last) {
      logLine(`  t=${(elapsed / 1000).toFixed(0)}s`, snap ? `skeletons=${snap.skeletons} text="${snap.text}"` : "(sheet not open)");
      last = key;
    }
    if (elapsed === 0) await page.screenshot({ path: `${SHOTS}/s3-${scenario.name[0]}-sheet.png` });
    await sleep(1000);
  }

  await page.screenshot({ path: `${SHOTS}/s3-${scenario.name[0]}-final.png` });
  logLine(`  /api/artist calls before tap: ${prefetchCount}; after tap (t0-relative): ${JSON.stringify(calls.slice(prefetchCount))}`);
  logLine(`  total /api/artist calls: ${calls.length}`);
  logLine(`  console errors: ${JSON.stringify([...new Set(consoleErrors)].slice(0, 6))}`);
  await context.close();
}

async function runSearchScenario(browser, name, respond) {
  logLine(`\n=== ${name} ===`);
  const { context, page, consoleErrors } = await newPage(browser);
  let calls = 0;
  await page.route("**/api/search*", async (route) => {
    calls += 1;
    const r = await respond();
    return route.fulfill({
      status: r.status,
      headers: r.headers,
      contentType: "application/json",
      body: JSON.stringify(r.body),
    });
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Tonight Only", { timeout: 20000 });
  await page.locator('button[aria-label="Search events"]').click();
  const input = page.locator('input[aria-label="Search events"]');
  await input.waitFor({ timeout: 8000 });
  await input.fill("zz");
  for (let elapsed = 0; elapsed <= 8000; elapsed += 1000) {
    const snap = await page.evaluate(SNAPSHOT_SEARCH);
    if (elapsed % 2000 === 0 || (snap && /found|Too many|Failed|Nothing/.test(snap.text))) {
      logLine(`  t=${(elapsed / 1000).toFixed(0)}s`, snap ? `text="${snap.text}"` : "(no dialog)");
    }
    await sleep(1000);
  }
  logLine(`  /api/search calls: ${calls}`);
  logLine(`  console errors: ${JSON.stringify([...new Set(consoleErrors)].slice(0, 4))}`);
  await page.screenshot({ path: `${SHOTS}/s3-search-${name.split(":")[0]}.png` });
  await context.close();
}

// ── boot the dev server
const server = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1"], {
  cwd: "/home/user/ra-nyc",
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOut = "";
server.stdout.on("data", (d) => (serverOut += d));
server.stderr.on("data", (d) => (serverOut += d));
process.on("exit", () => {
  try { server.kill("SIGTERM"); } catch { /* gone */ }
});
for (let attempt = 0; ; attempt += 1) {
  try {
    await fetch(BASE);
    break;
  } catch {
    if (attempt > 120) throw new Error(`Dev server never came up:\n${serverOut.slice(-800)}`);
    await sleep(500);
  }
}
if (/EADDRINUSE|in use/.test(serverOut)) logLine("WARNING: port in use, may be talking to another server");

const browser = await chromium.launch({ executablePath: findChromium() });
try {
  for (const scenario of SCENARIOS) {
    await runArtistScenario(browser, scenario);
  }
  await runSearchScenario(browser, "e: search empty", async () => ({
    status: 200,
    body: { q: "zz", upcoming: [], past: [], truncated: false, coverage: { indexed: 180, window: 180 } },
  }));
  await runSearchScenario(browser, "f: search 429", async () => ({
    status: 429,
    headers: { "Retry-After": "30", "Cache-Control": "no-store" },
    body: { error: "Too many searches. Please try again shortly." },
  }));
} finally {
  await browser.close();
  server.kill("SIGTERM");
}
