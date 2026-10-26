/**
 * P3 probe: Media Session, error states, stop/close lifecycle.
 *
 * Investigation only. Not part of the suite. Writes nothing to src/ or api/.
 * Run:  E2E_PORT=5503 node tests/agent-p3-lifecycle.mjs 2>&1 | tail -120
 *
 * Phases
 *   1. Playback starts with the fake SoundCloud widget, ERROR is emitted
 *      mid-track, and the UI + mediaSession are sampled for 2 seconds. Then
 *      the same player is tapped to play again (does `error` clear?).
 *   2. Close (X) is tapped. Asserts mediaSession.metadata is null and
 *      --player-h is 0px, and records what happened to the handlers and the
 *      position state.
 *   3. api.js fails to load (creation error). Does the same set ever become
 *      retryable from the list?
 *   4. Pause tapped while a track swap is in flight. Does the pause survive?
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright-core";

const ROOT = "/home/user/ra-nyc";
const PORT = Number(process.env.E2E_PORT ?? 5503);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const log = (label, value) =>
  console.log(`      ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);

// ─── Browser discovery (copied from tests/player.e2e.mjs) ──────────────────

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
  throw new Error("No Chromium found. Set PLAYWRIGHT_CHROMIUM_PATH.");
}

// ─── Fixtures (copied from tests/player.e2e.mjs, one change: set 2 has no duration) ──

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

const SET_COUNT = 9;
const mkSet = (n) => ({
  provider: "soundcloud",
  id: `sc-${n}`,
  title: `Set Number ${n}`,
  url: `https://soundcloud.com/test/${n}`,
  embedUrl: `https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Ftest%2F${n}&auto_play=false`,
  duration: 2400,
  plays: 1000 * n,
  createdAt: null,
  artwork: null,
});
const sets = Array.from({ length: SET_COUNT }, (_, i) => mkSet(i + 1));
// Probe-only: a set whose resolver metadata has no duration, which SoundCloud
// adapter comments say is common. Used to check the lock-screen position state
// across a track change.
sets[1] = { ...sets[1], duration: null };

const ARTIST = {
  id: "99",
  name: "Test DJ",
  mixcloudUser: null,
  mixcloudUrl: null,
  soundcloudUser: "test",
  soundcloudUrl: "https://soundcloud.com/test",
  raUrl: null,
  bio: null,
  sets,
  links: [],
  linkSource: "auto",
  cached: false,
  persisted: false,
  soundcloud: "api-v2",
};

// Fake SoundCloud widget. Same surface as tests/player.e2e.mjs, plus:
//   window.__timers     running widget timers (0 = silent)
//   window.__failLast() halts the track and emits ERROR, like a track that
//                       cannot be played (audio stops, the widget reports it)
//   window.__loadDelay  ms before load()'s callback fires (models a slow swap)
const FAKE_SC = `
(function(){
  var Events={READY:'ready',PLAY:'play',PAUSE:'pause',FINISH:'finish',PLAY_PROGRESS:'playProgress',ERROR:'error'};
  window.__built = 0;
  window.__timers = 0;
  window.__loadDelay = 20;
  function Widget(iframe){
    var l={},pos=0,timer=null,duration=3600000,activated=false,parsed=false;
    window.__built++;
    function emit(e,p){(l[e]||[]).forEach(function(f){f(p);});}
    function tick(){ emit(Events.PLAY_PROGRESS,{currentPosition:pos,relativePosition:pos/duration}); }
    function halt(){ if(timer){clearInterval(timer);timer=null;window.__timers--;} }
    function run(){ if(timer) return; parsed=true; emit(Events.PLAY);
      timer=setInterval(function(){ pos+=250; tick();
        if(pos>=duration){halt();emit(Events.FINISH);} },250); window.__timers++; }
    var api = {
      bind:function(e,cb){(l[e]=l[e]||[]).push(cb); if(e===Events.READY) setTimeout(cb,40);},
      getDuration:function(cb){cb(parsed?duration:0);},
      load:function(url,opts){ var stale=pos; pos=0; activated=true; halt();
        setTimeout(function(){ emit(Events.PLAY_PROGRESS,{currentPosition:stale,relativePosition:stale/duration}); },5);
        if(opts&&opts.callback) setTimeout(opts.callback, window.__loadDelay); },
      play:function(){ if(!activated){ activated=true; run(); return; } run(); },
      pause:function(){ halt(); emit(Events.PAUSE); },
      seekTo:function(ms){ pos=ms; tick(); }
    };
    window.__failLast = function(){ halt(); emit(Events.ERROR); };
    return api;
  }
  Widget.Events=Events;
  window.SC={Widget:Widget};
})();
`;

// Records what the app sends to navigator.mediaSession, from before any app code runs.
const SPY = `
(() => {
  const ms = { posCalls: 0, posLast: "never", posNullCalls: 0, handlers: {} };
  window.__ms = ms;
  const p = MediaSession.prototype;
  const setPos = p.setPositionState;
  p.setPositionState = function (state) {
    ms.posCalls += 1;
    if (state === undefined || state === null) { ms.posNullCalls += 1; ms.posLast = "cleared"; }
    else ms.posLast = { position: Math.round(state.position), duration: state.duration };
    return setPos.apply(this, arguments);
  };
  const setH = p.setActionHandler;
  p.setActionHandler = function (action, fn) {
    ms.handlers[action] = fn ? "bound" : "cleared";
    return setH.apply(this, arguments);
  };
})();
`;

// ─── Dev server ─────────────────────────────────────────────────────────────

const server = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1"], {
  cwd: ROOT,
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
    if (attempt > 80) throw new Error("Dev server never came up");
    await sleep(250);
  }
}

// ─── Page helpers ───────────────────────────────────────────────────────────

const browser = await chromium.launch({ executablePath: findChromium() });

async function openPage() {
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("      PAGEERROR:", error.message));
  await page.addInitScript(SPY);
  const scState = { abortApi: false };

  await page.route("**/api/events*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ date: "2026-08-02", events: [EVENT], count: 1 }),
    }),
  );
  await page.route("**/api/artist*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(ARTIST) }),
  );
  // Last-registered wins in Playwright, so the api.js route must come after the catch-all.
  await page.route("**/w.soundcloud.com/player/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub</title>" }),
  );
  await page.route("**/w.soundcloud.com/player/api.js", (route) =>
    scState.abortApi
      ? route.abort()
      : route.fulfill({ contentType: "application/javascript", body: FAKE_SC }),
  );
  await page.route("**/images.ra.co/**", (route) => route.abort());

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Test Night", { timeout: 20000 });
  await page.waitForTimeout(900);
  return { context, page, scState };
}

