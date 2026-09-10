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
async function measure({ width, height, density = "default", textSize = "0", typography = "base" }) {
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
  // The webfonts load async (`media="print" onload` in index.html), and
  // `getComputedStyle` reports the *declared* family whether or not the file
  // ever arrived. So a width probe taken before they land measures the fallback
  // and reads identical for every face — which is exactly what it did, while
  // the family assertions beside it passed and looked like proof.
  //
  // `.then(() => true)` because `document.fonts.ready` resolves to a
  // FontFaceSet, which Playwright cannot serialise back across the boundary.
  await page.evaluate(() => document.fonts.ready.then(() => true));
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

// ── typography is a legibility ladder, not three flavours
//
// Base / Midnight / Late night, each rung a more readable face *and* a larger
// one. The three properties below are the whole feature, and the third is the
// one that makes the third rung possible at all.
check("Base sets a distinct family",
  phone.titleFont === "IBM Plex Sans", phone.titleFont);

const midnight = await measure({ width: 390, height: 844, typography: "midnight" });
check("Midnight hands over to the system face",
  midnight.titleFont !== "IBM Plex Sans" && midnight.titleFont !== "Barlow Semi Condensed",
  midnight.titleFont);

// Body as well as headings: this slot used to be a heading-only pairing with a
// display face, and it is not one any more — a night mode that only enlarges
// titles has missed the point.
const late = await measure({ width: 390, height: 844, typography: "latenight" });
check("Late night reaches headings", late.titleFont === "Barlow Semi Condensed",
  late.titleFont);
check("and body text too, unlike the display face it replaced",
  late.bodyFont === "Barlow Semi Condensed", late.bodyFont);

// Each rung larger than the last. This is what `--type-scale` buys, and it is
// the half of the request that a font swap alone would not deliver.
check("each rung is larger than the one before it",
  phone.rootFontSize < midnight.rootFontSize &&
    midnight.rootFontSize < late.rootFontSize,
  `${phone.rootFontSize} < ${midnight.rootFontSize} < ${late.rootFontSize}`);

// Three different faces, which is what a ladder of three rungs requires and
// what a deleted rule would silently undo.
//
// **The "narrower" half is deliberately not asserted here, and that is a real
// gap rather than an oversight.** Measuring it needs the webfont to actually
// render, and this sandbox cannot fetch it: Chromium has no proxy configured
// and fonts.googleapis.com comes back ERR_CONNECTION_RESET, so every face falls
// back to the same system sans and a width probe reads identical for all three
// — which it did, while the family assertions above passed and made it look
// measured. Even with the font, the comparison would be against headless
// Linux's system sans rather than the phone's, so the number would not mean
// what it claimed. Barlow Semi Condensed's advance widths are a published
// property of the typeface; this checks that the app asks for it.
const families = [phone.titleFont, midnight.titleFont, late.titleFont];
check("the three rungs are three different faces",
  new Set(families).size === 3, families.join(", "));

// Semibold on both webfont rungs, never 700: at full bold a column of titles
// reads as a stack of bars. Both families ship a real 600, so this also
// asserts the browser is not synthesising one.
check("headings are semibold, not bold",
  phone.titleWeight === "600" && late.titleWeight === "600",
  `base ${phone.titleWeight}, late night ${late.titleWeight}`);

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
// Across all three rungs, not just two — the ladder now changes the root font
// size as well as the family, so there are two separate ways for the wordmark
// to get dragged along with it.
check("the logo ignores the typography preference",
  phone.logo === midnight.logo && phone.logo === late.logo,
  `${phone.logo}  vs  ${midnight.logo}  vs  ${late.logo}`);
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

// ── the opening scan covers the coming week
//
// The rail's own prefetch only ever warms where you have already been. This is
// what covers where you are going — and, more to the point, what *refreshes*
// nights whose cached copy predates whatever was announced since.
{
  const asked = new Set();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  await p.route("**/api/events*", (route) => {
    const date = new URL(route.request().url()).searchParams.get("date");
    if (date) asked.add(date);
    return route.fulfill({ contentType: "application/json", body: PAYLOAD });
  });
  await p.route("**/images.ra.co/**", (route) => route.abort());
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("article", { timeout: 20000 });
  await p.waitForTimeout(1500);

  // From the *night*, not the calendar date.
  //
  // Before 3:30am the night in progress is yesterday's — see lib/night.ts, and
  // the whole app is built on it. This check assumed today's date and so was
  // correct only between 3:30am and midnight; run at 00:46 it demanded a day
  // the scan was right not to fetch. A second copy of the rollover rather than
  // an import, like the size ladder in the settings suite: a change to it has
  // to be meant.
  const ROLLOVER_MINUTES = 3 * 60 + 30;
  const now = new Date();
  const night = new Date(now);
  if (now.getHours() * 60 + now.getMinutes() < ROLLOVER_MINUTES) {
    night.setDate(night.getDate() - 1);
  }
  const wanted = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(night);
    d.setDate(d.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const missing = wanted.filter((d) => !asked.has(d));
  check("opening the app scans the coming week", missing.length === 0,
    missing.length ? `never asked for ${missing.join(", ")}` : `${asked.size} days asked for`);
  await ctx.close();
}

// ── tap targets: big enough, and the same size whatever the preferences say
//
// The app had five different sizes for "an icon button", the smallest of them
// about 22px. Two properties are asserted here, and the second is the one that
// keeps drifting back: a control must be a usable size, *and* it must not be a
// function of the Density or Text size preferences. Both of those scale the
// spacing scale, and several controls were sized out of it — so picking Tight
// shrank the things you press.
{
  /**
   * Everything on screen you can press, with its real touch area.
   *
   * `getBoundingClientRect` does not include a pseudo-element that overflows
   * its box, and `.tap-grow` grows a small control's touch area by exactly
   * that means — so the 6px inset it declares is added back here. Without
   * that, the controls that are deliberately small-but-padded would read as
   * failures.
   */
  const measure = (density, size) => async () => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const p = await ctx.newPage();
    await p.route("**/api/events*", (route) =>
      route.fulfill({ contentType: "application/json", body: PAYLOAD }),
    );
    await p.route("**/images.ra.co/**", (route) => route.abort());
    await p.addInitScript(
      ([d, t]) =>
        localStorage.setItem(
          "ra-theme-settings",
          JSON.stringify({
            colorTheme: "neon",
            layoutDensity: d,
            typography: "base",
            textSize: t,
          }),
        ),
      [density, size],
    );
    await p.goto(BASE, { waitUntil: "domcontentloaded" });
    await p.waitForSelector("article", { timeout: 20000 });
    await p.waitForTimeout(600);

    // Open the event sheet too, so the controls added with the playlist — the
    // lineup chips and their `+` — are on screen and measured.
    await p.locator("article").first().click();
    await p.waitForTimeout(700);

    const found = await p.evaluate(() => {
      const GROW = 6; // matches `.tap-grow` in index.css
      const out = [];
      for (const el of document.querySelectorAll(
        'button, a[href], [role="button"]',
      )) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (getComputedStyle(el).visibility === "hidden") continue;
        const grow = el.classList.contains("tap-grow") ? GROW * 2 : 0;
        out.push({
          label:
            el.getAttribute("aria-label") ||
            (el.textContent ?? "").trim().slice(0, 24) ||
            el.tagName.toLowerCase(),
          w: Math.round(box.width + grow),
          h: Math.round(box.height + grow),
          // An event card is a whole row of content that happens to be
          // tappable, not a control — it *should* grow with density and text
          // size, and every other listing does. Tagged rather than dropped, so
          // it still has to clear the size floor.
          row: Boolean(el.querySelector("article")),
        });
      }
      return out;
    });
    await ctx.close();
    return found;
  };

  const worst = await measure("tight", "0")();
  // 32px is the floor asserted rather than 44, deliberately: a wrapped chip is
  // 34px tall and several hundred wide, and demanding 44 in both directions
  // would mean either square chips or an exemption list that quietly grows
  // until the check means nothing. 32 is the number every control in the app
  // now clears at the tightest setting, so a regression trips it.
  const FLOOR = 32;
  const small = worst.filter((c) => c.w < FLOOR || c.h < FLOOR);
  check(
    "every control is a usable size at the tightest setting",
    small.length === 0,
    small.length
      ? small.map((c) => `${c.label} ${c.w}x${c.h}`).join("; ")
      : `${worst.length} controls, smallest ${Math.min(
          ...worst.map((c) => Math.min(c.w, c.h)),
        )}px`,
  );

  // And constant: the same controls, at the loosest density and the largest
  // text, measure the same. This is what stops a control being sized out of the
  // spacing scale again.
  const loosest = await measure("airy", "5")();
  // Height, not width.
  //
  // A control carrying a word — a filter chip, the header's caption — *should*
  // get wider when the type does, and asserting otherwise would be demanding
  // that text overflow its own button. Height is the dimension that decides
  // whether a thumb lands on it and whether the row above shifts, and it is the
  // one that was being sized out of the density scale.
  const byLabel = new Map(worst.map((c) => [c.label, c]));
  const moved = loosest.filter((c) => {
    if (c.row) return false;
    const before = byLabel.get(c.label);
    return before && before.h !== c.h;
  });
  check(
    "and the same height at every density and text size",
    moved.length === 0,
    moved.length
      ? moved
          .slice(0, 4)
          .map((c) => `${c.label} ${byLabel.get(c.label).h} -> ${c.h}`)
          .join("; ")
      : `${loosest.length} controls unchanged`,
  );

  // The icon-only controls are square and fixed in both dimensions, since they
  // carry no text to grow. Checked by name, so this cannot be satisfied by a
  // control quietly disappearing from the screen.
  const ICONS = ["Search events", "Pick a date", "Customize"];
  const square = (list) =>
    ICONS.map((name) => list.find((c) => c.label === name)).map(
      (c) => `${c?.w}x${c?.h}`,
    );
  const tightIcons = square(worst);
  const airyIcons = square(loosest);
  check(
    "and the header's icon buttons are 44px square either way",
    tightIcons.every((size) => size === "44x44") &&
      airyIcons.join() === tightIcons.join(),
    `${tightIcons.join(", ")} / ${airyIcons.join(", ")}`,
  );
}

await browser.close();
shutdown();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
