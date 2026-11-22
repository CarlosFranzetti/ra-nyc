/**
 * End-to-end probe for the map sheet.  Run with:  node tests/map.e2e.mjs
 *
 * Proves: the listings page loads no Leaflet; the Map chip shows even on an
 * empty night; the legend switches add and remove exactly their own markers;
 * every marker has an accessible name; the List view shows the same visible
 * items; a tonight venue missing from the file is placed on demand; the venue
 * sheet's "See on the map" row; "near me" asks only when tapped. Tiles, both
 * places files and /api/venue are stubbed, so it never needs the network.
 * SHOTS=<dir> writes screenshots; REAL_TILES=1 lets the tile host through.
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
const mk = (i, venueId, venueName, title) => ({
  id: `e${i}`, title, date: `${TODAY}T00:00:00.000`, startTime: `${TODAY}T22:00:00.000`, endTime: null,
  url: "https://ra.co/events/1", imageUrl: null, venue: { id: venueId, name: venueName, area: "New York" },
  artists: [], attending: 10, isPick: false, pickBlurb: null,
});
// Fixture venues 9001-9012 are in the file. 9001, 9003 (two events) and 9007 are on tonight; 9500 is
// on tonight but NOT in the file, so the sheet has to place it through /api/venue.
const NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima"];
const COORDS = [[40.7233,-73.9876],[40.7062,-73.9235],[40.7141,-73.9610],[40.7440,-73.9540],[40.7285,-74.0040],[40.6925,-73.9855],[40.7590,-73.9690],[40.6780,-73.9440],[40.7370,-73.9210],[40.7010,-73.9930],[40.7180,-73.9420],[40.7480,-73.9930]];
const FILE_HEAD = { source: "test fixture", licence: "test fixture", fetched: "2026-01-01" };
const VENUES = JSON.stringify({ ...FILE_HEAD, items: NAMES.map((n, i) => ({ id: String(9001 + i), name: `Stub Venue ${n}`, lat: COORDS[i][0], lng: COORDS[i][1], address: `${100 + i} Stub St, New York` })) });
const SHOPS = JSON.stringify({ ...FILE_HEAD, items: NAMES.map((n, i) => ({ osm: `node/${i + 1}`, name: `Stub Records ${n}`, lat: COORDS[(i + 5) % 12][0] + 0.004, lng: COORDS[(i + 5) % 12][1] + 0.006, address: `${10 + i} Placeholder Ave`, hours: i === 0 ? "Mo-Su 12:00-20:00" : null })) });
const ev = (list) => JSON.stringify({ date: TODAY, count: list.length, events: list });
const EVENTS = ev([
  mk(1, "9001", "Stub Venue Alpha", "Stub Night One"), mk(2, "9003", "Stub Venue Charlie", "Stub Night Two"),
  mk(3, "9003", "Stub Venue Charlie", "Stub Night Three"), mk(4, "9007", "Stub Venue Golf", "Stub Night Four"),
  mk(5, "9500", "Stub Newcomer", "Stub Night Five"),
]);
const TILE = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#14171a"/><path d="M0 64H256M0 192H256M96 0V256M200 0V256" stroke="#23282d" stroke-width="7"/><path d="M0 128H256M148 0V256" stroke="#2f363d" stroke-width="5"/></svg>`;

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
let tileRequests = 0;
let venueCalls = [];
async function newPage(eventsBody) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.route("**/api/events*", (r) => r.fulfill({ contentType: "application/json", body: eventsBody }));
  await page.route("**/images.ra.co/**", (r) => r.abort());
  await page.route("**/places/venues.json", (r) => r.fulfill({ contentType: "application/json", body: VENUES }));
  await page.route("**/places/shops.json", (r) => r.fulfill({ contentType: "application/json", body: SHOPS }));
  await page.route("**/api/venue*", (r) => {
    const name = new URL(r.request().url()).searchParams.get("name");
    venueCalls.push(name);
    return r.fulfill({ contentType: "application/json", body: JSON.stringify({ name, lat: 40.7305, lon: -73.9500, label: name, address: "1 Newcomer Way, Brooklyn", addressSource: "geocoder", mapsUrl: "https://maps.apple.com/" }) });
  });
  await page.route("**tile.openstreetmap.org/**", (r) => {
    tileRequests += 1;
    if (process.env.REAL_TILES) return r.continue();
    return r.fulfill({ contentType: "image/svg+xml", body: TILE });
  });
  await page.addInitScript(() => {
    window.__geoCalls = 0;
    const fake = (ok) => { window.__geoCalls += 1; ok({ coords: { latitude: 40.7295, longitude: -73.9965 } }); };
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: fake }, configurable: true });
  });
  return { ctx, page };
}

