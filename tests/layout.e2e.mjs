/**
 * End-to-end checks for responsive layout and the preference axes.
 *
 * Run with:  npm run test:layout
 *
 * These are all things that only exist as computed style — a grid that has to
 * gain columns, a custom property built out of two others, a font that has to
 * actually apply. None of it can be asserted from the source, and all of it is
 * the kind of thing a stray Tailwind class silently undoes.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 5193);
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

const TODAY = new Date().toISOString().slice(0, 10);
const ev = (i) => ({
  id: `e${i}`,
  title: `Event number ${i}`,
  date: `${TODAY}T00:00:00.000`,
  startTime: `${TODAY}T22:00:00.000`,
  endTime: null,
  url: "https://ra.co/events/1",
  imageUrl: null,
  venue: { name: "Nowadays", area: "New York" },
  artists: [{ id: "a", name: "Objekt" }],
  attending: 50,
  isPick: false,
  pickBlurb: null,
});
const PAYLOAD = JSON.stringify({
  date: TODAY,
  events: Array.from({ length: 9 }, (_, i) => ev(i)),
  count: 9,
});

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

/** Loads the app at a viewport with preferences pre-seeded, and measures it. */
async function measure({ width, height, density = "default", textSize = "default", typography = "display" }) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.route("**/api/events*", (route) =>
    route.fulfill({ contentType: "application/json", body: PAYLOAD }),
  );
  await page.route("**/images.ra.co/**", (route) => route.abort());
  await page.addInitScript(
    ([d, t, f]) =>
      localStorage.setItem(
        "ra-theme-settings",
        JSON.stringify({ colorTheme: "neon", layoutDensity: d, typography: f, textSize: t }),
      ),
    [density, textSize, typography],
  );
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Event number 0", { timeout: 20000 });
  await page.waitForTimeout(900);

  const out = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const list = document.querySelector(".stagger-animation");
    const card = document.querySelector("article");
    const title = document.querySelector("h3");
    return {
      columns: list ? getComputedStyle(list).gridTemplateColumns.split(/\s+/).length : 0,
      // Padding is the whole spacing scale in miniature: it is `calc(8px *
      // var(--space))`, so reading it back reads --space.
      cardPadding: card ? parseFloat(getComputedStyle(card).padding) : 0,
      rootFontSize: parseFloat(root.fontSize),
      titleFont: title ? getComputedStyle(title).fontFamily.split(",")[0].replace(/"/g, "") : "",
      mainWidth: Math.round(document.querySelector("main").getBoundingClientRect().width),
      headerWidth: Math.round(
        document.querySelector("header > div").getBoundingClientRect().width,
      ),
      overflowX:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  await context.close();
  return out;
}

// ── the manifest, which is what makes an install chrome-free
const manifestRes = await fetch(`${BASE}/manifest.webmanifest`);
check("a web app manifest is served", manifestRes.ok, `HTTP ${manifestRes.status}`);
const manifest = manifestRes.ok ? await manifestRes.json() : {};
check("it asks for a window without browser chrome", manifest.display === "standalone",
  String(manifest.display));
check("it names a desktop fallback too",
  Array.isArray(manifest.display_override) &&
    manifest.display_override.includes("window-controls-overlay"));
check("it ships a maskable icon, so Android does not crop the mark off",
  (manifest.icons ?? []).some((i) => i.purpose === "maskable"));

// ── responsive columns
const phone = await measure({ width: 390, height: 844 });
const laptop = await measure({ width: 1440, height: 900 });
const desktop = await measure({ width: 1920, height: 1080 });
const wide = await measure({ width: 2560, height: 1440 });

check("a phone keeps one column", phone.columns === 1, `${phone.columns}`);
check("a laptop gets two", laptop.columns === 2, `${laptop.columns}`);
check("a large desktop gets three", desktop.columns === 3, `${desktop.columns}`);
check("nothing scrolls sideways at any width",
  [phone, laptop, desktop, wide].every((m) => m.overflowX === 0));

// The point of the measure cap: past a certain width the listings stop growing.
check("the measure stops growing rather than following the window",
  wide.mainWidth === desktop.mainWidth && wide.mainWidth < 2560,
  `${desktop.mainWidth}px at 1920, ${wide.mainWidth}px at 2560`);
check("the header shares the listings' measure",
  desktop.headerWidth === desktop.mainWidth,
  `header ${desktop.headerWidth} vs main ${desktop.mainWidth}`);
check("desktop type is larger than phone type",
  desktop.rootFontSize > phone.rootFontSize,
  `${phone.rootFontSize}px vs ${desktop.rootFontSize}px`);

// ── typography preference actually applies
check("the display preference selects a distinct family",
  phone.titleFont === "Bricolage Grotesque", phone.titleFont);
const systemType = await measure({ width: 390, height: 844, typography: "system" });
check("and the system preference does not", systemType.titleFont !== "Bricolage Grotesque",
  systemType.titleFont);

// ── the whole point of coupling spacing to text size
const smaller = await measure({ width: 390, height: 844, textSize: "smaller" });
const larger = await measure({ width: 390, height: 844, textSize: "larger" });

check("padding grows with text size instead of standing still",
  larger.cardPadding > phone.cardPadding && phone.cardPadding > smaller.cardPadding,
  `${smaller.cardPadding} < ${phone.cardPadding} < ${larger.cardPadding}`);

// Coupled, but at partial strength — full coupling is what blew the layout
// apart before, and none at all is what made "Larger" read cramped.
const padRatio = larger.cardPadding / smaller.cardPadding;
const fontRatio = larger.rootFontSize / smaller.rootFontSize;
check("but at partial strength, not one for one",
  padRatio > 1 && padRatio < fontRatio,
  `padding x${padRatio.toFixed(3)} vs type x${fontRatio.toFixed(3)}`);

// Ink-to-air is the thing being held steady across the nine combinations.
const ratios = [smaller, phone, larger].map((m) => m.cardPadding / m.rootFontSize);
const spread = Math.max(...ratios) - Math.min(...ratios);
check("so the ratio of padding to type stays close across sizes",
  spread < 0.06, `spread ${spread.toFixed(3)}`);

// ── density remains an independent axis
const tight = await measure({ width: 390, height: 844, density: "tight" });
const airy = await measure({ width: 390, height: 844, density: "airy" });
check("density still moves spacing on its own",
  airy.cardPadding > phone.cardPadding && phone.cardPadding > tight.cardPadding,
  `${tight.cardPadding} < ${phone.cardPadding} < ${airy.cardPadding}`);
check("and does not move type",
  tight.rootFontSize === airy.rootFontSize, `${tight.rootFontSize}px`);

await browser.close();
shutdown();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
