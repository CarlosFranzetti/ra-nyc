// The transport against the real SoundCloud widget.
//
// Every other suite fakes the widget, which is right — a suite must not depend
// on what the network allows — and is also how the player came to be tested
// for weeks against a widget that behaved better than the real one. The fake
// said PLAY when a set started. The real one says PLAY for the set it is
// *leaving*, the instant `load()` is called, and PAUSE-then-PLAY on every
// ordinary start; both were being read as something else. And the watchdog was
// tuned against a fake that is either instant or dead, so it had never met the
// case that matters on a phone: slow.
//
// So this one plays real streams. It is NOT part of `test:all` and must not
// become part of it: it needs SoundCloud, it needs production for its data, and
// it takes five minutes. Run it by hand after touching anything under
// `src/lib/players/` or the watchdog in `PlayerContext`:
//
//   npm run test:live                       # the working tree, on its own Vite
//   BASE=https://ra-nyc.vercel.app npm run test:live     # what is deployed
//   ONLY=slowStart HOLD=12000 npm run test:live          # one scenario
//
// Listings and sets come from production's API either way, so the sets are
// whatever is on in New York this week.
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PROD = "https://ra-nyc.vercel.app";
const PORT = Number(process.env.E2E_PORT ?? 5197);
const BASE = process.env.BASE ?? `http://127.0.0.1:${PORT}`;
const LOCAL = BASE.startsWith("http://127.0.0.1");
const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
/** How long the slow-start scenario holds back everything SoundCloud serves. */
const HOLD = Number(process.env.HOLD ?? 12000);
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    "/opt/pw-browsers",
    join(homedir(), ".cache", "ms-playwright"),
    join(homedir(), "Library", "Caches", "ms-playwright"),
  ].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    if (existsSync(join(root, "chromium"))) return join(root, "chromium");
    for (const dir of readdirSync(root).filter((d) => d.startsWith("chromium")).sort().reverse()) {
      for (const tail of [["chrome-linux64", "chrome"], ["chrome-linux", "chrome"], ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"]]) {
        const candidate = join(root, dir, ...tail);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  throw new Error("No Chromium found. Set PLAYWRIGHT_CHROMIUM_PATH.");
}

let server;
if (LOCAL && !process.env.BASE) {
  server = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1", "--strictPort"], { stdio: "ignore" });
  process.on("exit", () => {
    try {
      server.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  });
  for (let i = 0; ; i += 1) {
    try {
      await fetch(BASE);
      break;
    } catch {
      if (i > 160) throw new Error("Dev server never came up");
      await sleep(250);
    }
  }
}

// A session behind an HTTPS proxy reaches the outside through it; a laptop does not need one.
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
const browser = await chromium.launch({ executablePath: findChromium(), proxy });

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

async function open(extra) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: UA,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.route(/vercel-scripts|_vercel\/insights/, (r) => r.abort());
  if (LOCAL) {
    // Vite serves the app; the data is production's.
    await page.route(`${BASE}/api/**`, async (route) => {
      const u = new URL(route.request().url());
      try {
        await route.fulfill({ response: await route.fetch({ url: `${PROD}${u.pathname}${u.search}` }) });
      } catch {
        await route.abort();
      }
    });
  }
  if (extra) await extra(context);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("article", { timeout: 40000 });
  await page.waitForTimeout(1200);
  return { page, context };
}

/** The transport as a listener sees it. */
const bar = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("div.fixed.player-live");
    if (!el) return null;
    const seek = el.querySelector('input[aria-label="Seek"]');
    return {
      title: el.querySelector(".player-title")?.textContent ?? "",
      sub: el.querySelector(".player-sub")?.textContent ?? "",
      pos: seek ? Number(seek.value) : null,
      max: seek ? Number(seek.max) : null,
      notice: el.getAttribute("data-notice") ?? null,
      playing: Boolean(el.querySelector('button[aria-label="Pause"]')),
    };
  });

