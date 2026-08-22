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
async function measure({ width, height, density = "default", textSize = "0", typography = "legible" }) {
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
      bodyFont: getComputedStyle(document.body).fontFamily.split(",")[0].replace(/"/g, ""),
      titleWeight: title ? getComputedStyle(title).fontWeight : "",
      // The logo is the one thing on screen that must not move with any
      // preference, so it is read the same way everything else is.
      logo: (() => {
        const word = document.querySelector(".logo-word");
        if (!word) return "";
        const s = getComputedStyle(word);
        return [s.fontFamily.split(",")[0].replace(/"/g, ""), s.fontSize, s.color, s.fontWeight].join(" | ");
      })(),
      mainWidth: Math.round(document.querySelector("main").getBoundingClientRect().width),
      headerWidth: Math.round(
        document.querySelector("header > div").getBoundingClientRect().width,
      ),
      overflowX:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      // Objects, as opposed to the air around them: these must not move with
      // the density preference.
      thumb: card ? Math.round(card.querySelector("div").getBoundingClientRect().width) : 0,
      cardHeight: card ? Math.round(card.getBoundingClientRect().height) : 0,
      headerHeight: Math.round(
        document.querySelector("header > div").getBoundingClientRect().height,
      ),
    };
  });
  await context.close();
  return out;
}

// ── where the date rail parks itself on load
//
// A timing bug rather than a layout one. The rail is scrolled into place by an
// effect, and it used to animate that scroll on mount as well as on a date
// change — so on load the strip started on a fortnight of history and slid,
// and for the first few hundred milliseconds it showed the wrong days.
//
// `instant` on the first placement is the fix, and `instant` specifically: the
// rail carries `scroll-smooth`, and the `auto` behaviour defers to that CSS
// rather than overriding it.
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route("**/api/events*", (route) =>
    route.fulfill({ contentType: "application/json", body: PAYLOAD }),
  );
  await page.route("**/images.ra.co/**", (route) => route.abort());
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Event number 0", { timeout: 20000 });

  // Sampled across the first half-second, not once at the end of it.
  //
  // The end state was always right — a smooth scroll does arrive, it just
  // takes ~400ms to do it, and a single reading taken afterwards cannot tell
  // the two apart. What a person sees on load is the journey: the strip
  // sitting on a fortnight of history and then sliding. So this watches every
  // frame of the window and fails if the rail is *ever* somewhere else.
  const settled = await page.evaluate(async () => {
    const track = document.querySelector("[data-selected='true']")?.parentElement;
    if (!track) return null;
    let wrongAt = null;
    for (let i = 0; i < 25; i++) {
      const selected = track.querySelector("[data-selected='true']");
      const bounds = track.getBoundingClientRect();
      const visible = [...track.children].filter((chip) => {
        const r = chip.getBoundingClientRect();
        return r.left >= bounds.left - 1 && r.right <= bounds.right + 1;
      });
      if (visible[1] !== selected && wrongAt === null) wrongAt = i * 20;
      await new Promise((r) => setTimeout(r, 20));
    }
    return { wrongAt };
  });
  check("the rail is in place from the first frame, with no visible slide",
    settled !== null && settled.wrongAt === null,
    settled?.wrongAt === null ? "" : `still moving at ${settled?.wrongAt}ms`);

  await page.waitForTimeout(600);

  const rail = await page.evaluate(() => {
    const selected = document.querySelector("[data-selected='true']");
    if (!selected) return null;
    const track = selected.parentElement;
    const bounds = track.getBoundingClientRect();
    const visible = [...track.children].filter((chip) => {
      const r = chip.getBoundingClientRect();
      return r.left >= bounds.left - 1 && r.right <= bounds.right + 1;
    });
    return {
      selectedIsSecond: visible[1] === selected,
      firstIsDayBefore: visible[0] === selected.previousElementSibling,
      topLine: selected.querySelector("span")?.textContent ?? "",
      // Every chip the same height: "Today" is five characters in a box sized
      // for three, so if it wrapped this one chip would be taller and put a
      // step in the middle of the rail.
      heights: [
        ...new Set(
          [...track.children].slice(0, 20).map((c) => Math.round(c.getBoundingClientRect().height)),
        ),
      ].length,
      clipped: (() => {
        const label = selected.querySelector("span");
        return label.scrollWidth > label.clientWidth + 1;
      })(),
    };
  });

  check("the rail opens with tonight in the second slot",
    rail !== null && rail.selectedIsSecond);
  check("and the night before it on its left",
    rail !== null && rail.firstIsDayBefore);
  check("tonight's chip says Today rather than its weekday",
    rail !== null && rail.topLine.toLowerCase() === "today", rail?.topLine);
  check("and still fits on one line, level with every other chip",
    rail !== null && rail.heights === 1 && rail.clipped === false,
    rail ? `${rail.heights} distinct heights, clipped=${rail.clipped}` : "no rail");

  await context.close();
}