async function openDj(page) {
  await page.locator("text=Test Night").first().click();
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  await page.locator('[role="dialog"] button:has-text("Test DJ")').first().click();
}

/** Everything the lock screen and the bar show, read from the DOM and the spy. */
const snapshot = (page) =>
  page.evaluate(() => {
    const seek = document.querySelector('input[aria-label="Seek"]');
    const bar = seek?.closest("div.fixed") ?? null;
    const subtitle = bar ? [...bar.querySelectorAll("p")][1] ?? null : null;
    const toggle = document.querySelector(
      'button[aria-label="Play"], button[aria-label="Pause"]',
    );
    const meta = navigator.mediaSession.metadata;
    return {
      title: bar?.querySelector("p")?.textContent ?? null,
      subtitle: subtitle?.textContent ?? null,
      errorStyled: subtitle?.classList.contains("text-destructive") ?? false,
      toggle: toggle?.getAttribute("aria-label") ?? null,
      spinner: Boolean(bar?.querySelector(".animate-spin")),
      seekValue: seek ? Number(seek.value) : null,
      seekMax: seek ? Number(seek.getAttribute("max")) : null,
      nextEnabled: bar ? !bar.querySelector('button[aria-label="Next mix"]')?.disabled : null,
      playbackState: navigator.mediaSession.playbackState,
      lockTitle: meta?.title ?? null,
      lockArtist: meta?.artist ?? null,
      posLast: window.__ms.posLast,
      hostIframes: document.querySelectorAll("[data-player-host] iframe").length,
      widgetTimers: window.__timers,
      playerH: document.documentElement.style.getPropertyValue("--player-h"),
    };
  });