/** Opens the first DJ on tonight's listings with at least `min` sets and taps set `nth`. */
async function startArtist(page, { min = 3, nth = 0 } = {}) {
  const articles = page.locator("article");
  const n = Math.min(await articles.count(), 10);
  for (let i = 0; i < n; i += 1) {
    await articles.nth(i).click();
    await page.waitForTimeout(1500);
    const chips = page.locator("[data-vaul-drawer] div.rounded-full.bg-secondary > button:first-child");
    const c = Math.min(await chips.count(), 3);
    for (let j = 0; j < c; j += 1) {
      await chips.nth(j).click().catch(() => {});
      const plays = page.locator('[data-vaul-drawer] button[aria-label^="Play "]');
      await plays.first().waitFor({ timeout: 25000 }).catch(() => {});
      if ((await plays.count()) >= min) {
        const label = await plays.nth(nth).getAttribute("aria-label");
        await plays.nth(nth).click();
        return label.replace(/^Play /, "");
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(700);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  }
  throw new Error("no DJ with enough sets on tonight's listings");
}

/** Sound, as far as a page can tell: the same title, and the position going up. */
async function moving(page, seconds = 20) {
  let prev = null;
  for (let i = 0; i < seconds * 2; i += 1) {
    await page.waitForTimeout(500);
    const b = await bar(page);
    if (b && prev && b.title === prev.title && b.pos > prev.pos && b.pos > 0) return b;
    prev = b;
  }
  return null;
}

const seekToEnd = (page) =>
  page.evaluate(() => {
    const s = document.querySelector('input[aria-label="Seek"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    set.call(s, s.max);
    s.dispatchEvent(new Event("input", { bubbles: true }));
    s.dispatchEvent(new Event("change", { bubbles: true }));
    s.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
const tap = (page, label) =>
  page.locator(`div.fixed.player-live button[aria-label^="${label}"]`).first().click({ timeout: 4000 });
const brief = (b) => (b ? JSON.stringify({ title: b.title.slice(0, 36), sub: b.sub.slice(-12), pos: Math.round(b.pos ?? -1), notice: b.notice, playing: b.playing }) : "no bar");

const scenarios = {
  /** A set that plays out hands over to the next one, and that is not a skip. */
  async naturalEnd() {
    const { page, context } = await open();
    await startArtist(page);
    const first = await moving(page);
    check("a tapped set makes sound", first, brief(first));
    await seekToEnd(page); // the app stops this a few seconds short, so the set plays out
    const t = Date.now();
    let after = null;
    for (let i = 0; i < 60 && !after; i += 1) {
      await page.waitForTimeout(500);
      const b = await bar(page);
      if (b && b.title !== first?.title && b.pos > 0 && b.playing) after = b;
    }
    check("the next set starts by itself when one ends", after, after ? `${((Date.now() - t) / 1000).toFixed(1)}s later, ${brief(after)}` : brief(await bar(page)));
    check("and it is not reported as a skip", after && after.notice === null, `notice ${after?.notice}`);
    await context.close();
  },

  /** Five skips as fast as a thumb goes. */
  async rapidSkips() {
    const { page, context } = await open();
    await startArtist(page, { min: 6 });
    await moving(page);
    for (let i = 0; i < 5; i += 1) {
      await tap(page, "Next").catch(() => {});
      await page.waitForTimeout(180);
    }
    const b = await moving(page, 25);
    const final = await bar(page);
    check("after five quick skips the set landed on plays", b, brief(final));
    check("and it is the sixth set", /6 of/.test(final?.sub ?? ""), final?.sub);
    await context.close();
  },

  /** Pause, tapped while the next set is still arriving. */
  async pauseDuringLoad() {
    const { page, context } = await open();
    await startArtist(page);
    await moving(page);
    await tap(page, "Next");
    await page.waitForTimeout(250);
    await tap(page, "Pause").catch(() => {});
    await page.waitForTimeout(6000);
    const held = await bar(page);
    await page.waitForTimeout(2000);
    const still = await bar(page);
    check("a pause tapped during a skip holds", still && !still.playing && Math.abs(still.pos - held.pos) < 0.5, brief(still));
    await tap(page, "Play").catch(() => {});
    check("and play afterwards makes sound", await moving(page, 15), brief(await bar(page)));
    await context.close();
  },

  /**
   * Slow is not dead. Everything SoundCloud serves is held back `HOLD` ms — the
   * widget's own code as well as the audio — which is a poor signal, not a
   * broken set. It must be waited for, and the bar must say why it is quiet.
   */
  async slowStart() {
    const { page, context } = await open(async (context) => {
      await context.route(/sndcdn\.com/, async (route) => {
        await sleep(HOLD);
        await route.continue().catch(() => {});
      });
    });
    const want = await startArtist(page);
    const t = Date.now();
    let outcome = null;
    let saidSlow = null;
    for (let i = 0; i < 140 && !outcome; i += 1) {
      await page.waitForTimeout(500);
      const b = await bar(page);
      if (!b) continue;
      if (b.notice === "waiting") saidSlow ??= ((Date.now() - t) / 1000).toFixed(1);
      else if (b.notice) outcome = { kind: `notice "${b.notice}"`, b };
      if (b.title !== want) outcome = { kind: "left the set", b };
      else if (b.pos > 0) outcome = { kind: "sound", b };
    }
    const took = ((Date.now() - t) / 1000).toFixed(1);
    check(`a stream held back ${HOLD / 1000}s is waited for, not skipped`, outcome?.kind === "sound", outcome ? `${outcome.kind} after ${took}s, ${brief(outcome.b)}` : "nothing in 70s");
    // Only owed when the wait is long enough to need explaining.
    if (Number(took) > 12) check("and the bar says it is slow while it waits", saidSlow !== null, saidSlow ? `at ${saidSlow}s` : "never");
    await context.close();
  },

  /** Another set from the list while one plays; then Previous. */
  async tapAnother() {
    const { page, context } = await open();
    await startArtist(page, { min: 4 });
    await moving(page);
    const plays = page.locator('[data-vaul-drawer] button[aria-label^="Play "]');
    const want = (await plays.nth(2).getAttribute("aria-label")).replace(/^Play /, "");
    await plays.nth(2).click();
    const b = await moving(page, 20);
    check("tapping another set in the list switches to it", b && b.title === want, brief(b ?? (await bar(page))));
    await tap(page, "Previous").catch(() => {});
    await page.waitForTimeout(400);
    await tap(page, "Previous").catch(() => {});
    check("previous leaves something playing", await moving(page, 20), brief(await bar(page)));
    await context.close();
  },

  /** A hundred seconds of just listening. */
  async steady() {
    const { page, context } = await open();
    await startArtist(page);
    const a = await moving(page);
    const t = Date.now();
    let trouble = null;
    for (let i = 0; i < 100 && !trouble; i += 1) {
      await page.waitForTimeout(1000);
      const b = await bar(page);
      if (!b.playing || b.title !== a?.title || b.notice) trouble = b;
    }
    const b = await bar(page);
    const wall = (Date.now() - t) / 1000;
    const moved = b.pos - (a?.pos ?? 0);
    check("100 seconds of listening is not interrupted", !trouble, trouble ? brief(trouble) : "");
    check("and the timeline keeps time with the clock", Math.abs(moved - wall) < 4, `${moved.toFixed(1)}s of audio in ${wall.toFixed(1)}s`);
    await context.close();
  },
};

for (const [name, run] of Object.entries(scenarios)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  console.log(`\n== ${name} ==`);
  try {
    await run();
  } catch (error) {
    check(`${name} ran`, false, String(error.message).split("\n")[0].slice(0, 160));
  }
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed against ${BASE}`);
await browser.close();
server?.kill("SIGTERM");
process.exit(passed === results.length ? 0 : 1);