// ── the document declares its language, and declines to be translated
//
// Both, because the first is not enough. Chrome runs its own detector over the
// visible text and overrides `lang` when it disagrees confidently — and nearly
// every word on the listings screen is a promoter, a party or a DJ alias, none
// of which are English words. It was offering "Indonesian to English" on every
// load.
const doc = await fetch(BASE).then((r) => r.text());
check("the document declares English", /<html[^>]+lang="en"/.test(doc));
check("and opts out of the browser's translate prompt",
  /<meta name="google" content="notranslate"/.test(doc));

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
check("the legible preference selects a distinct family",
  phone.titleFont === "IBM Plex Sans", phone.titleFont);
const systemType = await measure({ width: 390, height: 844, typography: "system" });
check("and the system preference does not", systemType.titleFont !== "IBM Plex Sans",
  systemType.titleFont);

// Condensed is a heading-only pairing, so the family has to be asserted on a
// heading and the body checked separately — that split is the whole option.
const condensed = await measure({ width: 390, height: 844, typography: "condensed" });
check("the condensed preference reaches headings", condensed.titleFont === "Fjalla One",
  condensed.titleFont);
check("and leaves body text to the system sans",
  condensed.bodyFont !== "Fjalla One", condensed.bodyFont);

// Anton came out of this slot because it ships one weight and that weight is a
// poster. Fjalla One also ships one weight, and this is the assertion that the
// distinction is real: 400, not the 600 the headline rules ask for elsewhere.
// If that ever reads back as 600 the browser is synthesising a bold from a
// family that has none, which is the smeared outline this slot exists to avoid.
check("neither display face sets headings at full bold",
  phone.titleWeight === "600" && condensed.titleWeight === "400",
  `legible ${phone.titleWeight}, condensed ${condensed.titleWeight}`);

// ── density moves air, not objects
//
// Tailwind shares one scale between padding and width/height, and this app
// multiplies that scale by the Density preference. So `w-24` on a flyer and
// `w-3` on a map pin were being scaled along with the gaps around them — which
// is right for air and wrong for things. Tightening the ladder to 0.42 made it
// obvious: the flyer came out at 40px and the pin at five, on a screen whose
// whole job is showing flyers.
const denseCard = await measure({ width: 390, height: 844, density: "tight" });
const airyCard = await measure({ width: 390, height: 844, density: "airy" });

check("the flyer is the same size at every density",
  denseCard.thumb === airyCard.thumb && denseCard.thumb === 80,
  `tight ${denseCard.thumb}px, airy ${airyCard.thumb}px`);
check("and so is the header, so the logo keeps its own small margin",
  denseCard.headerHeight === airyCard.headerHeight,
  `tight ${denseCard.headerHeight}px, airy ${airyCard.headerHeight}px`);
check("while the card itself still breathes differently",
  denseCard.cardHeight < airyCard.cardHeight,
  `${denseCard.cardHeight}px vs ${airyCard.cardHeight}px`);

// ── the whole point of coupling spacing to text size
// The ladder is six rungs, all upward, so the bottom of it *is* the default —
// there is no "smaller". Ends and middle are enough to prove monotonicity.
const smaller = await measure({ width: 390, height: 844, textSize: "0" });
const midsize = await measure({ width: 390, height: 844, textSize: "2" });
const larger = await measure({ width: 390, height: 844, textSize: "5" });

// ── the logo opts out of all of it
// It used to inherit the typeface from <html> and the tint from the theme, so
// the app's own name changed with the settings. Asserted across typography,
// text size and viewport at once, because each of those is a separate way to
// break it and any one of them turns the wordmark back into a heading.
check("the logo ignores the typography preference",
  phone.logo === systemType.logo, `${phone.logo}  vs  ${systemType.logo}`);
check("and the text size preference",
  smaller.logo === larger.logo && smaller.logo === phone.logo,
  `${smaller.logo}  vs  ${larger.logo}`);
check("and does not grow with the desktop root size",
  desktop.logo === phone.logo, `${phone.logo}  vs  ${desktop.logo}`);
check("and is a fixed near-white rather than the theme's foreground",
  phone.logo.includes("rgb(242, 244, 245)"), phone.logo);

check("padding grows with text size instead of standing still",
  larger.cardPadding > midsize.cardPadding && midsize.cardPadding > smaller.cardPadding,
  `${smaller.cardPadding} < ${midsize.cardPadding} < ${larger.cardPadding}`);

// Coupled, but at partial strength — full coupling is what blew the layout
// apart before, and none at all is what made "Larger" read cramped.
const padRatio = larger.cardPadding / smaller.cardPadding;
const fontRatio = larger.rootFontSize / smaller.rootFontSize;
check("but at partial strength, not one for one",
  padRatio > 1 && padRatio < fontRatio,
  `padding x${padRatio.toFixed(3)} vs type x${fontRatio.toFixed(3)}`);

// Ink-to-air is the thing being held steady across the nine combinations.
const ratios = [smaller, midsize, larger].map((m) => m.cardPadding / m.rootFontSize);
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
