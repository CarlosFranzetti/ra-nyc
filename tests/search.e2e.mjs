/**
 * End-to-end checks for event search.
 *
 * Run with:  npm run test:search
 *
 * Stubs `/api/search` rather than RA, so this covers the sheet, the debounce,
 * the sectioning and the jump-to-day behaviour. The server-side matching and
 * ordering are asserted separately against the compiled resolver, since those
 * are pure functions over a payload and don't need a browser.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 5189);
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

const ev = (id, title, date, venue, artists) => ({
  id,
  title,
  date: `${date}T00:00:00.000`,
  startTime: `${date}T22:00:00.000`,
  endTime: null,
  url: `https://ra.co/events/${id}`,
  imageUrl: "https://images.ra.co/x.jpg",
  venue: { name: venue, area: "New York" },
  artists: artists.map((name, i) => ({ id: `${id}-${i}`, name })),
  attending: 50,
  isPick: false,
  pickBlurb: null,
});

const TODAY = new Date().toISOString().slice(0, 10);
const FUTURE = new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10);
const PAST = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);

const RESULTS = {
  q: "lakuti",
  upcoming: [ev("u1", "Lakuti & Tama Sumo", FUTURE, "Nowadays", ["Lakuti"])],
  past: [ev("p1", "Uzuri Nights", PAST, "Bossa Nova Civic Club", ["Lakuti"])],
  truncated: false,
};
const EMPTY = { q: "zzzz", upcoming: [], past: [], truncated: false };

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
const context = await browser.newContext({
  ...devices["iPhone 13"],
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

let searchCalls = 0;
await page.route("**/api/events*", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      date: TODAY,
      events: [ev("d1", "Tonight Only", TODAY, "Jupiter Disco", ["Someone"])],
      count: 1,
    }),
  }),
);
await page.route("**/api/search*", (route) => {
  searchCalls += 1;
  const q = new URL(route.request().url()).searchParams.get("q") ?? "";
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(q.startsWith("lakuti") ? RESULTS : EMPTY),
  });
});
await page.route("**/images.ra.co/**", (route) => route.abort());

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Tonight Only", { timeout: 20000 });
await page.waitForTimeout(900);

// ── the entry point
const searchBtn = page.locator('button[aria-label="Search events"]');
check("search button is in the header", (await searchBtn.count()) === 1);

const order = await page.evaluate(() => {
  const search = document.querySelector('button[aria-label="Search events"]');
  const cal = document.querySelector('button[aria-label*="alendar"], button[aria-label="Customize"]');
  if (!search || !cal) return null;
  return search.getBoundingClientRect().left < cal.getBoundingClientRect().left;
});
check("search sits to the left of the calendar", order === true);

await searchBtn.click();
await page.waitForSelector('input[aria-label="Search events"]', { timeout: 8000 });
const input = page.locator('input[aria-label="Search events"]');
check("search sheet opens with a field", await input.isVisible());
// Opening search used to show a sentence about minimum query length, which is
// a screenful of nothing at the exact moment the panel is at its shortest —
// the keyboard is up and there are two rows to spend. It now opens onto the
// night already being browsed, so there is something to tap before you type.
check(
  "opens onto tonight's listings rather than an instruction",
  (await page.locator('[role="dialog"]').locator("text=Tonight Only").count()) > 0 &&
    (await page.locator("text=Type at least").count()) === 0,
);

