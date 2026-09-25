/**
 * Does anything actually slide? A probe, not a test.
 *
 * Samples each overlay's transform every frame while it opens and while it
 * closes, and reports how many distinct positions it passed through. A real
 * slide is dozens; an element that appears between two frames is one or two.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), ".cache", "ms-playwright"),
  ].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).filter((d) => d.startsWith("chromium"))) {
      const candidate = join(root, entry, "chrome-linux", "chrome");
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error("No Chromium found.");
}

const PORT = process.env.E2E_PORT ?? "5361";
const BASE = `http://127.0.0.1:${PORT}`;
const TODAY = new Date().toISOString().slice(0, 10);

const PAYLOAD = JSON.stringify({
  date: TODAY,
  events: Array.from({ length: 6 }, (_, i) => ({
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

const server = spawn("npx", ["vite", "--port", PORT, "--host", "127.0.0.1"], {
  stdio: "ignore",
});
process.on("exit", () => server.kill("SIGTERM"));
await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch({ executablePath: findChromium() });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
await page.route("**/api/events*", (route) =>
  route.fulfill({ contentType: "application/json", body: PAYLOAD }),
);
await page.route("**/images.ra.co/**", (route) => route.abort());
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("article", { timeout: 20000 });
await page.waitForTimeout(500);

/** Watch a selector's transform for `ms`, returning every distinct value. */
const watch = (selector, ms) =>
  page.evaluate(
    async ([sel, duration]) => {
      const seen = [];
      const start = performance.now();
      while (performance.now() - start < duration) {
        const el = document.querySelector(sel);
        const t = el ? getComputedStyle(el).transform : "gone";
        if (seen[seen.length - 1] !== t) seen.push(t);
        await new Promise((r) => requestAnimationFrame(r));
      }
      return seen;
    },
    [selector, ms],
  );

const report = (name, frames) => {
  const moved = frames.filter((f) => f !== "none" && f !== "gone");
  console.log(
    `${name.padEnd(28)} ${String(frames.length).padStart(3)} distinct  ` +
      `${moved.length ? "SLIDES" : "NO MOVEMENT"}`,
  );
};

// ── the event sheet (vaul)
{
  const frames = watch("[data-vaul-drawer]", 900);
  await page.waitForTimeout(40);
  await page.locator("article").first().click();
  report("event sheet: open", await frames);

  const closing = watch("[data-vaul-drawer]", 900);
  await page.waitForTimeout(40);
  await page.keyboard.press("Escape");
  report("event sheet: close", await closing);
}

await page.waitForTimeout(600);

// ── the settings sheet (vaul)
{
  const frames = watch("[data-vaul-drawer]", 900);
  await page.waitForTimeout(40);
  await page.getByRole("button", { name: "Customize" }).click();
  report("settings: open", await frames);

  const closing = watch("[data-vaul-drawer]", 900);
  await page.waitForTimeout(40);
  await page.keyboard.press("Escape");
  report("settings: close", await closing);
}

await page.waitForTimeout(600);

// ── search (hand-rolled overlay-in / overlay-out)
{
  const frames = watch(".overlay-in, .overlay-out", 900);
  await page.waitForTimeout(40);
  await page.getByRole("button", { name: "Search events" }).click();
  report("search: open", await frames);

  const closing = watch(".overlay-in, .overlay-out", 900);
  await page.waitForTimeout(40);
  await page.getByRole("button", { name: /Cancel|Close/ }).first().click();
  report("search: close", await closing);
}

// ── what the browser thinks the timings are
const timings = await page.evaluate(() => {
  const out = {};
  const probe = document.createElement("div");
  document.body.appendChild(probe);
  for (const cls of ["overlay-in", "overlay-out", "player-enter", "caption-swap"]) {
    probe.className = cls;
    const s = getComputedStyle(probe);
    out[cls] = `${s.animationName} ${s.animationDuration}`;
  }
  probe.remove();
  out.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  return out;
});
console.log("\n", timings);

await browser.close();
server.kill("SIGTERM");
