/** Screenshots against the real places files and a copy of today's real events. Not part of test:all. */
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


import { readFileSync } from "node:fs";
const EVENTS = readFileSync(process.env.EVENTS_FILE, "utf8");
const TILE = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#14171a"/><path d="M0 64H256M0 192H256M96 0V256M200 0V256" stroke="#23282d" stroke-width="7"/></svg>`;
const server = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1"], { stdio: "ignore" });
const shutdown = () => { try { server.kill("SIGTERM"); } catch { /* gone */ } };
process.on("exit", shutdown);
for (let a = 0; ; a++) { try { await fetch(BASE); break; } catch { if (a > 60) throw new Error("no server"); await new Promise((r) => setTimeout(r, 250)); } }
const browser = await chromium.launch({ executablePath: findChromium() });
for (const real of [true, false]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.route("**/api/events*", (r) => r.fulfill({ contentType: "application/json", body: EVENTS }));
  await page.route("**/images.ra.co/**", (r) => r.abort());
  await page.route("**tile.openstreetmap.org/**", (r) => (real ? r.continue() : r.fulfill({ contentType: "image/svg+xml", body: TILE })));
  await page.addInitScript(() => localStorage.removeItem("ra-map-layers"));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("article", { timeout: 20000 });
  await page.locator('[data-testid="map-chip"]').click();
  await page.waitForSelector('[data-testid="pin-tonight"]', { timeout: 30000 });
  await page.waitForTimeout(4000);
  const loaded = await page.locator(".leaflet-tile-loaded").count();
  console.log(real ? "real tiles" : "stub tiles", "loaded:", loaded);
  if (real && loaded === 0) { await ctx.close(); continue; }
  const n = async (k) => page.locator(`[data-testid="pin-${k}"]`).count();
  console.log("pins", await n("tonight"), await n("venue"), await n("shop"));
  await page.screenshot({ path: join(SHOTS, "map-all.png") });
  await page.locator('[data-testid="legend-shop"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, "map-shops-off.png") });
  await page.locator('[data-testid="legend-shop"]').click();
  await page.locator('[data-testid="pin-tonight"]').first().dispatchEvent("click");
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(SHOTS, "map-venue.png") });
  await page.locator('[data-testid="view-toggle"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, "map-list.png") });
  await ctx.close();
  break;
}
await browser.close();
shutdown();
