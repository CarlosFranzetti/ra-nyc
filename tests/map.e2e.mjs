/**
 * End-to-end probe for the map sheet.  Run with:  node tests/map.e2e.mjs
 *
 * Proves: the listings page loads no Leaflet; the legend switches add and
 * remove exactly their own markers; tapping a pin opens its card; "near me"
 * asks for location only when tapped; tiles are stubbed (no network).
 * SHOTS=<dir> also writes screenshots; REAL_TILES=1 lets the tile host through.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 6141);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
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
    // Newer Playwright builds unpack to `chrome-linux64`; the cloud container
    // moved to one and every suite stopped finding its browser.
    ["chrome-linux64", "chrome"],
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


const TODAY = new Date().toISOString().slice(0, 10);
const mk = (i, venueId, title) => ({
  id: `e${i}`, title, date: `${TODAY}T00:00:00.000`, startTime: `${TODAY}T22:00:00.000`, endTime: null,
  url: "https://ra.co/events/1", imageUrl: null, venue: { id: venueId, name: "Stub Venue", area: "New York" },
  artists: [], attending: 10, isPick: false, pickBlurb: null,
});
// Stub venues 9001, 9003 and 9007 have something on tonight (9003 has two).
const EVENTS = JSON.stringify({ date: TODAY, count: 4, events: [
  mk(1, "9001", "Stub Night One"), mk(2, "9003", "Stub Night Two"), mk(3, "9003", "Stub Night Three"), mk(4, "9007", "Stub Night Four"),
] });
// A flat "map" tile as SVG: the tile host never gets a request.
const TILE = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8e4da"/><path d="M0 64H256M0 192H256M96 0V256M200 0V256" stroke="#fff" stroke-width="7"/><path d="M0 128H256M148 0V256" stroke="#f6c55c" stroke-width="5"/></svg>`;

const server = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1"], { stdio: "ignore" });
const shutdown = () => { try { server.kill("SIGTERM"); } catch { /* gone */ } };
process.on("exit", shutdown);
for (let attempt = 0; ; attempt += 1) {
  try { await fetch(BASE); break; } catch {
    if (attempt > 60) throw new Error("Dev server never came up");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const browser = await chromium.launch({ executablePath: findChromium() });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
let tileRequests = 0;
const leafletRequests = [];
page.on("request", (r) => { if (/leaflet|MapCanvas/i.test(r.url())) leafletRequests.push(r.url()); });
await page.route("**/api/events*", (r) => r.fulfill({ contentType: "application/json", body: EVENTS }));
await page.route("**/images.ra.co/**", (r) => r.abort());
await page.route("**basemaps.cartocdn.com/**", (r) => {
  tileRequests += 1;
  if (process.env.REAL_TILES) return r.continue();
  return r.fulfill({ contentType: "image/svg+xml", body: TILE });
});
await page.addInitScript(() => {
  window.__geoCalls = 0;
  const fake = (ok) => { window.__geoCalls += 1; ok({ coords: { latitude: 40.7295, longitude: -73.9965 } }); };
  Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: fake }, configurable: true });
});
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Stub Night One", { timeout: 20000 });
await page.evaluate(() => document.fonts.ready.then(() => true));

check("listings page loads no Leaflet", leafletRequests.length === 0 && (await page.locator(".leaflet-container").count()) === 0, `${leafletRequests.length} requests`);

await page.getByRole("button", { name: /Map of venues/ }).click();
await page.waitForSelector('[data-testid="pin-tonight"]', { timeout: 15000 });
await page.waitForTimeout(700);
const count = (kind) => page.locator(`[data-testid="pin-${kind}"]`).count();
check("opening the map loads Leaflet on demand", leafletRequests.length > 0);
check("tonight / venue / shop pins: 3 / 9 / 12", (await count("tonight")) === 3 && (await count("venue")) === 9 && (await count("shop")) === 12,
  `${await count("tonight")}/${await count("venue")}/${await count("shop")}`);
check("tiles requested through the stub", tileRequests > 0, `${tileRequests} tile requests`);
check("no location asked on open", (await page.evaluate(() => window.__geoCalls)) === 0);
check("legend switches are at least 40px tall", (await page.locator('[data-testid="legend-shop"]').boundingBox()).height >= 40);
check("attribution stays visible", await page.locator(".leaflet-control-attribution").getByText(/OpenStreetMap/).isVisible());
if (SHOTS) await page.screenshot({ path: join(SHOTS, "01-all-layers.png") });

const legendLayers = [["shop", "02-shops-off.png"], ["venue", "03-other-venues-off.png"], ["tonight", "04-tonight-off.png"]];
for (const [kind, shot] of legendLayers) {
  await page.locator(`[data-testid="legend-${kind}"]`).click();
  await page.waitForTimeout(150);
  check(`legend: ${kind} off removes exactly its pins`, (await count(kind)) === 0 && (await page.locator(`[data-testid="legend-${kind}"]`).getAttribute("aria-checked")) === "false");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, shot) });
}
check("everything off is a blank map, not an error", (await page.locator(".map-pin").count()) === 0);
for (const [kind] of legendLayers) await page.locator(`[data-testid="legend-${kind}"]`).click();
await page.waitForTimeout(150);
check("switching back on restores them", (await count("tonight")) === 3 && (await count("venue")) === 9 && (await count("shop")) === 12);

await page.locator('[data-place="v:9003"]').click();
await page.waitForSelector('[data-testid="place-card"]');
const card = await page.locator('[data-testid="place-card"]').innerText();
check("tapping a venue pin lists tonight's events there", card.includes("Stub Night Two") && card.includes("Stub Night Three") && !card.includes("Stub Night One"));
if (SHOTS) await page.screenshot({ path: join(SHOTS, "05-venue-tapped.png") });
await page.locator('[data-place="s:stub-shop-1"]').click();
await page.waitForTimeout(300);
const shopCard = await page.locator('[data-testid="place-card"]').innerText();
check("tapping a shop pin shows address and hours", shopCard.includes("Stub Records One") && shopCard.includes("Mo-Su 12:00-20:00"));
if (SHOTS) await page.screenshot({ path: join(SHOTS, "06-shop-tapped.png") });

await page.locator('[data-testid="near-me"]').click();
await page.waitForSelector('[data-testid="pin-me"]', { state: "attached" });
check("near me asks once, only after the tap", (await page.evaluate(() => window.__geoCalls)) === 1);

await page.locator('[data-place="v:9003"]').click();
await page.locator('[data-testid="place-card"]').getByText("Stub Night Two").click();
await page.waitForTimeout(500);
check("a listing in the card jumps to that event", (await page.locator('[data-testid="map-canvas"]').count()) === 0);

check("...and that event's sheet is what opens", await page.getByText("Stub Night Two").first().isVisible());
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
// Player bar docked: the sheet must leave its room.
await page.evaluate(() => document.documentElement.style.setProperty("--player-h", "72px"));
await page.getByRole("button", { name: /Map of venues/ }).click();
await page.waitForSelector('[data-testid="map-canvas"]');
await page.waitForTimeout(700);
const bottom = await page.locator('[data-testid="map-canvas"]').evaluate((el) => el.getBoundingClientRect().bottom);
check("sheet stops above a 72px player bar", bottom <= 844 - 72 + 1, `bottom=${Math.round(bottom)}`);
if (SHOTS) await page.screenshot({ path: join(SHOTS, "07-player-docked.png") });

await browser.close();
shutdown();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