// ── the field has to survive the software keyboard
//
// A phone has two viewports. The **layout** viewport is what `position: fixed`
// and even `100dvh` are measured against, and on iOS it does not shrink when
// the keyboard opens — the keyboard simply covers its bottom.
//
// This was a bottom sheet, and two rounds went into arithmetic for keeping its
// *lower* edge above a rising keyboard. The panel is now anchored to the top of
// the visual viewport instead, which removes the race rather than winning it:
// a field pinned to the top of what you can see cannot be covered by something
// that comes up from the bottom. The checks below are unchanged because they
// always asserted the outcome rather than the mechanism.
//
// Chromium here has no software keyboard, so what is checked is the mechanism
// rather than iOS: `--vvh` and `--kb` are the two numbers `useViewportVars`
// publishes from `visualViewport`, and setting them by hand is exactly what a
// keyboard opening does. If the sheet does not move for these, it will not
// move for a real one either. **The iOS behaviour itself is not covered by any
// test in this repo** — it cannot be from here.
{
  const sheet = () =>
    page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const field = document.querySelector('input[aria-label="Search events"]');
      if (!dialog || !field) return null;
      const box = dialog.getBoundingClientRect();
      const input = field.getBoundingClientRect();
      // Everything read in one pass, from the page, at the same instant.
      // Comparing a height captured here against a window measurement taken
      // from the test process is how an eleven-pixel disagreement appears out
      // of nowhere and costs twenty minutes.
      return {
        window: window.innerHeight,
        gapBelow: Math.round(window.innerHeight - box.bottom),
        height: Math.round(box.height),
        fieldTop: Math.round(input.top),
        fieldBottom: Math.round(input.bottom),
        kb: parseInt(getComputedStyle(document.documentElement).getPropertyValue("--kb")) || 0,
      };
    });

  const closed = await sheet();

  // A keyboard covering the bottom 45% of the window, which is about right for
  // an iPhone in portrait.
  await page.evaluate(() => {
    const root = document.documentElement;
    const kb = Math.round(window.innerHeight * 0.45);
    root.style.setProperty("--kb", `${kb}px`);
    root.style.setProperty("--vvh", `${window.innerHeight - kb}px`);
  });
  // Wait for vaul to finish easing rather than guessing at a duration.
  // Changing the height re-runs its transform animation, and measuring
  // mid-ease reports the sheet a few pixels low — a drifting, non-integer few,
  // which is the tell that it is an animation and not an offset. The first
  // version of this check used a flat 300ms and failed by 7px, then 9px, then
  // 8.65px.
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return false;
    const t = getComputedStyle(dialog).transform;
    if (t === "none") return true;
    const ty = Number(t.split(",").pop()?.replace(")", "") ?? "0");
    return Math.abs(ty) < 0.5;
  }, { timeout: 5000 });
  const open = await sheet();

  check("the panel ends exactly where the keyboard begins",
    open !== null && Math.abs(open.gapBelow - open.kb) <= 1,
    open ? `${open.gapBelow}px above the bottom, keyboard is ${open.kb}px` : "no sheet");

  check("and fills the space left rather than staying full height",
    closed !== null && open !== null && open.height < closed.height,
    closed && open ? `${closed.height} → ${open.height}` : "no sheet");

  // The whole point: the field a keyboard exists to type into must be visible
  // with it open. Both bounds, because there are two ways to fail. Lifting
  // without shrinking overshoots and pushes the field off the *top* — a
  // sabotage run put it at -173 while a lower-bound-only check still passed,
  // which is a check that would have blessed a different broken layout.
  check("so the field sits in the visible band, above the keyboard",
    open !== null && open.fieldTop >= 0 && open.fieldBottom <= open.window - open.kb,
    open
      ? `field occupies ${open.fieldTop}–${open.fieldBottom}, visible band is 0–${open.window - open.kb}`
      : "no sheet");

  // And the point of opening onto the listings: with the keyboard up and
  // nothing typed, there is a tappable row in the band that is left. A panel
  // whose entire visible area is the field it contains is a panel that has
  // nothing to show for the space it took.
  const firstRow = await page.evaluate(() => {
    const card = document.querySelector('[role="dialog"] article');
    if (!card) return null;
    const box = card.getBoundingClientRect();
    const kb = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--kb"),
    );
    return { top: Math.round(box.top), bottom: Math.round(box.bottom), band: window.innerHeight - kb };
  });
  check(
    "a result is on screen above the keyboard before anything is typed",
    firstRow !== null && firstRow.top >= 0 && firstRow.bottom <= firstRow.band,
    firstRow
      ? `row occupies ${firstRow.top}–${firstRow.bottom}, visible band is 0–${firstRow.band}`
      : "no row",
  );

  await page.evaluate(() => {
    document.documentElement.style.removeProperty("--kb");
    document.documentElement.style.removeProperty("--vvh");
  });
  await page.waitForTimeout(250);
}

