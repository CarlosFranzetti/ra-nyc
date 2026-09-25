/**
 * Where does the card's vertical rhythm actually land? A probe, not a test.
 *
 * Prints the card box, the flyer, the text block and the gap between each text
 * row, at all three densities — so spacing decisions are made against measured
 * numbers rather than against a screenshot.
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

const PORT = process.env.E2E_PORT ?? "5381";
const BASE = `http://127.0.0.1:${PORT}`;
const TODAY = new Date().toISOString().slice(0, 10);

// One short title and one that wraps to two lines — the two shapes the card
// has to hold at the same height.
const PAYLOAD = JSON.stringify({
  date: TODAY,
  events: [
    ["Dark Room", "Nowadays"],
    ["Basement Transmission Extended Overnight", "Good Room"],
    ["After Hours", "Elsewhere"],
  ].map(([title, venue], i) => ({
    id: `e${i}`,
    title,
    date: TODAY,
    startTime: `${TODAY}T22:00:00`,
    endTime: `${TODAY}T23:59:00`,
    venue: { id: `v${i}`, name: venue },
    artists: [{ id: `a${i}`, name: "Test DJ" }, { id: `b${i}`, name: "Second Name" }],
    attending: 40 + i * 30,
    isPick: false,
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

  const rows = await page.evaluate(() => {
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const out = [];
    const cards = [...document.querySelectorAll("article")];
    for (const card of cards.slice(0, 2)) {
      const box = r(card);
      const flyer = r(card.querySelector("div"));
      const col = r(card.children[1]);
      const title = r(card.querySelector("h3"));
      const meta = r(card.querySelector("h3 + div"));
      const lineup = r(card.querySelector("h3 ~ p"));
      // The clock glyph and the numerals beside it.
      const clock = r(card.querySelector("svg"));
      const clockRow = clock ? r(clock.parentElement) : null;
      out.push({
        card: Math.round(box.height),
        flyer: flyer ? Math.round(flyer.height) : null,
        textBlock: title && lineup ? Math.round(lineup.bottom - title.top) : null,
        slack:
          flyer && title && lineup
            ? Math.round(flyer.height - (lineup.bottom - title.top))
            : null,
        titleToMeta: title && meta ? Math.round((meta.top - title.bottom) * 10) / 10 : null,
        metaToLineup: meta && lineup ? Math.round((lineup.top - meta.bottom) * 10) / 10 : null,
        padTop: box && title ? Math.round((title.top - box.top) * 10) / 10 : null,
        clockGap:
          clock && clockRow
            ? Math.round((clockRow.right - clock.right - (clockRow.width - clock.width - (clock.left - clockRow.left))) * 10) / 10
            : null,
        clockW: clock ? Math.round(clock.width * 10) / 10 : null,
      });
    }
    const list = document.querySelector("article")?.closest("div[class*='grid'],div[class*='gap']");
    return {
      cards: out,
      betweenCards: cards[1]
        ? Math.round((r(cards[1]).top - r(cards[0]).bottom) * 10) / 10
        : null,
      listGap: list ? getComputedStyle(list).gap : null,
    };
  });

  console.log(`\n── ${density}`);
  console.log(`   between cards        ${rows.betweenCards}px   (gap: ${rows.listGap})`);
  for (const [i, c] of rows.cards.entries()) {
    console.log(
      `   card ${i} (${i === 0 ? "1-line" : "2-line"})  h=${c.card}  flyer=${c.flyer}  ` +
        `text=${c.textBlock}  SLACK=${c.slack}`,
    );
    console.log(
      `        pad-top=${c.padTop}  title→meta=${c.titleToMeta}  meta→lineup=${c.metaToLineup}  ` +
        `clock=${c.clockW}px`,
    );
  }
  await ctx.close();
}

await browser.close();
server.kill("SIGTERM");