const compact = (s) => ({
  title: s.title,
  subtitle: s.subtitle,
  err: s.errorStyled,
  toggle: s.toggle,
  seek: `${s.seekValue}/${s.seekMax}`,
  state: s.playbackState,
  lock: s.lockTitle,
  timers: s.widgetTimers,
});

// ═══ Phase 1: ERROR mid-track ═══════════════════════════════════════════════

console.log("\n== Phase 1: widget ERROR mid-track ==");
const first = await openPage();
const p1 = first.page;
await openDj(p1);
await p1.waitForSelector('input[aria-label="Seek"]', { timeout: 8000 });
await sleep(1500);

const beforeError = await snapshot(p1);
log("before ERROR", compact(beforeError));
log("spy posLast before ERROR", beforeError.posLast);

await p1.evaluate(() => window.__failLast());
const timeline = [];
for (let t = 0; t <= 2000; t += 250) {
  const s = await snapshot(p1);
  timeline.push({ t, ...compact(s) });
  await sleep(250);
}
console.log("      t(ms)  subtitle / styled / toggle / seek / state / lock / timers");
for (const row of timeline) {
  console.log(
    `      ${String(row.t).padStart(5)}  ${row.subtitle} | err=${row.err} | ${row.toggle} | ${row.seek} | ${row.state} | ${row.lock} | ${row.timers}`,
  );
}
const afterError = await snapshot(p1);

check(
  "ERROR shows a message in the subtitle, styled as an error",
  afterError.errorStyled && /couldn't play/.test(afterError.subtitle ?? ""),
  afterError.subtitle ?? "",
);
check(
  "ERROR does not advance the queue (still Set Number 1 after 2s)",
  afterError.title === "Set Number 1",
  `title="${afterError.title}", next enabled=${afterError.nextEnabled}`,
);
check(
  "ERROR stops the bar's toggle showing Pause and the session reports paused",
  afterError.toggle === "Play" && afterError.playbackState === "paused",
  `toggle=${afterError.toggle}, state=${afterError.playbackState}`,
);
check(
  "ERROR leaves the lock-screen title on the failed set (no auto-skip, no clear)",
  afterError.lockTitle === "Set Number 1",
  `lockTitle=${afterError.lockTitle}`,
);

// Recovery: tap play on the same, failed track.
await p1.locator('button[aria-label="Play"]').first().click();
await sleep(1200);
const afterReplay = await snapshot(p1);
log("after tapping Play on the failed track", compact(afterReplay));
check(
  "error text clears once the track is playing again",
  !afterReplay.errorStyled,
  `subtitle="${afterReplay.subtitle}", toggle=${afterReplay.toggle}, timers=${afterReplay.widgetTimers}`,
);

// ═══ Phase 2: Close (X) ═════════════════════════════════════════════════════

console.log("\n== Phase 2: Close (X) while playing ==");
// Let it play for a bit first, so there is a non-zero position to leave behind.
await sleep(800);
const beforeClose = await snapshot(p1);
log("before Close", { ...compact(beforeClose), posLast: beforeClose.posLast });

await p1.locator('button[aria-label="Close player"]').click();
await sleep(500);
const afterClose = await snapshot(p1);
const handlersAfterClose = await p1.evaluate(() => window.__ms.handlers);
const metaIsNull = await p1.evaluate(() => navigator.mediaSession.metadata === null);
log("after Close", { ...compact(afterClose), posLast: afterClose.posLast, playerH: afterClose.playerH });
log("handlers last set", handlersAfterClose);