// ── debounce: one request for a burst of keystrokes
searchCalls = 0;
await input.type("lakuti", { delay: 40 });
await page.waitForSelector("text=Lakuti & Tama Sumo", { timeout: 8000 });
await page.waitForTimeout(600);
check("typing is debounced into one request", searchCalls === 1, `${searchCalls} calls`);

// ── sectioning and order
check("upcoming section is present", await page.locator("text=Upcoming · 1").isVisible());
check("past section is present", await page.locator("text=Past · 1").isVisible());
const sectionOrder = await page.evaluate(() => {
  const heads = [...document.querySelectorAll("h3")].map((h) => h.textContent ?? "");
  const up = heads.findIndex((t) => t.startsWith("Upcoming"));
  const past = heads.findIndex((t) => t.startsWith("Past"));
  return up !== -1 && past !== -1 && up < past;
});
check("upcoming is listed before past", sectionOrder);

// The reported bug: the sheet ended after one clipped card, with the dimmed
// listings page showing through the overlay below it. Two things have to hold —
// the sheet fills the viewport, and the first result is fully inside the
// scroller rather than cut off by it.
const geometry = await page.evaluate(() => {
  const sheet = document.querySelector('[role="dialog"]');
  const scroller = sheet?.querySelector("div.overflow-y-auto");
  const card = sheet?.querySelector("article");
  if (!sheet || !scroller || !card) return null;
  const s = sheet.getBoundingClientRect();
  const sc = scroller.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  return {
    sheetFraction: s.height / window.innerHeight,
    scrollerHeight: Math.round(sc.height),
    cardHeight: Math.round(c.height),
    cardFullyInside: c.bottom <= sc.bottom + 1,
  };
});
check("search sheet fills most of the viewport",
  geometry !== null && geometry.sheetFraction > 0.75,
  geometry ? `${Math.round(geometry.sheetFraction * 100)}% of viewport` : "no sheet");
check("the scroller is taller than a single result",
  geometry !== null && geometry.scrollerHeight > geometry.cardHeight,
  geometry ? `scroller ${geometry.scrollerHeight}px vs card ${geometry.cardHeight}px` : "");
check("the first result is not clipped",
  geometry !== null && geometry.cardFullyInside);
const dayLabel = new Date(`${FUTURE}T12:00:00Z`).toLocaleDateString("en-US", {
  weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
});
check("results carry a date, unlike day listings",
  (await page.locator(`[role="dialog"] >> text=${dayLabel}`).count()) > 0, dayLabel);

// ── the empty case must not look like a failure
await input.fill("");
await input.type("zzzz", { delay: 30 });
await page.waitForSelector("text=No events found", { timeout: 8000 });
check("empty results say so plainly", true);

// ── the query outlives the panel
//
// Closing search is usually "let me look at that one", not "I am done
// searching", so coming back should land on the last thing you looked for
// rather than on an empty box you have to retype. The old sheet reset to empty
// on every open.
await input.fill("");
await input.type("lakuti", { delay: 30 });
await page.waitForSelector("text=Lakuti & Tama Sumo", { timeout: 8000 });
await page.locator('[role="dialog"] >> text=Cancel').click();
await page.waitForTimeout(400);
await searchBtn.click();
await page.waitForSelector('input[aria-label="Search events"]', { timeout: 8000 });
await page.waitForTimeout(400);
const reopened = page.locator('input[aria-label="Search events"]');
check(
  "reopening search keeps the last query, results and all",
  (await reopened.inputValue()) === "lakuti" &&
    (await page.locator("text=Lakuti & Tama Sumo").count()) > 0,
  await reopened.inputValue(),
);
// Selected rather than left with a caret at the end, so the next thing typed
// replaces the old query instead of appending to it.
check(
  "and selects it, so typing starts a new search",
  await page.evaluate(() => {
    const field = document.querySelector('input[aria-label="Search events"]');
    return Boolean(field) && field.selectionStart === 0 &&
      field.selectionEnd === field.value.length && field.value.length > 0;
  }),
);

