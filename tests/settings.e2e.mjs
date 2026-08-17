/**
 * The Text size slider, end to end.
 *
 * Run with:  npm run test:settings
 *
 * Narrow suite, one control, and it exists for the same reason the donate one
 * does: this thing lives inside a vaul drawer, and vaul drags on pointer
 * events. A right-hand drawer reads a left-to-right pointer drag as "dismiss
 * me" — which is the same gesture as raising the text size. Without
 * `data-vaul-no-drag` on the wrapper, turning the type up closes the panel you
 * turned it up from, and nothing about the markup looks wrong.
 *
 * The other half is arithmetic that only shows up on screen. A range thumb's
 * centre travels from half-a-thumb to width-minus-half-a-thumb, never to the
 * edges, so tick marks laid out across the full width drift out of line with
 * it — worst at the two ends, which are the two positions people actually
 * check. That is why the fill and the ticks are inset by 10px, and why this
 * asserts they still meet at every rung rather than only in the middle.
 *
 * `--text-scale` on <html> is the real readout throughout: the point of the
 * control is the app resizing, not the input reporting a number back.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 5204);
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

/** The ladder in index.css. A second copy, so a change to it has to be meant. */
const STEPS = 6;
const TOP_SCALE = 1.338;

const TODAY = new Date().toISOString().slice(0, 10);
const PAYLOAD = JSON.stringify({
  date: TODAY,
  count: 1,
  events: [
    {
      id: "e0",
      title: "Event number 0",
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
    },
  ],
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
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
await page.route("**/api/events*", (route) =>
  route.fulfill({ contentType: "application/json", body: PAYLOAD }),
);
await page.route("**/images.ra.co/**", (route) => route.abort());

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Event number 0", { timeout: 20000 });
await page.tap('button[aria-label="Customize"]');
await page.waitForTimeout(700);

const slider = page.locator('input[type="range"][aria-label="Text size"]');
check("the text size control is a range input", (await slider.count()) === 1);
check(
  "with one stop per rung of the ladder",
  (await slider.getAttribute("max")) === String(STEPS - 1) &&
    (await slider.getAttribute("step")) === "1",
  `max ${await slider.getAttribute("max")}, step ${await slider.getAttribute("step")}`,
);

/** What the app is actually doing, rather than what the input says it is. */
const scale = () =>
  page.evaluate(() =>
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--text-scale"),
    ),
  );
const open = async () => (await slider.count()) === 1;

const start = await scale();

// ── tapping the track, which is the "click at a size point" half
await slider.click({ position: { x: (await slider.boundingBox()).width - 4, y: 14 } });
await page.waitForTimeout(250);
const tappedTop = await scale();
check("a tap near the end jumps straight there rather than stepping",
  tappedTop === TOP_SCALE, `${start} → ${tappedTop}`);

await slider.click({ position: { x: 2, y: 14 } });
await page.waitForTimeout(250);
check("and a tap at the other end comes all the way back", (await scale()) === 1);

// ── dragging, which is the half that vaul wants to eat
const box = await slider.boundingBox();
await page.mouse.move(box.x + 12, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(250);

const dragged = await scale();
check("dragging the thumb resizes the app", dragged > 1, `scale ${dragged}`);

// The one that matters. A right-hand vaul drawer dismisses on exactly this
// gesture unless the wrapper opts out, and the symptom is the panel vanishing
// mid-drag rather than anything looking broken in the markup.
//
// Waited out rather than read immediately, and by visibility rather than by
// presence: vaul keeps the panel mounted for the length of its exit
// transition, so an instant `count()` here reports a drawer that is already
// on its way out as still open. Sabotaging the opt-out to check this test
// bites is what surfaced that — the drag assertion failed correctly while
// this one passed, describing a drawer that was gone two checks later.
await page.waitForTimeout(800);
const survived = await slider.isVisible().catch(() => false);
check("and does not dismiss the drawer it lives in", survived);

// Reopen rather than letting every later check die on a missing element. The
// assertion above is the report; a cascade of timeouts under it is noise, and
// a crashed run hides the checks that come after.
if (!survived) {
  await page.tap('button[aria-label="Customize"]');
  await page.waitForTimeout(700);
}

// ── the keyboard path, which is free with a range input and absent without one
await slider.focus();
await page.keyboard.press("Home");
await page.waitForTimeout(200);
check("Home returns to the smallest step", (await scale()) === 1);
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(200);
check("and an arrow key moves exactly one rung", (await scale()) > 1);
await page.keyboard.press("End");
await page.waitForTimeout(200);
check("End reaches the largest", (await scale()) === TOP_SCALE);

// ── the fill has to end where the thumb sits, at both ends and in between
const misaligned = [];
for (let step = 0; step < STEPS; step += 1) {
  const b = await slider.boundingBox();
  // Aim at the rung's own position on the thumb's travel, not on the track.
  await page.mouse.click(b.x + 10 + ((b.width - 20) * step) / (STEPS - 1), b.y + b.height / 2);
  await page.waitForTimeout(180);
  const gap = await page.evaluate((i) => {
    const input = document.querySelector('input[type="range"][aria-label="Text size"]');
    if (Number(input.value) !== i) return `value ${input.value} ≠ ${i}`;
    const ticks = [...input.parentElement.querySelectorAll("span")];
    const fill = input.parentElement.querySelector(".bg-primary");
    const centre = ticks[i].getBoundingClientRect();
    return Math.abs(
      fill.getBoundingClientRect().right - (centre.left + centre.width / 2),
    );
  }, step);
  if (typeof gap === "string" || gap > 1.5) misaligned.push(`${step}: ${gap}`);
}
check("the fill ends on the tick it is pointing at, at every rung",
  misaligned.length === 0, misaligned.join("; "));

// The control is the one thing in the panel that must not resize while it is
// being used — the rest of the drawer is rem-based and does. A slider that
// grows under the thumb moves the target mid-drag.
await page.keyboard.press("Home");
await page.waitForTimeout(200);
const small = await slider.boundingBox();
await page.keyboard.press("End");
await page.waitForTimeout(250);
const large = await slider.boundingBox();
check("the slider itself does not grow with the size it sets",
  small.height === large.height && small.height === 28,
  `${small.height}px then ${large.height}px`);

// ── the typeface slider, which is the same control over a different axis
const fontSlider = page.locator('input[type="range"][aria-label="Typography"]');
check("the typeface control is a range input too", (await fontSlider.count()) === 1);

const face = () =>
  page.evaluate(() =>
    [...document.documentElement.classList].find((c) => c.startsWith("type-")),
  );

await fontSlider.click({ position: { x: (await fontSlider.boundingBox()).width - 4, y: 14 } });
await page.waitForTimeout(250);
check("sliding it to the end selects the condensed face",
  (await face()) === "type-condensed", (await face()) ?? "none");

await fontSlider.click({ position: { x: 2, y: 14 } });
await page.waitForTimeout(250);
check("and back to the start returns to the system face",
  (await face()) === "type-system", (await face()) ?? "none");

// The names under the track are still the picker, not decoration.
await page.locator('button[aria-pressed]:has-text("Legible")').click();
await page.waitForTimeout(250);
check("tapping a name under the track picks it too", (await face()) === "type-legible",
  (await face()) ?? "none");

// ── the panel must survive being used
//
// This is the complaint that produced the data-controls region: the old rule
// closed on anything that was not a button, link or input, and a slider is
// surrounded by things that are none of those. A finger leaving the track a few
// pixels high after a drag landed on one of them and the panel shut mid-adjust.
const stillOpen = async () =>
  (await page.locator('input[aria-label="Text size"]').isVisible().catch(() => false));

const sizeBox = await slider.boundingBox();
// Just above the track: inside the group, outside every control.
await page.mouse.click(sizeBox.x + sizeBox.width / 2, sizeBox.y - 10);
await page.waitForTimeout(600);
check("a tap in the space around a slider does not dismiss the panel", await stillOpen());

// The heading of a group — also not a control, also inside the block.
await page.locator("text=Typography").first().click({ force: true });
await page.waitForTimeout(600);
check("nor does a tap on a group heading", await stillOpen());

// Dead space past the end of the options still closes, which is the behaviour
// the region was carved out of rather than a replacement for it.
const controls = await page.locator("[data-controls]").boundingBox();
await page.mouse.click(controls.x + controls.width / 2, controls.y + controls.height + 60);
await page.waitForTimeout(700);
check("but a tap past the end of the options still closes it",
  (await stillOpen()) === false);

await browser.close();
server.kill("SIGTERM");

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
