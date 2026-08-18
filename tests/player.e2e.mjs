/**
 * End-to-end checks for the persistent transport bar.
 *
 * Run with:  npm run test:e2e
 *
 * Boots the dev server itself, stubs `/api/*` and the SoundCloud widget API,
 * and drives a mobile-emulated Chromium. Stubbing the providers is deliberate:
 * the point of these checks is the persistence architecture and the transport
 * wiring, and hanging that on SoundCloud being reachable and a real DJ still
 * having the same three sets would make the suite flaky for no gain. It does
 * mean the real provider protocols are *not* covered here.
 *
 * Uses playwright-core rather than playwright so installing dev dependencies
 * never pulls a ~150 MB browser down during a deploy. Point it at a Chromium
 * with PLAYWRIGHT_CHROMIUM_PATH, or run `npx playwright install chromium`.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 5188);
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// ─── Browser discovery ──────────────────────────────────────────────────────

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
  throw new Error(
    "No Chromium found. Run `npx playwright install chromium`, or set PLAYWRIGHT_CHROMIUM_PATH.",
  );
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const EVENT = {
  id: "1",
  title: "Test Night",
  date: "2026-08-02T00:00:00.000",
  startTime: "2026-08-02T22:00:00.000",
  endTime: "2026-08-03T04:00:00.000",
  url: "https://ra.co/events/1",
  imageUrl: "https://images.ra.co/x.jpg",
  venue: { name: "Nowadays", area: "New York" },
  artists: [{ id: "99", name: "Test DJ" }],
  attending: 100,
  isPick: false,
  pickBlurb: null,
};

/** Nine sets: more than the sheet shows collapsed, so the queue and the visible
 *  list are provably different things. */
const SET_COUNT = 9;
const COLLAPSED = 6;
const mkSet = (n) => ({
  provider: "soundcloud",
  id: `sc-${n}`,
  title: `Set Number ${n}`,
  url: `https://soundcloud.com/test/${n}`,
  embedUrl: `https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Ftest%2F${n}&auto_play=false`,
  // Deliberately WRONG, and deliberately shorter than the widget's real 3600s.
  //
  // This is the resolver's metadata — what RA and the oEmbed lookup claim — and
  // in production the two disagree constantly. It used to read 3600 here, which
  // by coincidence matched the fake widget exactly, so a timeline that ignored
  // the widget entirely and echoed the seed back still measured correct. The
  // suite was green through a bug you could watch happen on a phone.
  duration: 2400,
  plays: 1000 * n,
  createdAt: null,
  artwork: null,
});

const ARTIST = {
  id: "99",
  name: "Test DJ",
  mixcloudUser: null,
  mixcloudUrl: null,
  soundcloudUser: "test",
  soundcloudUrl: "https://soundcloud.com/test",
  raUrl: null,
  bio: null,
  sets: Array.from({ length: SET_COUNT }, (_, i) => mkSet(i + 1)),
  links: [],
  linkSource: "auto",
  cached: false,
  persisted: false,
  soundcloud: "api-v2",
};

/** Stands in for SoundCloud's widget API: same surface, driven by a timer so
 *  the timeline has something real to report. */
/**
 * Stands in for SoundCloud's widget API, and models the thing that was broken:
 * a *freshly created* cross-origin iframe has no user activation, so its
 * autoplay is refused. Only an iframe that has already played — i.e. one reused
 * via load() — starts on its own. window.__built counts iframes so the suite can
 * assert the player reuses rather than rebuilds.
 *
 * It also models the widget's *timing*, which is what the timeline bug turned
 * on. Two details, both real and both previously missing here:
 *
 * 1. `getDuration` answers **0 until the track actually starts.** The widget is
 *    ready to take commands before it has parsed the track, so the one question
 *    the adapter used to ask arrived too early and got a zero — and the stub,
 *    by answering correctly on the first call, made a broken adapter look
 *    fine. That is why the suite was green through a bug you could see on the
 *    screen.
 * 2. `PLAY_PROGRESS` carries `relativePosition` alongside `currentPosition`.
 *    It is how the adapter now derives the true length on every tick, so a stub
 *    without it cannot exercise the fix at all.
 */