// ── picking a result jumps to that night and opens it
await reopened.fill("");
await reopened.type("lakuti", { delay: 30 });
await page.waitForSelector("text=Lakuti & Tama Sumo", { timeout: 8000 });
await page.locator("text=Lakuti & Tama Sumo").first().click();
await page.waitForTimeout(900);

check("search sheet closes on pick",
  (await page.locator('input[aria-label="Search events"]').count()) === 0);
const detailsOpen = await page.locator('[role="dialog"]').count();
check("the event opens", detailsOpen > 0);
const jumped = await page.locator(`text=${new Date(`${FUTURE}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}`).first().count();
check("listings jumped to the event's night", jumped > 0);

// ── venue map
await page.route("**/api/venue*", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      name: "Nowadays",
      lat: 40.7108,
      lon: -73.9229,
      label: "Nowadays, Troutman Street, Queens, New York",
      // `address` is what the sheet renders; `label` is the geocoder's raw
      // match and is kept separately so the response can say which of the two
      // sources answered. A stub with only `label` shows no address at all.
      address: "Nowadays, Troutman Street, Queens, New York",
      addressSource: "geocoder",
      mapsUrl: "https://maps.apple.com/?q=Nowadays&ll=40.7108,-73.9229",
    }),
  }),
);
// A 1x1 transparent PNG stands in for every tile, so the mosaic's geometry is
// exercised without reaching CARTO.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
let tileRequests = 0;
await page.route("**/basemaps.cartocdn.com/**", (route) => {
  tileRequests += 1;
  route.fulfill({ contentType: "image/png", body: PIXEL });
});

const venueButton = page.locator('[role="dialog"] button:has-text("Nowadays")').first();
check("the venue name is tappable in the event sheet", (await venueButton.count()) > 0);
await venueButton.click();
await page.waitForSelector('[role="img"][aria-label*="Map of"]', { timeout: 8000 });
check("tapping a venue opens a map", true);

// The mosaic can't be laid out until ResizeObserver has reported the
// container's width, which is a frame or two after it mounts.
await page.waitForFunction(
  () => (document.querySelector('[role="img"][aria-label*="Map of"]')?.querySelectorAll("img").length ?? 0) > 0,
  { timeout: 8000 },
);

// The map used to be an OSM iframe, inverted by CSS into a photographic
// negative. It is now a mosaic of coloured tiles composed here — which means
// the geometry is ours, and worth asserting.
const map = await page.evaluate(() => {
  const box = document.querySelector('[role="img"][aria-label*="Map of"]');
  if (!box) return null;
  const rect = box.getBoundingClientRect();
  const imgs = [...box.querySelectorAll("img")];
  const spans = imgs.map((i) => {
    const r = i.getBoundingClientRect();
    return { left: r.left - rect.left, top: r.top - rect.top, right: r.right - rect.left, bottom: r.bottom - rect.top };
  });
  return {
    tiles: imgs.length,
    filter: getComputedStyle(box).filter,
    // Tiles have to cover the container in both axes, or the map has gaps.
    coversLeft: spans.some((s) => s.left <= 0),
    coversRight: spans.some((s) => s.right >= rect.width),
    coversTop: spans.some((s) => s.top <= 0),
    coversBottom: spans.some((s) => s.bottom >= rect.height),
    hasPin: Boolean(box.querySelector("svg.fill-venue, .fill-venue")),
    // Tiles must be drawn at exactly the size they are positioned on. The
    // spacing scale here is multiplied by the density preference, so a
    // Tailwind size class silently draws a 266px tile on a 256px grid.
    sizes: [...new Set(imgs.map((i) => `${Math.round(i.getBoundingClientRect().width)}x${Math.round(i.getBoundingClientRect().height)}`))],
    // Adjacent tiles must abut, not overlap.
    overlap: spans.some((a) =>
      spans.some((b) => a !== b && a.top === b.top && b.left > a.left && b.left < a.right - 0.5),
    ),
  };
});

check("the map is built from tiles, not an iframe", map !== null && map.tiles > 0,
  map ? `${map.tiles} tiles, ${tileRequests} requests` : "no map");
check("the tiles cover the whole frame",
  map !== null && map.coversLeft && map.coversRight && map.coversTop && map.coversBottom);
check("the tiles are shown in colour, not inverted",
  map !== null && (map.filter === "none" || map.filter === ""), map?.filter);
check("the venue is pinned", map !== null && map.hasPin);
check("tiles are drawn at exactly the size they are placed on",
  map !== null && map.sizes.length === 1 && map.sizes[0] === "256x256", map?.sizes.join(" "));
check("adjacent tiles abut rather than overlap", map !== null && map.overlap === false);

check("there is a way out to the platform's map app",
  (await page.locator('a[aria-label="Show on maps"]').count()) > 0);

// Uber, Lyft, then maps. The order is the order people decide in — hail
// something, and fall back to a map only if you are walking or still working
// out where the place is.
const rideOrder = await page.evaluate(() =>
  [...document.querySelectorAll('[role="dialog"] a[aria-label]')]
    .map((a) => a.getAttribute("aria-label"))
    .filter((l) => /Uber|Lyft|maps/i.test(l ?? ""))
    .map((l) => (/Uber/.test(l) ? "uber" : /Lyft/.test(l) ? "lyft" : "maps")),
);
check("the ways to get there are ordered Uber, Lyft, maps",
  rideOrder.join(",") === "uber,lyft,maps", rideOrder.join(",") || "none");

// Getting there is the next thing you do after finding out where it is.
const uber = page.locator('a[aria-label^="Get an Uber"]');
check("an Uber can be hailed to the venue", (await uber.count()) > 0);
const uberHref = (await uber.first().getAttribute("href")) ?? "";
check("the Uber link carries the venue as the destination",
  uberHref.includes("m.uber.com/ul/") &&
    uberHref.includes("dropoff%5Blatitude%5D=40.7108") &&
    uberHref.includes("Nowadays"),
  uberHref.slice(0, 90));
const lyft = page.locator('a[aria-label^="Get a Lyft"]');
check("a Lyft can be hailed to the venue", (await lyft.count()) > 0);
const lyftHref = (await lyft.first().getAttribute("href")) ?? "";
check("the Lyft link carries the venue as the destination",
  lyftHref.startsWith("https://lyft.com/ride?") &&
    lyftHref.includes("destination%5Blatitude%5D=40.7108") &&
    lyftHref.includes("destination%5Blongitude%5D=-73.9229"),
  lyftHref.slice(0, 90));

// The address is a bold span inside the line rather than the whole line,
// because the distance shares that line and must NOT be bold — it is a
// qualifier on the address, not a second fact.
check("the address is set in bold",
  await page
    .locator('[role="dialog"] span:has-text("Troutman Street")')
    .first()
    .evaluate((el) => Number(getComputedStyle(el).fontWeight) >= 600),
);
check("and is not the same colour as the venue name above it",
  await page.evaluate(() => {
    // Found from the address outwards, not from the first dialog inwards: the
    // venue sheet is stacked over the still-open event sheet, so
    // querySelector('[role="dialog"]') returns the event underneath it.
    const address = [...document.querySelectorAll('[role="dialog"] span')].find(
      (el) => el.textContent?.includes("Troutman Street") && el.children.length === 0,
    );
    const dialog = address?.closest('[role="dialog"]');
    const name = dialog?.querySelector("[class*='text-venue']");
    if (!name || !address) return false;
    return getComputedStyle(name).color !== getComputedStyle(address).color;
  }),
);

check("both tile sources are credited",
  (await page.locator("text=OpenStreetMap contributors").count()) > 0 &&
    (await page.locator("text=CARTO").count()) > 0);

await browser.close();
shutdown();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
