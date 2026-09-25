/**
 * Does the page recede when a sheet comes up? A probe, not a test.
 *
 * Samples the drawer wrapper's transform and border-radius while the event
 * sheet opens. On iOS, presenting a sheet scales the screen behind it back and
 * rounds its corners; this reports whether that is actually happening and by
 * how much.
 *
 * Also checks the two scroll properties resolved, because `content-visibility`
 * silently does nothing if the element is display:contents or similar.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  for (const root of [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), ".cache", "ms-playwright")].filter(Boolean)) {
    if (!existsSync(root)) continue;
    for (const e of readdirSync(root).filter((d) => d.startsWith("chromium"))) {
      const c = join(root, e, "chrome-linux", "chrome");
      if (existsSync(c)) return c;
    }
  }
  throw new Error("No Chromium found.");
}

const PORT = process.env.E2E_PORT ?? "5441";
const BASE = `http://127.0.0.1:${PORT}`;
const TODAY = new Date().toISOString().slice(0, 10);
const PAYLOAD = JSON.stringify({
  date: TODAY,
  events: Array.from({ length: 30 }, (_, i) => ({
    id: `e${i}`,
    title: `Event number ${i}`,
    date: TODAY,
    startTime: `${TODAY}T22:00:00`,
    endTime: `${TODAY}T23:59:00`,
    venue: { id: `v${i}`, name: "Nowadays" },
    artists: [{ id: `a${i}`, name: "Test DJ" }],
    attending: 40 + i,
    isPick: false,
    imageUrl: null,
    contentUrl: `/events/${i}`,
  })),
});

const server = spawn("npx", ["vite", "--port", PORT, "--host", "127.0.0.1"], { stdio: "ignore" });
process.on("exit", () => server.kill("SIGTERM"));
await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch({ executablePath: findChromium() });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.route("**/api/events*", (r) => r.fulfill({ contentType: "application/json", body: PAYLOAD }));
await page.route("**/images.ra.co/**", (r) => r.abort());
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("article", { timeout: 20000 });
await page.waitForTimeout(600);

// ── the scroll properties actually resolved
const scrollProps = await page.evaluate(() => {
  const card = document.querySelector("article")?.parentElement;
  const header = document.querySelector("header");
  const cs = card ? getComputedStyle(card) : null;
  const hs = header ? getComputedStyle(header) : null;
  return {
    "card content-visibility": cs?.contentVisibility,
    "card intrinsic-size": cs?.containIntrinsicSize,
    "header contain": hs?.contain,
    "header transform": hs?.transform,
    "header backdrop": hs?.backdropFilter,
    "body overscroll": getComputedStyle(document.body).overscrollBehaviorY,
  };
});
console.log("scroll:");
for (const [k, v] of Object.entries(scrollProps)) console.log(`   ${k.padEnd(24)} ${v}`);

// ── the page receding behind a sheet
const frames = page.evaluate(async () => {
  const seen = [];
  const start = performance.now();
  while (performance.now() - start < 900) {
    const el = document.querySelector("[vaul-drawer-wrapper]");
    if (el) {
      const s = getComputedStyle(el);
      const key = `${s.transform} | ${s.borderRadius}`;
      if (seen[seen.length - 1] !== key) seen.push(key);
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  return seen;
});
await page.waitForTimeout(40);
await page.locator("article").first().click();
const states = await frames;

console.log(`\nbackground while the sheet opens: ${states.length} distinct states`);
console.log(`   from  ${states[0]}`);
console.log(`   to    ${states[states.length - 1]}`);

await browser.close();
server.kill("SIGTERM");