/* ---- an empty night still has the chip ---- */
{
  const { ctx, page } = await newPage(ev([]));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="map-chip"]', { timeout: 20000 });
  check("Map chip shows on a night with no events", await page.locator('[data-testid="map-chip"]').isVisible());
  await ctx.close();
}

const { page } = await newPage(EVENTS);
const leafletRequests = [];
page.on("request", (r) => { if (/leaflet|MapCanvas/i.test(r.url())) leafletRequests.push(r.url()); });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Stub Night One", { timeout: 20000 });
await page.evaluate(() => document.fonts.ready.then(() => true));
check("listings page loads no Leaflet", leafletRequests.length === 0 && (await page.locator(".leaflet-container").count()) === 0, `${leafletRequests.length} requests`);
check("the header has no map icon (the chip is the door)", (await page.locator('header [aria-label*="Map"]').count()) === 0);

const chipBox = await page.locator('[data-testid="map-chip"]').boundingBox();
const firstChip = await page.locator('main button, [class*="shell"] button').evaluateAll((els) => els.map((e) => e.textContent?.trim()).filter(Boolean).slice(0, 1));
check("the Map chip is first in the filter row", chipBox && (await page.locator('[data-testid="map-chip"]').evaluate((el) => !el.previousElementSibling)));

page.on("console", (m) => { if (m.type() === "error") console.log("BROWSER", m.text().slice(0, 300)); }); page.on("pageerror", (e) => console.log("PAGEERR", String(e).slice(0, 300)));
await page.locator('[data-testid="map-chip"]').click();
await page.waitForSelector('[data-testid="pin-tonight"]', { timeout: 15000 });
await page.waitForTimeout(900);
const count = (kind) => page.locator(`[data-testid="pin-${kind}"]`).count();
check("opening the map loads Leaflet on demand", leafletRequests.length > 0);
check("tonight / venue / shop pins: 4 / 9 / 12 (one tonight venue placed on demand)", (await count("tonight")) === 4 && (await count("venue")) === 9 && (await count("shop")) === 12,
  `${await count("tonight")}/${await count("venue")}/${await count("shop")}`);
check("the unplaced tonight venue was looked up, once", venueCalls.filter((n) => n === "Stub Newcomer").length === 1, venueCalls.join(","));
check("tiles requested (stubbed)", tileRequests > 0, `${tileRequests} tile requests`);
check("no location asked on open", (await page.evaluate(() => window.__geoCalls)) === 0);
const chip = await page.locator('[data-testid="legend-shop"]').boundingBox();
const pill = await page.locator('[data-testid="legend-shop"] > span').boundingBox();
check("legend chips: 44px hit box around a 30px pill", chip.height >= 44 && Math.round(pill.height) === 30, `${chip.height}/${pill.height}`);
check("attribution stays visible", await page.locator(".leaflet-control-attribution").getByText(/OpenStreetMap/).isVisible());
check("event count is drawn inside a tonight pin", (await page.locator('[data-place="v:9003"] text').textContent()) === "2");
check("marker accessible names", await page.getByRole("button", { name: "Stub Venue Charlie, 2 events tonight" }).count() === 1
  && await page.getByRole("button", { name: "Stub Venue Alpha, 1 event tonight" }).count() === 1
  && await page.getByRole("button", { name: "Stub Records Alpha, record shop" }).count() === 1
  && await page.getByRole("button", { name: "Stub Venue Bravo, venue" }).count() === 1);
if (SHOTS) await page.screenshot({ path: join(SHOTS, "map-all.png") });

for (const [kind, shot] of [["shop", "map-shops-off.png"], ["venue", null], ["tonight", null]]) {
  await page.locator(`[data-testid="legend-${kind}"]`).click();
  await page.waitForTimeout(150);
  check(`legend: ${kind} off removes exactly its pins and dims the chip`, (await count(kind)) === 0 && (await page.locator(`[data-testid="legend-${kind}"]`).getAttribute("aria-checked")) === "false"
    && (await page.locator(`[data-testid="legend-${kind}"] > span`).evaluate((el) => getComputedStyle(el).opacity)) === "0.45");
  if (SHOTS && shot) await page.screenshot({ path: join(SHOTS, shot) });
}
check("everything off is a blank map, not an error", (await page.locator(".map-pin").count()) === 0);
for (const k of ["tonight", "venue", "shop"]) await page.locator(`[data-testid="legend-${k}"]`).click();
await page.waitForTimeout(150);
check("switching back on restores them", (await count("tonight")) === 4 && (await count("venue")) === 9 && (await count("shop")) === 12);