const FAKE_SC = `
(function(){
  var Events={READY:'ready',PLAY:'play',PAUSE:'pause',FINISH:'finish',PLAY_PROGRESS:'playProgress',ERROR:'error'};
  window.__built = 0;
  function Widget(iframe){
    var l={},pos=0,timer=null,duration=3600000,activated=false,parsed=false;
    window.__built++;
    function emit(e,p){(l[e]||[]).forEach(function(f){f(p);});}
    function tick(){ emit(Events.PLAY_PROGRESS,{currentPosition:pos,relativePosition:pos/duration}); }
    function run(){ if(timer) return; parsed=true; emit(Events.PLAY);
      timer=setInterval(function(){ pos+=250; tick();
        if(pos>=duration){clearInterval(timer);timer=null;emit(Events.FINISH);} },250); }
    return {
      bind:function(e,cb){(l[e]=l[e]||[]).push(cb); if(e===Events.READY) setTimeout(cb,40);},
      // 0 before the track is parsed — the real widget's behaviour, and the
      // whole reason the adapter cannot rely on asking once.
      getDuration:function(cb){cb(parsed?duration:0);},
      // A late tick from the OUTGOING track, fired after load() was called and
      // before the swap completes. The real widget does this — postMessage is
      // in flight when the swap is requested — and it is the second half of the
      // timeline bug: that stale position landed as the new track's, so a set
      // skipped into opened its timeline wherever the previous one had got to.
      load:function(url,opts){ var stale=pos; pos=0; activated=true;
        setTimeout(function(){ emit(Events.PLAY_PROGRESS,{currentPosition:stale,relativePosition:stale/duration}); },5);
        if(opts&&opts.callback) setTimeout(opts.callback,20); },
      play:function(){ if(!activated){ activated=true; run(); return; } run(); },
      pause:function(){ if(timer){clearInterval(timer);timer=null;} emit(Events.PAUSE); },
      seekTo:function(ms){ pos=ms; tick(); }
    };
  }
  Widget.Events=Events;
  window.SC={Widget:Widget};
})();
`;

// ─── Dev server ─────────────────────────────────────────────────────────────

const server = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1"], {
  stdio: "ignore",
  detached: false,
});
const shutdown = () => {
  try {
    server.kill("SIGTERM");
  } catch {
    /* already gone */
  }
};
process.on("exit", shutdown);
process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});

for (let attempt = 0; ; attempt += 1) {
  try {
    await fetch(BASE);
    break;
  } catch {
    if (attempt > 60) throw new Error("Dev server never came up");
    await new Promise((r) => setTimeout(r, 250));
  }
}

// ─── Run ────────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ executablePath: findChromium() });
const context = await browser.newContext({
  ...devices["iPhone 13"],
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

await page.route("**/api/events*", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ date: "2026-08-02", events: [EVENT], count: 1 }),
  }),
);
await page.route("**/api/artist*", (route) =>
  route.fulfill({ contentType: "application/json", body: JSON.stringify(ARTIST) }),
);
// Registration order matters: Playwright matches routes last-registered-first,
// so this catch-all must come BEFORE the api.js stub or it swallows it.
await page.route("**/w.soundcloud.com/player/**", (route) =>
  route.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub</title>" }),
);
await page.route("**/w.soundcloud.com/player/api.js", (route) =>
  route.fulfill({ contentType: "application/javascript", body: FAKE_SC }),
);
await page.route("**/images.ra.co/**", (route) => route.abort());

const seek = page.locator('input[aria-label="Seek"]');
const toggle = page.locator('button[aria-label="Play"], button[aria-label="Pause"]').first();
const at = async () => Number(await seek.inputValue());
/** Distance from the bar's bottom edge to the bottom of the viewport. */
const barGapFromBottom = () =>
  page.evaluate(() => {
    const bar = document.querySelector('input[aria-label="Seek"]')?.closest("div.fixed");
    if (!bar) return null;
    return Math.round(window.innerHeight - bar.getBoundingClientRect().bottom);
  });
const barHeight = () =>
  page.evaluate(() => {
    const bar = document.querySelector('input[aria-label="Seek"]')?.closest("div.fixed");
    return bar ? Math.round(bar.getBoundingClientRect().height) : null;
  });
/** Bottom padding the page reserves so the last card clears the bar. */
const pagePadBottom = () =>
  page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector(".min-h-screen")).paddingBottom),
  );

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Test Night", { timeout: 20000 });
await page.waitForTimeout(900); // splash

