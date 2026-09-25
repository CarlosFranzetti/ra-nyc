/**
 * Does the page have one left margin, or several? A probe, not a test.
 *
 * Prints the left and right edge of every band down the screen — header,
 * date rail, filter row, cards — so the vertical spine can be read as numbers.
 * A layout with two margins four pixels apart looks like a mistake nobody can
 * name; this is how you find it.
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

const PORT = process.env.E2E_PORT ?? "5401";
const BASE = `http://127.0.0.1:${PORT}`;
const TODAY = new Date().toISOString().slice(0, 10);
const PAYLOAD = JSON.stringify({
  date: TODAY,
  events: Array.from({ length: 5 }, (_, i) => ({
    id: `e${i}`,
    title: `Event number ${i}`,
    date: TODAY,
    startTime: `${TODAY}T22:00:00`,
    endTime: `${TODAY}T23:59:00`,
    venue: { id: `v${i}`, name: "Nowadays" },
    artists: [{ id: `a${i}`, name: "Test DJ" }],
    attending: 40 + i,
    isPick: i === 1,
    imageUrl: null,
    contentUrl: `/events/${i}`,
  })),
});

const server = spawn("npx", ["vite", "--port", PORT, "--host", "127.0.0.1"], { stdio: "ignore" });
process.on("exit", () => server.kill("SIGTERM"));
await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch({ executablePath: findChromium() });

for (const density of ["tight", "default", "airy"]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route("**/api/events*", (r) => r.fulfill({ contentType: "application/json", body: PAYLOAD }));
  await page.route("**/images.ra.co/**", (r) => r.abort());
  await page.addInitScript(
    (d) =>
      localStorage.setItem(
        "ra-theme-settings",
        JSON.stringify({ colorTheme: "neon", layoutDensity: d, typography: "base", textSize: "0" }),
      ),
    density,
  );
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("article", { timeout: 20000 });
  await page.waitForTimeout(500);

  const bands = await page.evaluate(() => {
    const px = (n) => Math.round(n * 10) / 10;
    const pick = (label, el) =>
      el ? { label, l: px(el.getBoundingClientRect().left), r: px(el.getBoundingClientRect().right) } : null;
    const out = [];
    out.push(pick("logo", document.querySelector("h1.logo")));
    const icons = document.querySelector("h1.logo")?.parentElement?.lastElementChild;
    out.push(pick("header icons", icons));
    const rail = document.querySelector("[data-selected='true']")?.parentElement;
    out.push(pick("date rail (track)", rail));
    out.push(pick("  first chip", rail?.firstElementChild));
    out.push(pick("  last chip", rail?.lastElementChild));
    const chipRow = document.querySelector("[aria-pressed]")?.closest("div");
    const chips = chipRow ? [...chipRow.children] : [];
    out.push(pick("filter row", chipRow));
    out.push(pick("  first filter", chips[0]));
    out.push(pick("  last filter", chips[chips.length - 1]));
    const card = document.querySelector("article");
    out.push(pick("card", card));
    out.push(pick("  flyer", card?.querySelector("div")));
    out.push(pick("  title", card?.querySelector("h3")));
    out.push(pick("  venue", card?.querySelector("h3 + div > span")));
    out.push(pick("  lineup", card?.querySelector("h3 ~ p")));
    return { bands: out.filter(Boolean), width: innerWidth };
  });

  console.log(`\n── ${density}  (viewport ${bands.width})`);
  for (const b of bands.bands) {
    console.log(`   ${b.label.padEnd(20)} L ${String(b.l).padStart(6)}   R ${String(b.r).padStart(6)}`);
  }
  await ctx.close();
}

await browser.close();
server.kill("SIGTERM");