/* ---- list view ---- */
await page.locator('[data-testid="legend-shop"]').click(); // shops off
await page.locator('[data-testid="view-toggle"]').click();
const names = await page.locator('[data-testid="place-list"] li').evaluateAll((els) => els.map((e) => e.querySelector("span.truncate")?.textContent));
check("list: the same visible items, tonight's first then alphabetical", names.length === 13
  && names.slice(0, 4).join("|") === "Stub Newcomer|Stub Venue Alpha|Stub Venue Charlie|Stub Venue Golf"
  && names.slice(4).join("|") === [...names.slice(4)].sort((a, b) => a.localeCompare(b)).join("|"), names.slice(0, 5).join("|"));
if (SHOTS) await page.screenshot({ path: join(SHOTS, "map-list.png") });
await page.locator('[data-testid="legend-shop"]').click(); // shops back on
await page.locator('[data-testid="near-me"]').click();
await page.waitForSelector('[data-testid="place-list"] li:first-child >> text=mi');
check("list after location: nearest first", await page.locator('[data-testid="place-list"] li').first().innerText().then((s) => /mi/.test(s)));
check("near me asked once, only after the tap", (await page.evaluate(() => window.__geoCalls)) === 1);
await page.locator('[data-testid="view-toggle"]').click();

/* ---- cards ---- */
await page.locator('[data-place="v:9003"]').dispatchEvent("click");
await page.waitForSelector('[data-testid="place-card"]');
const card = await page.locator('[data-testid="place-card"]').innerText();
check("a venue pin lists tonight's events there", card.includes("Stub Night Two") && card.includes("Stub Night Three") && !card.includes("Stub Night One"));
await page.locator('[data-place="s:node/1"]').dispatchEvent("click");
await page.waitForTimeout(300);
const shopCard = await page.locator('[data-testid="place-card"]').innerText();
check("a shop pin shows address and raw hours", shopCard.includes("Stub Records Alpha") && shopCard.includes("Placeholder Ave") && shopCard.includes("Mo-Su 12:00-20:00"));
check("the shop card has Uber, Lyft and Maps", (await page.locator('[data-testid="place-card"] a').count()) === 3);
if (SHOTS) await page.screenshot({ path: join(SHOTS, "map-shop.png") });

await page.locator('[data-place="v:9003"]').dispatchEvent("click");
await page.locator('[data-testid="place-card"]').getByText("Stub Night Two").click();
await page.waitForTimeout(600);
check("an event in the card opens that event", await page.getByText("Stub Night Two").first().isVisible() && (await page.locator('[data-testid="map-canvas"]').count()) === 0);

/* ---- from the venue sheet ---- */
await page.locator('[role="dialog"] button:has-text("Stub Venue Charlie")').first().click();
await page.waitForSelector('[data-testid="see-on-map"]', { timeout: 10000 });
await page.locator('[data-testid="see-on-map"]').click();
await page.waitForSelector('[data-testid="place-card"]', { timeout: 10000 });
await page.waitForTimeout(500);
check("See on the map opens the map with that venue selected", (await page.locator('[data-testid="place-card"]').innerText()).includes("Stub Venue Charlie"));
const near = await page.evaluate(() => {
  const pin = document.querySelector('[data-place="v:9003"]').getBoundingClientRect();
  const c = document.querySelector('[data-testid="map-canvas"]').getBoundingClientRect();
  return Math.hypot(pin.x + pin.width / 2 - (c.x + c.width / 2), pin.y + pin.height / 2 - (c.y + c.height / 2));
});
check("...and centres on it", near < 140, `${Math.round(near)}px from centre`);
if (SHOTS) await page.screenshot({ path: join(SHOTS, "map-venue.png") });
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

/* ---- player bar ---- */
await page.evaluate(() => document.documentElement.style.setProperty("--player-h", "72px"));
await page.locator('[data-testid="map-chip"]').dispatchEvent("click");
await page.waitForSelector('[data-testid="map-canvas"]');
await page.waitForTimeout(700);
const bottom = await page.locator('[data-testid="map-canvas"]').evaluate((el) => el.getBoundingClientRect().bottom);
check("sheet stops above a 72px player bar", bottom <= 844 - 72 + 1, `bottom=${Math.round(bottom)}`);

await browser.close();
shutdown();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