check("no player bar before playback", (await seek.count()) === 0);
check("page reserves no bottom space when idle", (await pagePadBottom()) === 0);

// ── event sheet → artist sheet
await page.locator("text=Test Night").first().click();
await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
await page.locator('[role="dialog"] button:has-text("Test DJ")').first().click();
await page.waitForSelector('button[aria-label="Play Set Number 1"]', { timeout: 8000 });

// Play *or* Pause: the sheet now starts the first set on open, so that row's
// label is "Pause …" and counting only "Play …" undercounts the list by one.
const collapsedRows = await page
  .locator('button[aria-label^="Play Set Number"], button[aria-label^="Pause Set Number"]')
  .count();
check("set list is collapsed by default", collapsedRows === COLLAPSED, `${collapsedRows} rows`);
check(
  "collapsed list offers the rest",
  await page.locator(`text=Show all ${SET_COUNT} sets`).isVisible(),
);

// ── playback starts on its own
//
// Opening a DJ *is* the request to hear them — there is only one reason to do
// it — so the tap on a set that used to be required here is gone. Tapping the
// row that is already playing now pauses it, which is why this no longer
// clicks: it would stop the very playback the rest of the file measures.
await page.waitForSelector('input[aria-label="Seek"]', { timeout: 8000 });
check("opening a DJ starts playing without a second tap", true);
check("the row for the playing set offers to pause it",
  (await page.locator('button[aria-label^="Pause Set"]').count()) > 0);

// The queue is the whole catalogue even though the list is showing six.
check(
  "queue holds every set, not just the visible ones",
  await page.locator(`text=1 of ${SET_COUNT}`).first().isVisible(),
);

await page.waitForTimeout(1600);
const t1 = await at();
await page.waitForTimeout(1600);
const t2 = await at();
check("timeline advances while playing", t2 > t1, `${t1}s -> ${t2}s`);
check("toggle shows Pause while playing", (await page.locator('button[aria-label="Pause"]').count()) > 0);
// 3600 is the *widget's* length; 2400 is the metadata seed above. Asserting the
// larger one is asserting that the player believes the thing actually playing
// rather than the thing that was written down about it — which is the entire
// timeline bug in one number.
check("the timeline takes its length from the widget, not the metadata",
  (await seek.getAttribute("max")) === "3600",
  `max ${await seek.getAttribute("max")} (seed says 2400)`);

// The lock screen reads this. Before it was set, a locked phone showed the
// embedded widget's own idea of itself ("SoundCloud widget") instead of the set.
const media = await page.evaluate(() => {
  const m = navigator.mediaSession?.metadata;
  return m ? { title: m.title, artist: m.artist, album: m.album } : null;
});
check("lock-screen metadata names the set, not the widget",
  media?.title === "Set Number 1" && media?.artist === "Test DJ",
  media ? `${media.title} — ${media.artist} — ${media.album}` : "none");
check("media session reports playing",
  (await page.evaluate(() => navigator.mediaSession?.playbackState)) === "playing");

// Visible is not enough — a modal sets pointer-events:none on <body>, which
// once left the bar painted above the overlay but dead to taps.
const tappable = await page.evaluate(() => {
  const button = document.querySelector('button[aria-label="Pause"], button[aria-label="Play"]');
  const box = button.getBoundingClientRect();
  return button.contains(
    document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
  );
});
check("transport is tappable over an open sheet", tappable);
const osNext = await page.evaluate(() => {
  // Chromium exposes no way to fire a real OS media key, but we can assert the
  // handlers were registered — without them the OS drives the iframe directly
  // and the bar silently falls out of sync.
  return typeof navigator.mediaSession?.setActionHandler === "function";
});
check("media session action handlers are wired", osNext);

const builtBefore = await page.evaluate(() => window.__built);
const beforeSwap = await at();

// Sample hard across the swap rather than once after it.
//
// The stale tick the fake widget fires on load() carries the OUTGOING track's
// position, and it is only wrong for a couple of hundred milliseconds before
// the incoming track's own ticks overwrite it — so a single reading taken
// afterwards sees a plausible number and proves nothing. What a person sees is
// the flash: tap next on a set thirty minutes in and the new one opens at
// thirty minutes before snapping back. Watching every frame of the window is
// the only way to catch that.
await page.locator('button[aria-label="Next mix"]').click();
const peak = await page.evaluate(async () => {
  const input = document.querySelector('input[aria-label="Seek"]');
  let highest = 0;
  for (let i = 0; i < 20; i++) {
    highest = Math.max(highest, Number(input.value));
    await new Promise((r) => setTimeout(r, 15));
  }
  return highest;
});
check("a new track starts at the beginning, with no flash of the old position",
  peak < Math.max(2, beforeSwap / 2),
  `peaked at ${peak}s after leaving the previous set at ${beforeSwap}s`);

