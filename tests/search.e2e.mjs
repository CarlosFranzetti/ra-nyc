/**
 * End-to-end checks for event search.
 *
 * Run with:  npm run test:search
 *
 * Stubs `/api/search` rather than RA, so this covers the sheet, the debounce,
 * the sectioning and the jump-to-day behaviour. The server-side matching and
 * ordering are asserted separately against the compiled resolver, since those
 * are pure functions over a payload and don't need a browser.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 5189);
const BASE = `http://127.0.0.1:${PORT}`;

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

const ev = (id, title, date, venue, artists) => ({
  id,
  title,
  date: `${date}T00:00:00.000`,
  startTime: `${date}T22:00:00.000`,
  endTime: null,
  url: `https://ra.co/events/${id}`,
  imageUrl: "https://images.ra.co/x.jpg",
  venue: { name: venue, area: "New York" },
  artists: artists.map((name, i) => ({ id: `${id}-${i}`, name })),
  attending: 50,
  isPick: false,
  pickBlurb: null,
});

const TODAY = new Date().toISOString().slice(0, 10);
const FUTURE = new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10);
const PAST = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);

const RESULTS = {
  q: "lakuti",
  upcoming: [ev("u1", "Lakuti & Tama Sumo", FUTURE, "Nowadays", ["Lakuti"])],
  past: [ev("p1", "Uzuri Nights", PAST, "Bossa Nova Civic Club", ["Lakuti"])],
  truncated: false,
};
const EMPTY = { q: "zzzz", upcoming: [], past: [], truncated: false };

const server = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1"], {
  stdio: "ignore",
});
const shutdown = () => {
  try {
    server.kill("SIGTERM");
  } catch {
    /* already gone */
  }
};
process.on("exit", shutdown);

for (let attempt = 0; ; attempt += 1) {
  try {
    await fetch(BASE);
    break;
  } catch {
    if (attempt > 60) throw new Error("Dev server never came up");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const browser = await chromium.launch({ executablePath: findChromium() });
const context = await browser.newContext({
  ...devices["iPhone 13"],
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

let searchCalls = 0;
await page.route("**/api/events*", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      date: TODAY,
      events: [ev("d1", "Tonight Only", TODAY, "Jupiter Disco", ["Someone"])],
      count: 1,
    }),
  }),
);
await page.route("**/api/search*", (route) => {
  searchCalls += 1;
  const q = new URL(route.request().url()).searchParams.get("q") ?? "";
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(q.startsWith("lakuti") ? RESULTS : EMPTY),
  });
});
await page.route("**/images.ra.co/**", (route) => route.abort());

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Tonight Only", { timeout: 20000 });
await page.waitForTimeout(900);

// ── the entry point
const searchBtn = page.locator('button[aria-label="Search events"]');
check("search button is in the header", (await searchBtn.count()) === 1);

const order = await page.evaluate(() => {
  const search = document.querySelector('button[aria-label="Search events"]');
  const cal = document.querySelector('button[aria-label*="alendar"], button[aria-label="Customize"]');
  if (!search || !cal) return null;
  return search.getBoundingClientRect().left < cal.getBoundingClientRect().left;
});
check("search sits to the left of the calendar", order === true);

await searchBtn.click();
await page.waitForSelector('input[aria-label="Search events"]', { timeout: 8000 });
const input = page.locator('input[aria-label="Search events"]');
check("search sheet opens with a field", await input.isVisible());
check("prompts before it will search", await page.locator("text=Type at least").isVisible());

// ── debounce: one request for a burst of keystrokes
searchCalls = 0;
await input.type("lakuti", { delay: 40 });
await page.waitForSelector("text=Lakuti & Tama Sumo", { timeout: 8000 });
await page.waitForTimeout(600);
check("typing is debounced into one request", searchCalls === 1, `${searchCalls} calls`);

// ── sectioning and order
check("upcoming section is present", await page.locator("text=Upcoming · 1").isVisible());
check("past section is present", await page.locator("text=Past · 1").isVisible());
const sectionOrder = await page.evaluate(() => {
  const heads = [...document.querySelectorAll("h3")].map((h) => h.textContent ?? "");
  const up = heads.findIndex((t) => t.startsWith("Upcoming"));
  const past = heads.findIndex((t) => t.startsWith("Past"));
  return up !== -1 && past !== -1 && up < past;
});
check("upcoming is listed before past", sectionOrder);
const dayLabel = new Date(`${FUTURE}T12:00:00Z`).toLocaleDateString("en-US", {
  weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
});
check("results carry a date, unlike day listings",
  (await page.locator(`[role="dialog"] >> text=${dayLabel}`).count()) > 0, dayLabel);

// ── the empty case must not look like a failure
await input.fill("");
await input.type("zzzz", { delay: 30 });
await page.waitForSelector("text=No events found", { timeout: 8000 });
check("empty results say so plainly", true);

// ── picking a result jumps to that night and opens it
await input.fill("");
await input.type("lakuti", { delay: 30 });
await page.waitForSelector("text=Lakuti & Tama Sumo", { timeout: 8000 });
await page.locator("text=Lakuti & Tama Sumo").first().click();
await page.waitForTimeout(900);

check("search sheet closes on pick",
  (await page.locator('input[aria-label="Search events"]').count()) === 0);
const detailsOpen = await page.locator('[role="dialog"]').count();
check("the event opens", detailsOpen > 0);
const jumped = await page.locator(`text=${new Date(`${FUTURE}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}`).first().count();
check("listings jumped to the event's night", jumped > 0);

await browser.close();
shutdown();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
