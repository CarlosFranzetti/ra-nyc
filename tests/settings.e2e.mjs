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

// ── the hidden screen
//
// Open Customize, close it, then tap the logo seventeen times. The counting
// itself is unit-tested in tests/unit/secretTaps.test.ts; what this checks is
// the wiring — that the panel closing is what arms it, that the logo is
// actually a tap target, and that the thing which opens is on top of
// everything rather than trapped inside the header's backdrop-filter.
const TAPS = 17;
const logo = page.locator(".logo");
const boxes = () => page.locator('[aria-label="More divisions"]');
const tapLogo = async (times) => {
  for (let i = 0; i < times; i++) await logo.click({ position: { x: 10, y: 10 } });
};

// One short of the sequence, first: a check that only ever taps the full count
// cannot tell "opens on the seventeenth" from "opens whenever you tap it".
await tapLogo(TAPS - 1);
await page.waitForTimeout(300);
check("sixteen taps do not open it", (await boxes().count()) === 0);

// The panel is already closed by the check above, so the sequence is armed.
// This continues the run rather than starting one — the taps are well inside
// the 1.5s window — so it is the seventeenth that opens it.
await tapLogo(1);
await page.waitForTimeout(400);
check("the seventeenth tap opens the hidden screen", (await boxes().count()) === 1);

// It has to sit above the transport bar's z-[70], and a portal is the only way
// it can: the header it is triggered from has a backdrop-filter, which
// contains fixed-position descendants.
const layered = await page.evaluate(() => {
  const el = document
    .querySelector('[aria-label="More divisions"]')
    ?.closest("div.fixed");
  if (!el) return null;
  return {
    z: Number(getComputedStyle(el).zIndex),
    body: el.parentElement === document.body,
    full: Math.round(el.getBoundingClientRect().height) >= window.innerHeight - 1,
  };
});
check("it covers the app rather than sitting inside the header",
  layered !== null && layered.z >= 100 && layered.body && layered.full,
  JSON.stringify(layered));

const screen = await page.evaluate(() => {
  const root = document
    .querySelector('[aria-label="More divisions"]')
    ?.closest("div.fixed");
  if (!root) return null;
  const rules = [...root.querySelectorAll("div")].filter((d) =>
    d.className.includes("border-dotted"),
  );
  // Two columns side by side, so the rules split into exactly two distinct
  // left edges.
  const lefts = new Set(rules.map((d) => Math.round(d.getBoundingClientRect().left)));
  const exits = root.querySelectorAll('[aria-label="Close"]').length;
  const title = root.textContent?.trim() ?? "";
  const stepper = document.querySelector('[aria-label="More divisions"]')
    ?.getBoundingClientRect();
  return {
    rules: rules.length,
    columns: lefts.size,
    exits,
    title,
    // Everything the screen says apart from its own name. The original showed
    // a count in the header and an index inside every box; the requirement is
    // that none of that is left, so the strongest form of the check is that
    // there is no other text at all — which also catches a stray label rather
    // than only a stray digit.
    //
    // The name is stripped rather than scanned for digits, because "wO0tz!"
    // contains a zero and a digit test would fail on the title itself.
    rest: title.replace("wO0tz!", "").trim(),
    stepperBottom: stepper ? Math.round(stepper.bottom) : 0,
    stepperWidth: stepper ? Math.round(stepper.width) : 0,
    windowHeight: window.innerHeight,
    windowWidth: window.innerWidth,
  };
});

check("the rules are drawn in two columns", screen?.columns === 2, `${screen?.columns}`);
// 18 to 25 divisions, doubled by the second column.
check("and the division count is inside 18–25",
  screen !== null && screen.rules >= 36 && screen.rules <= 50 && screen.rules % 2 === 0,
  `${screen?.rules} rules = ${(screen?.rules ?? 0) / 2} divisions`);
check("there is an exit at each side", screen?.exits === 2, `${screen?.exits}`);
check("the title reads wO0tz!", screen?.title.startsWith("wO0tz!"), screen?.title);
check("and nothing on it is numbered or labelled but the title",
  screen?.rest === "", JSON.stringify(screen?.rest));
check("the stepper is along the bottom, not floating at one side",
  screen !== null &&
    screen.stepperBottom > screen.windowHeight * 0.8 &&
    screen.stepperWidth > screen.windowWidth * 0.35,
  screen ? `bottom ${screen.stepperBottom}/${screen.windowHeight}, width ${screen.stepperWidth}` : "");

// Both exits work, so pick the one a right thumb lands on.
await page.locator('[aria-label="Close"]').last().click();
await page.waitForTimeout(300);
check("and the exit closes it", (await boxes().count()) === 0);

// Disarmed on the way in, so it cannot be reopened without the panel again.
await tapLogo(TAPS);
await page.waitForTimeout(300);
check("tapping seventeen more times does not reopen it",
  (await boxes().count()) === 0);

// ── and none of it exists on a desktop
//
// A separate context with a fine pointer and no touch. The unlock is a
// seventeen-tap run driven by swiping up and down; with a mouse it is neither
// discoverable nor usable, so the trigger is gated on `pointer: coarse`.
const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const deskPage = await desktop.newPage();
await deskPage.route("**/api/events*", (route) =>
  route.fulfill({ contentType: "application/json", body: PAYLOAD }),
);
await deskPage.route("**/images.ra.co/**", (route) => route.abort());
await deskPage.goto(BASE, { waitUntil: "domcontentloaded" });
await deskPage.waitForSelector("text=Event number 0", { timeout: 20000 });
check("the browser reports a fine pointer, so the gate is actually under test",
  await deskPage.evaluate(() => !window.matchMedia("(pointer: coarse)").matches));

await deskPage.click('button[aria-label="Customize"]');
await deskPage.waitForTimeout(500);
await deskPage.keyboard.press("Escape");
await deskPage.waitForTimeout(500);
const deskLogo = deskPage.locator(".logo");
for (let i = 0; i < TAPS + 4; i++) {
  await deskLogo.click({ position: { x: 10, y: 10 } });
}
await deskPage.waitForTimeout(400);
check("the hidden screen cannot be opened on a desktop",
  (await deskPage.locator('[aria-label="More divisions"]').count()) === 0);
await desktop.close();

await browser.close();
server.kill("SIGTERM");

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