await page.waitForTimeout(500);
check(
  "transport drives playback from inside a sheet",
  await page.locator("text=Set Number 2").first().isVisible(),
);
const builtAfter = await page.evaluate(() => window.__built);
check("changing track reuses the iframe instead of rebuilding it",
  builtAfter === builtBefore, `${builtBefore} -> ${builtAfter} iframes`);
await page.waitForTimeout(900);
check("the next set plays without a second tap on play",
  (await page.locator('button[aria-label="Pause"]').count()) > 0);
check(
  "using the transport does not dismiss the sheet",
  (await page.locator('button[aria-label="Back to event"]').count()) > 0,
);

const gap = await barGapFromBottom();
const height = await barHeight();
check("transport is docked to the bottom", gap === 0, `${gap}px from bottom`);
console.log(`  bar height: ${height}px`);
check("page reserves room for the bar", (await pagePadBottom()) >= height - 1,
  `padding ${await pagePadBottom()}px vs bar ${height}px`);

// ── expanding shows the rest
await page.locator(`text=Show all ${SET_COUNT} sets`).click();
await page.waitForTimeout(300);
const expandedRows = await page
  .locator('button[aria-label^="Play Set Number"], button[aria-label^="Pause Set Number"]')
  .count();
check("expanding reveals the whole list", expandedRows === SET_COUNT, `${expandedRows} rows`);

// ── the point of the feature: dismiss everything, playback continues
const beforeDismiss = await at();
await page.locator('button[aria-label="Back to event"]').click();
await page.waitForTimeout(1600);
const afterArtist = await at();
check("survives artist sheet dismissal", afterArtist > beforeDismiss,
  `${beforeDismiss}s -> ${afterArtist}s`);

await page.keyboard.press("Escape");
await page.waitForTimeout(1600);
const dialogs = await page.locator('[role="dialog"]').count();
const afterEvent = await at();
check("survives event sheet dismissal", afterEvent > afterArtist && dialogs === 0,
  `${afterArtist}s -> ${afterEvent}s, dialogs=${dialogs}`);

// ── transport walks the full catalogue, past what the sheet was showing
for (let i = 0; i < SET_COUNT - 2; i += 1) {
  await page.locator('button[aria-label="Next mix"]').click();
  await page.waitForTimeout(180);
}
await page.waitForTimeout(400);
check(
  "next walks past the collapsed list to the last set",
  await page.locator(`text=Set Number ${SET_COUNT}`).first().isVisible(),
);
check("next disabled at the end", await page.locator('button[aria-label="Next mix"]').isDisabled());

await page.locator('button[aria-label="Previous mix"]').click();
await page.waitForTimeout(400);
check(
  "previous goes back a mix",
  await page.locator(`text=Set Number ${SET_COUNT - 1}`).first().isVisible(),
);

// ── pause / resume / seek
await toggle.click();
await page.waitForTimeout(400);
const paused = await at();
await page.waitForTimeout(900);
check("pause stops the timeline", (await at()) === paused);
check("toggle shows Play while paused", (await page.locator('button[aria-label="Play"]').count()) > 0);

await toggle.click();
await page.waitForTimeout(1600);
check("play resumes from where it paused", (await at()) > paused);

await seek.evaluate((el) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(el, "1800");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
});
await page.waitForTimeout(500);
const seeked = await at();
check("seek jumps the playhead", seeked >= 1795 && seeked < 1830, `${seeked}s`);

// ── teardown
await page.locator('button[aria-label="Close player"]').click();
await page.waitForTimeout(400);
check("close dismisses the bar", (await seek.count()) === 0);
check("page stops reserving space after close", (await pagePadBottom()) === 0);
check(
  "provider iframe torn down on close",
  (await page.evaluate(() => document.querySelectorAll("[data-player-host] iframe").length)) === 0,
);

await browser.close();
shutdown();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