check("Close: navigator.mediaSession.metadata is null", metaIsNull);
check(
  "Close: --player-h is 0px",
  afterClose.playerH === "0px",
  `"${afterClose.playerH}"`,
);
check("Close: the bar is gone", afterClose.title === null);
check(
  "Close: body-level iframe removed and widget timer stopped",
  afterClose.hostIframes === 0 && afterClose.widgetTimers === 0,
  `iframes=${afterClose.hostIframes}, timers=${afterClose.widgetTimers}`,
);
check(
  "Close: playbackState is paused, not left as playing",
  afterClose.playbackState === "paused",
  `state=${afterClose.playbackState}`,
);
check(
  "Close: OS action handlers are unbound (play/pause/next/prev/seekto/stop all cleared)",
  ["play", "pause", "nexttrack", "previoustrack", "seekto", "stop"].every(
    (a) => handlersAfterClose[a] === "cleared",
  ),
  JSON.stringify(handlersAfterClose),
);
check(
  "Close: position state is cleared (setPositionState called with no argument)",
  (await p1.evaluate(() => window.__ms.posNullCalls)) > 0,
  `posLast=${JSON.stringify(afterClose.posLast)}, nullCalls=${await p1.evaluate(() => window.__ms.posNullCalls)}`,
);

await first.context.close();

// ═══ Phase 3: the set fails to be created (api.js blocked) ═════════════════

console.log("\n== Phase 3: player cannot be created (api.js fails), then retry ==");
const third = await openPage();
const p3 = third.page;
third.scState.abortApi = true;
await openDj(p3);
await sleep(1500);
const failedCreate = await snapshot(p3);
log("after open with api.js blocked", compact(failedCreate));
check(
  "a failed player creation surfaces an error",
  failedCreate.errorStyled,
  failedCreate.subtitle ?? "",
);

third.scState.abortApi = false; // the network comes back
await p3.locator('button[aria-label="Play Set Number 1"]').first().click();
await sleep(1500);
const afterRowRetry = await snapshot(p3);
log("after tapping the same set's row", compact(afterRowRetry));
check(
  "the same set can be retried from its row once the network is back",
  !afterRowRetry.errorStyled && afterRowRetry.widgetTimers > 0,
  `error=${afterRowRetry.errorStyled}, timers=${afterRowRetry.widgetTimers}`,
);

await p3.locator('button[aria-label="Play"]').first().click().catch(() => undefined);
await sleep(800);
const afterToggleRetry = await snapshot(p3);
log("after tapping the bar's Play", compact(afterToggleRetry));
await third.context.close();

// ═══ Phase 4: Pause tapped while a track swap is loading ════════════════════

console.log("\n== Phase 4: Pause tapped while the next track is loading ==");
const fourth = await openPage();
const p4 = fourth.page;
await openDj(p4);
await p4.waitForSelector('input[aria-label="Seek"]', { timeout: 8000 });
await sleep(1200);
await p4.evaluate(() => {
  window.__loadDelay = 1500; // a slow swap, as on a phone on a weak network
});
await p4.locator('button[aria-label="Next mix"]').click();
await sleep(250);
const swapping = await snapshot(p4);
log("during the swap", { ...compact(swapping), posLast: swapping.posLast, spinner: swapping.spinner });
const staleLockPosition =
  swapping.posLast !== "cleared" && swapping.posLast?.duration === 3600;
check(
  "lock-screen position is not left at the previous set's during a swap",
  swapping.lockTitle === "Set Number 2" && !staleLockPosition,
  `lock title=${swapping.lockTitle}, posLast=${JSON.stringify(swapping.posLast)}, bar seek=${swapping.seekValue}`,
);

await p4.locator('button[aria-label="Pause"]').click();
await sleep(400);
const pausedDuringSwap = await snapshot(p4);
log("right after tapping Pause", compact(pausedDuringSwap));
await sleep(2500);
const afterSwap = await snapshot(p4);
log("2.5s later, after the swap completed", compact(afterSwap));
check(
  "a Pause tapped during the swap is respected (track stays paused)",
  afterSwap.toggle === "Play" && afterSwap.widgetTimers === 0,
  `toggle=${afterSwap.toggle}, state=${afterSwap.playbackState}, timers=${afterSwap.widgetTimers}`,
);

await fourth.context.close();
await browser.close();
shutdown();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
