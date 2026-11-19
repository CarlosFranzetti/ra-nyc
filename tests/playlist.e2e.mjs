/**
 * End-to-end checks for the playlist and the player's lifecycle.
 *
 * Run with:  npm run test:playlist
 *
 * Promoted from the bug hunt's probes (tests/agent-p*, agent-l*), which found
 * the defects this file now holds shut. Every check is written so that PASS
 * means healthy: a failure names a behaviour the player must keep, not a bug
 * somebody once saw.
 *
 * Boots its own dev server, stubs `/api/*`, the SoundCloud widget and the
 * Mixcloud widget, and drives a mobile-emulated Chromium — see player.e2e.mjs
 * for why the providers are stubbed. The fake SoundCloud widget has knobs
 * (`window.__cfg`) so a scenario can make a track short, make the first play
 * fail, or delay `load()`'s callback; each scenario gets a fresh browser
 * context because the query cache persists to localStorage.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), ".cache", "ms-playwright"),
    join(homedir(), "Library", "Caches", "ms-playwright"),
  ].filter(Boolean);
  const binaries = [
    ["chrome-linux", "chrome"],
    // Newer Playwright builds unpack to `chrome-linux64`; the cloud container
    // moved to one and every suite stopped finding its browser.
    ["chrome-linux64", "chrome"],
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

/** Artist ids are single digits; the name is `DJ<id>` and so are the sets' titles. */
const mkSet = (id, n) => ({
  provider: "soundcloud",
  id: `sc-${id}-${n}`,
  title: `DJ${id} Set ${n}`,
  url: `https://soundcloud.com/dj${id}/${n}`,
  embedUrl: `https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fdj${id}%2F${n}`,
  duration: 2400,
  plays: 1,
  createdAt: null,
  artwork: null,
});
const setsOf = (id, count) => Array.from({ length: count }, (_, i) => mkSet(id, i + 1));

const artistPayload = (id, sets) => ({
  id,
  name: `DJ${id}`,
  mixcloudUser: null,
  mixcloudUrl: null,
  soundcloudUser: "t",
  soundcloudUrl: "https://soundcloud.com/t",
  raUrl: null,
  bio: null,
  sets,
  links: [],
  linkSource: "auto",
  cached: false,
  persisted: false,
});

const mkEvent = (id, title, artistIds) => ({
  id,
  title,
  date: "2026-08-02T00:00:00.000",
  startTime: "2026-08-02T22:00:00.000",
  endTime: "2026-08-03T04:00:00.000",
  url: `https://ra.co/events/${id}`,
  imageUrl: "https://images.ra.co/x.jpg",
  venue: { name: "Nowadays", area: "New York" },
  artists: artistIds.map((n) => ({ id: String(n), name: `DJ${n}` })),
  attending: 100,
  isPick: false,
  pickBlurb: null,
});

/**
 * The widget, with knobs. Positions advance 250ms a tick; `load()` swaps the
 * track after `loadDelay`; the outgoing track's stale progress arrives 5ms after
 * `load()` the way the real one's does. `duration` is read at every tick, so a
 * scenario can shorten the track mid-flight.
 */
const FAKE_SC = `
(function(){
  var Events={READY:'ready',PLAY:'play',PAUSE:'pause',FINISH:'finish',PLAY_PROGRESS:'playProgress',ERROR:'error'};
  var cfg = window.__cfg = window.__cfg || {};
  window.__built = 0; window.__log = []; window.__seekLog = [];
  function Widget(iframe){
    var l={},pos=0,timer=null,activated=false,parsed=false,plays=0;
    function dur(){ return cfg.duration||3600000; }
    window.__built++;
    function emit(e,p){(l[e]||[]).forEach(function(f){f(p);});}
    function tick(){ emit(Events.PLAY_PROGRESS,{currentPosition:pos,relativePosition:pos/dur()}); }
    function run(){ if(timer) return;
      plays++;
      if(cfg.errorOnFirstPlay && plays===1){ window.__log.push('ERROR'); emit(Events.ERROR); return; }
      parsed=true; emit(Events.PLAY);
      timer=setInterval(function(){ pos+=250; tick();
        if(pos>=dur()){clearInterval(timer);timer=null;
          // A widget that reaches the end and never says so.
          if(cfg.noFinish) return;
          pos=0;window.__log.push('FINISH');emit(Events.FINISH);} },250); }
    return {
      bind:function(e,cb){(l[e]=l[e]||[]).push(cb); if(e===Events.READY) setTimeout(cb,40);},
      getDuration:function(cb){cb(parsed?dur():0);},
      load:function(url,opts){ window.__log.push('load '+url); var stale=pos; pos=0; activated=true;
        if(timer){clearInterval(timer);timer=null;}
        // A swap that never calls back, and one that fails outright.
        if(cfg.neverCallback && url.indexOf(cfg.neverCallback)>-1) return;
        if(cfg.errorOnLoad && url.indexOf(cfg.errorOnLoad)>-1){ setTimeout(function(){emit(Events.ERROR);},30); return; }
        setTimeout(function(){ emit(Events.PLAY_PROGRESS,{currentPosition:stale,relativePosition:stale/dur()}); },5);
        if(opts&&opts.callback) setTimeout(opts.callback,cfg.loadDelay||20); },
      play:function(){ window.__log.push('play'); run(); },
      pause:function(){ window.__log.push('pause'); if(timer){clearInterval(timer);timer=null;} emit(Events.PAUSE); },
      seekTo:function(ms){ var old=pos; window.__seekLog.push(ms); pos=ms; tick();
        // A progress tick sent from the old position, landing after the seek.
        if(cfg.staleOnSeek) setTimeout(function(){ emit(Events.PLAY_PROGRESS,{currentPosition:old,relativePosition:old/dur()}); },100); }
    };
  }
  Widget.Events=Events;
  window.SC={Widget:Widget};
})();
`;

/** Mixcloud's ready promise settles after 800ms, or 3000 for a "slow" embed. */
const FAKE_MC = `
(function(){
  window.__mcBuilt = 0;
  window.Mixcloud = { PlayerWidget: function(iframe){
    window.__mcBuilt++;
    var slow = /slow/.test(iframe.src);
    var mk=function(){return {on:function(){}};};
    var never = /never/.test(iframe.src);
    return { ready: new Promise(function(r){ if(!never) setTimeout(r,slow?3000:800); }),
      play:function(){return Promise.resolve();}, pause:function(){return Promise.resolve();},
      seek:function(){return Promise.resolve(true);}, getDuration:function(){return Promise.resolve(slow?2222:1111);},
      events:{play:mk(),pause:mk(),ended:mk(),error:mk(),progress:mk()} };
  }};
})();
`;

/** Records what the app tells the lock screen, from before any app code runs. */
const SPY = `
(() => {
  const ms = { posNullCalls: 0 };
  window.__ms = ms;
  if (typeof MediaSession === "undefined") return;
  const setPos = MediaSession.prototype.setPositionState;
  MediaSession.prototype.setPositionState = function (state) {
    if (state === undefined || state === null) ms.posNullCalls += 1;
    return setPos.apply(this, arguments);
  };
})();
`;

/** Every rAF frame, so a transient that lasted one commit can still be seen. */
const RECORDER = `
(function(){
  window.__frames = [];
  function state(){
    var input = document.querySelector('input[aria-label="Seek"]');
    if (!input) return null;
    var bar = input.closest('div.fixed');
    var t = bar && bar.querySelector('p.truncate');
    return { title: t ? t.textContent : null, value: input.value, max: input.max };
  }
  (function frame(){ var s = state(); if (s) window.__frames.push(s); requestAnimationFrame(frame); })();
})();
`;

// ─── Infrastructure ─────────────────────────────────────────────────────────

const server = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1", "--strictPort"], {
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
for (let i = 0; ; i += 1) {
  try {
    await fetch(BASE);
    break;
  } catch {
    if (i > 120) throw new Error("Dev server never came up");
    await sleep(250);
  }
}
const browser = await chromium.launch({ executablePath: findChromium() });

/**
 * opts: events[], artists { id: { count, delay, sets } }, cfg, scApi, clock,
 *       init[] (extra init scripts)
 */
async function boot(opts) {
  const context = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true, isMobile: true });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("  PAGEERROR:", e.message));
  await page.addInitScript((cfg) => {
    window.__cfg = cfg;
  }, opts.cfg ?? {});
  for (const script of [SPY, ...(opts.init ?? [])]) await page.addInitScript(script);
  const seen = {};
  page.apiHits = { script: 0 };
  await page.route("**/api/events*", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ date: "2026-08-02", events: opts.events, count: opts.events.length }),
    }),
  );
  await page.route("**/api/artist*", async (r) => {
    const id = new URL(r.request().url()).searchParams.get("id");
    const spec = opts.artists[id] ?? { count: 2 };
    seen[id] = (seen[id] ?? 0) + 1;
    if (spec.delay && seen[id] === 1) await sleep(spec.delay);
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify(artistPayload(id, spec.sets ?? setsOf(id, spec.count ?? 2))),
    });
  });
  await page.route("**/w.soundcloud.com/player/**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub</title>" }),
  );
  await page.route("**/w.soundcloud.com/player/api.js", (r) => {
    page.apiHits.script += 1;
    return (
      opts.scApi?.(r, page.apiHits.script) ??
      r.fulfill({ contentType: "application/javascript", body: FAKE_SC })
    );
  });
  await page.route("**/widget.mixcloud.com/**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub</title>" }),
  );
  await page.route("**/widget.mixcloud.com/media/js/widgetApi.js", (r) =>
    r.fulfill({ contentType: "application/javascript", body: FAKE_MC }),
  );
  await page.route("**/images.ra.co/**", (r) => r.abort());
  if (opts.clock) await page.clock.install();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`text=${opts.events[0].title}`, { timeout: 20000 });
  await sleep(700);
  await openEvent(page, opts.events[0].title);
  return { context, page };
}

const PREVIEW = 'button:has-text("Preview the night"), button:has-text("Finding sets")';
const plus = (name) => `button[aria-label="Add ${name} to the playlist"]`;
const NIGHT = 'button[aria-label="Add the whole lineup to the playlist"]';
const SEEK = 'input[aria-label="Seek"]';

async function openEvent(page, title) {
  await page.getByText(title, { exact: true }).first().click();
  await page.waitForSelector(PREVIEW, { timeout: 8000 });
  await sleep(300);
}
const closeSheet = async (page) => {
  await page.keyboard.press("Escape");
  await sleep(700);
};
const openArtist = (page, name) => page.locator(`[role="dialog"] button:has-text("${name}")`).first().click();
const backToEvent = async (page) => {
  await page.locator('button[aria-label="Back to event"]').click();
  await sleep(700);
};

/** The transport as a user sees it. */
const bar = (page) =>
  page.evaluate(() => {
    const seek = document.querySelector('input[aria-label="Seek"]');
    const root = seek?.closest("div.fixed");
    return {
      present: !!seek,
      max: seek?.max ?? null,
      value: seek?.value ?? null,
      disabled: seek?.disabled ?? null,
      title: root?.querySelector("p")?.textContent ?? null,
      subtitle: root?.querySelectorAll("p")[1]?.textContent ?? null,
      spinner: !!root?.querySelector(".animate-spin"),
      playBtn:
        document.querySelector('button[aria-label="Play"], button[aria-label="Pause"]')?.getAttribute("aria-label") ?? null,
      tickets: !!document.querySelector('a[aria-label^="Tickets for"]'),
      bubble: root?.querySelector("span.bg-secondary")?.textContent ?? null,
      iframes: document.querySelectorAll("[data-player-host] iframe").length,
    };
  });

/** Polls until `pred(bar)` holds; returns the last reading either way. */
async function until(page, pred, ms = 8000) {
  const end = Date.now() + ms;
  let b = await bar(page);
  while (Date.now() < end) {
    if (pred(b)) return b;
    await sleep(150);
    b = await bar(page);
  }
  return b;
}
const waitBar = (page) => page.waitForSelector(SEEK, { timeout: 10000 });

const logOf = (page) => page.evaluate(() => window.__log);
const loads = (log) => log.filter((e) => e.startsWith("load ")).length;
const metaArtist = (page) => page.evaluate(() => navigator.mediaSession?.metadata?.artist ?? null);

/** Opens the playlist panel if it is closed and returns its rows. */
async function panel(page) {
  if ((await page.locator('ul[aria-label="Playlist"]').count()) === 0) {
    await page.locator('button[aria-label^="Show playlist"]').click();
    await sleep(350);
  }
  return page.evaluate(() =>
    [...document.querySelectorAll('ul[aria-label="Playlist"] li')].map((li) => ({
      title: li.querySelector("span.block")?.textContent ?? "?",
      live: !!li.querySelector('[aria-current="true"]'),
    })),
  );
}

// ═══ 1. A late resolution must not restart or replace the player ═══════════

{
  console.log("\n== late resolutions ==");

  // Close, then a DJ who resolves late: the preview must not bring the bar back.
  const { context, page } = await boot({
    events: [mkEvent("1", "Night One", [1, 2, 3])],
    artists: { 1: {}, 2: { delay: 2500 }, 3: { delay: 3500 } },
  });
  await page.locator(PREVIEW).first().click();
  await waitBar(page);
  await sleep(500);
  await page.locator('button[aria-label="Close player"]').click();
  await sleep(300);
  await sleep(4500);
  check("after Close, a late preview DJ does not reopen the bar", !(await bar(page)).present);
  await context.close();
}

{
  // A `+` that resolves after Close must not start music either.
  const { context, page } = await boot({
    events: [mkEvent("1", "Night One", [1, 2])],
    artists: { 1: {}, 2: { delay: 2500 } },
  });
  await page.locator(PREVIEW).first().click();
  await waitBar(page);
  await page.locator(plus("DJ2")).click();
  await sleep(200);
  await page.locator('button[aria-label="Close player"]').click();
  await sleep(4000);
  check("after Close, a late + does not restart the player", !(await bar(page)).present);
  await context.close();
}

{
  // A slow `+`, then Preview: the added set is appended, not a replacement.
  const { context, page } = await boot({
    events: [mkEvent("1", "Night One", [1, 2])],
    artists: { 2: { delay: 2500 } },
  });
  await page.locator(plus("DJ2")).click();
  await sleep(100);
  await page.locator(PREVIEW).first().click();
  await waitBar(page);
  await sleep(4000);
  const b = await bar(page);
  check("slow + then Preview: the first set keeps playing", b.title === "DJ1 Set 1" || b.title?.startsWith("DJ1 "), b.title);
  check("and the added set joins behind it rather than replacing", /of 2/.test(b.subtitle ?? ""), b.subtitle);
  await context.close();
}

{
  // A slow `+`, then opening another DJ: the add lands behind, not over.
  const { context, page } = await boot({
    events: [mkEvent("1", "Night One", [1, 2])],
    artists: { 1: { count: 2 }, 2: { delay: 2500 } },
  });
  await page.locator(plus("DJ2")).click();
  await sleep(100);
  await openArtist(page, "DJ1");
  await waitBar(page);
  await sleep(4000);
  const b = await bar(page);
  check("slow + then opening another DJ: that DJ keeps playing", b.title === "DJ1 Set 1", b.title);
  check("and the late add is queued behind DJ1's two sets", /1 of 3/.test(b.subtitle ?? ""), b.subtitle);
  await context.close();
}

// ═══ 2. Duplicates ═════════════════════════════════════════════════════════

{
  console.log("\n== duplicates ==");
  const Z = mkSet(7, 1);
  const W = mkSet(8, 1);
  {
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1, 2])],
      artists: { 1: { sets: [Z] }, 2: { sets: [Z] } },
    });
    await page.locator(NIGHT).click();
    await waitBar(page);
    await sleep(600);
    const b = await bar(page);
    check("a b2b resolved from both DJs is queued once on an empty queue", !/ of /.test(b.subtitle ?? ""), b.subtitle);
    check("and there is nothing to skip to", (await page.locator('button[aria-label="Next mix"]').isDisabled()) === true);
    await context.close();
  }
  {
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1, 2, 3, 4])],
      artists: { 1: { sets: [Z] }, 2: { sets: [Z] }, 3: { sets: [W] }, 4: { count: 3 } },
    });
    await page.locator(plus("DJ4")).click();
    await waitBar(page);
    await sleep(500);
    await page.locator(NIGHT).click();
    await sleep(1500);
    const b = await bar(page);
    check("the same on a non-empty queue: DJ4 (already in), Z once, W once", /1 of 3/.test(b.subtitle ?? ""), b.subtitle);
    await context.close();
  }

  // The reload rule: a different entry holding the same set must load again.
  {
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      artists: { 1: { count: 3 } },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    await until(page, (s) => s.playBtn === "Pause");
    await page.locator('button[aria-label="Next mix"]').click(); // now on Set 2
    await sleep(500);
    // Play Set 1 while a queue exists: it goes in after Set 2 and becomes live,
    // leaving [S1, S2, S1, S3] — an earlier copy is kept on purpose.
    await page.locator('button[aria-label="Play DJ1 Set 1"]').click();
    await sleep(500);
    let rows = await panel(page);
    check("play keeps the earlier copy: [1, 2, 1, 3], live on the second Set 1", rows.map((r) => r.title).join("|") === "DJ1 Set 1|DJ1 Set 2|DJ1 Set 1|DJ1 Set 3" && rows[2]?.live, JSON.stringify(rows));

    const built = await page.evaluate(() => window.__built);
    const before = loads(await logOf(page));
    await sleep(1200);
    const posBefore = Number((await bar(page)).value);
    // Take Set 2 out — a row ABOVE the live one. The live set must not restart.
    await page.locator('button[aria-label="Remove DJ1 Set 2 from the playlist"]').click();
    await sleep(900);
    const after = await bar(page);
    check("removing a row above the live one does not reload it", loads(await logOf(page)) === before && (await page.evaluate(() => window.__built)) === built);
    check("and its position carries on rather than restarting", Number(after.value) >= posBefore, `${posBefore} -> ${after.value}`);

    // Now [S1, S1, S3] with live index 1. Previous lands on the twin.
    await page.locator('button[aria-label="Previous mix"]').click();
    await sleep(700);
    check("moving onto a same-set neighbour loads it again (Previous)", loads(await logOf(page)) === before + 1);
    const b1 = await bar(page);
    await sleep(1000);
    const b2 = await bar(page);
    check("and the timeline is moving", Number(b2.value) > Number(b1.value) && b2.playBtn === "Pause", `${b1.value} -> ${b2.value}`);

    // Finishing a set into its twin must not freeze on Pause.
    await page.evaluate(() => {
      window.__cfg.duration = 2500;
    });
    await sleep(7000);
    const chain = (await logOf(page)).filter((e) => e === "FINISH" || e.startsWith("load ")).join(",");
    check(
      "a set that finishes into its twin plays the twin, then the next set",
      /FINISH,load [^,]*dj1\/1,FINISH,load [^,]*dj1\/3/.test(chain),
      chain.slice(-160),
    );
    await context.close();
  }
}

// ═══ 3. Play keeps the playlist ════════════════════════════════════════════

{
  console.log("\n== opening a DJ keeps the playlist ==");
  const { context, page } = await boot({
    events: [mkEvent("1", "Night One", [1, 2, 3])],
    artists: { 1: { count: 2 }, 2: { count: 5 }, 3: { count: 2 } },
  });
  await page.locator(plus("DJ1")).click();
  await waitBar(page);
  await sleep(500);
  await page.locator(plus("DJ3")).click();
  await page.waitForSelector('button[aria-label^="Show playlist"]', { timeout: 8000 });
  await openArtist(page, "DJ2");
  await until(page, (s) => /2 of 3/.test(s.subtitle ?? ""));
  const rows = await panel(page);
  check(
    "opening DJ2 slots their first set after the live one and keeps both neighbours",
    rows.length === 3 && rows[0].title.startsWith("DJ1") && rows[1].title === "DJ2 Set 1" && rows[1].live && rows[2].title.startsWith("DJ3"),
    JSON.stringify(rows),
  );

  // Re-opening the DJ already playing does nothing — not even un-pause.
  await page.locator('button[aria-label="Pause"]').click();
  await sleep(400);
  const paused = await bar(page);
  await backToEvent(page);
  await openArtist(page, "DJ2");
  await sleep(1500);
  const again = await bar(page);
  check(
    "re-opening the DJ already playing changes nothing: same entry, still paused, same position",
    /2 of 3/.test(again.subtitle ?? "") && again.playBtn === "Play" && again.value === paused.value,
    `${again.subtitle} ${again.playBtn} ${paused.value}->${again.value}`,
  );
  await context.close();
}

{
  // Preview with a playlist: the user's queue survives and the taster is contiguous.
  const { context, page } = await boot({
    events: [mkEvent("1", "Night One", [1, 2, 3])],
    artists: { 1: {}, 2: { delay: 600 }, 3: { count: 5 } },
  });
  await openArtist(page, "DJ3");
  await waitBar(page);
  await until(page, (s) => s.playBtn === "Pause");
  await backToEvent(page);
  await page.locator(PREVIEW).first().click();
  await sleep(3000);
  const rows = await panel(page);
  const live = rows.findIndex((r) => r.live);
  const first = rows.findIndex((r) => r.title.startsWith("DJ1"));
  check("Preview over a playlist keeps all five of the user's sets", rows.filter((r) => r.title.startsWith("DJ3")).length === 5, JSON.stringify(rows.map((r) => r.title)));
  // Whichever DJ resolved first is what plays now; the rest go in directly behind
  // it, so the taster is one block rather than scattered through the user's list.
  check(
    "and the taster is one block in lineup order, playing now",
    first !== -1 && rows[first + 1]?.title.startsWith("DJ2") && (live === first || live === first - 1),
    JSON.stringify(rows.map((r) => (r.live ? `*${r.title}` : r.title))),
  );
  await context.close();
}

{
  // The previous night's late DJ must not leak into the next night.
  const { context, page } = await boot({
    events: [mkEvent("1", "Night One", [1, 2]), mkEvent("2", "Night Two", [3])],
    artists: { 1: {}, 2: { delay: 2500 }, 3: {} },
  });
  await page.locator(PREVIEW).first().click();
  await waitBar(page);
  await sleep(300);
  await closeSheet(page);
  await openEvent(page, "Night Two");
  await page.locator(PREVIEW).first().click();
  await sleep(4500);
  const rows = await panel(page);
  check("night one's late DJ does not appear in night two's queue", !rows.some((r) => r.title.startsWith("DJ2")), JSON.stringify(rows.map((r) => r.title)));
  check("and night two's own DJ does", rows.some((r) => r.title.startsWith("DJ3")));
  await context.close();
}

// ═══ 4. Every entry carries its own DJ and party ═══════════════════════════

{
  console.log("\n== names and sources follow the entry ==");
  const { context, page } = await boot({
    events: [mkEvent("1", "Night One", [1, 2]), mkEvent("2", "Night Two", [3])],
    artists: {},
  });
  await page.locator(NIGHT).click();
  await waitBar(page);
  await sleep(800);
  const first = await bar(page);
  check("the first set names its own DJ and party", /^DJ1 · at Night One · 1 of 2$/.test(first.subtitle ?? ""), first.subtitle);
  await page.locator('button[aria-label="Next mix"]').click();
  await sleep(500);
  const second = await bar(page);
  check("the second names ITS DJ, not the one who started the queue", /^DJ2 · at Night One · 2 of 2$/.test(second.subtitle ?? ""), second.subtitle);
  check("and so does the lock screen", (await metaArtist(page)) === "DJ2", String(await metaArtist(page)));

  await closeSheet(page);
  await openEvent(page, "Night Two");
  await page.locator(plus("DJ3")).click();
  await sleep(1200);
  await page.locator('button[aria-label="Next mix"]').click();
  await sleep(500);
  const third = await bar(page);
  check("a set added from another night is labelled with that night", /^DJ3 · at Night Two · 3 of 3$/.test(third.subtitle ?? ""), third.subtitle);
  await context.close();
}

// ═══ 5. Failures and recovery ══════════════════════════════════════════════

{
  console.log("\n== failure and recovery ==");
  {
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      artists: { 1: { count: 2 } },
      scApi: (r, n) => (n === 1 ? r.abort() : undefined),
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    const failed = await until(page, (s) => /Couldn't load the player/.test(s.subtitle ?? ""));
    check("a player that cannot be built says so in plain words", /Couldn't load the player/.test(failed.subtitle ?? ""), failed.subtitle);
    check("without printing the script URL", !/https?:|\.js/.test(failed.subtitle ?? ""), failed.subtitle);
    await page.locator('button[aria-label="Play"]').first().click();
    const ok = await until(page, (s) => s.playBtn === "Pause" && !s.spinner);
    check("Play on the bar retries the build and the set plays", ok.playBtn === "Pause" && !/Couldn't/.test(ok.subtitle ?? ""), `${ok.playBtn} ${ok.subtitle}`);
    check("with one extra request for the SDK, not a loop", page.apiHits.script === 2, `${page.apiHits.script} api.js requests`);
    await context.close();
  }
  {
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      cfg: { errorOnFirstPlay: true },
      artists: { 1: { count: 2 } },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    await until(page, (s) => /couldn't play/.test(s.subtitle ?? ""), 4000);
    const healed = await until(page, (s) => s.playBtn === "Pause" && !/couldn't play/.test(s.subtitle ?? ""), 6000);
    check("once playback resumes the error text goes away", healed.playBtn === "Pause" && !/couldn't play/.test(healed.subtitle ?? ""), healed.subtitle);
    await context.close();
  }
  {
    // Pause tapped while the next track is still loading must stick.
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      cfg: { loadDelay: 800 },
      artists: { 1: { count: 2 } },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    await until(page, (s) => s.playBtn === "Pause");
    await sleep(600);
    await page.locator('button[aria-label="Next mix"]').click();
    await sleep(150);
    await page.locator('button[aria-label="Pause"], button[aria-label="Play"]').first().click();
    await sleep(2000);
    const b1 = await bar(page);
    await sleep(1500);
    const b2 = await bar(page);
    check("Pause during a track swap is not undone", b1.value === b2.value && b2.playBtn === "Play", `${b1.value} -> ${b2.value} ${b2.playBtn}`);
    await context.close();
  }
  {
    // A superseded Mixcloud build must not touch the bar or leave an iframe.
    const mc = (n, slow) => ({
      provider: "mixcloud",
      id: `mc-${n}`,
      title: `M${n}${slow ? " slow" : ""}`,
      url: `https://www.mixcloud.com/a/${n}/`,
      embedUrl: `https://www.mixcloud.com/widget/iframe/?feed=%2Fa%2F${n}%2F${slow ? "&slow=1" : ""}`,
      duration: 999,
      plays: 1,
      createdAt: null,
      artwork: null,
    });
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      artists: { 1: { sets: [mc(1, false), mc(2, true)] } },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    await sleep(150);
    await page.locator('button[aria-label="Next mix"]').click();
    await sleep(1400); // past M1's 800ms ready, well short of M2's 3000
    const mid = await bar(page);
    check("while M2 loads the spinner stays and M1's length is not shown", mid.spinner && mid.max !== "1111", `spinner=${mid.spinner} max=${mid.max}`);
    await sleep(3200);
    const done = await bar(page);
    check("when M2 is ready exactly one iframe is left in the host", done.iframes === 1 && !done.spinner, `iframes=${done.iframes}`);
    await context.close();
  }
}

// ═══ 6. Lock screen ════════════════════════════════════════════════════════

{
  console.log("\n== lock screen ==");
  const { context, page } = await boot({
    events: [mkEvent("1", "Night One", [1])],
    artists: { 1: { count: 2 } },
  });
  await openArtist(page, "DJ1");
  await waitBar(page);
  await until(page, (s) => s.playBtn === "Pause");
  await page.locator('button[aria-label="Close player"]').click();
  await sleep(500);
  check("Close clears the lock screen's position", (await page.evaluate(() => window.__ms.posNullCalls)) >= 1);
  await context.close();
}

// ═══ 7. The bar: paint, scrubbing ══════════════════════════════════════════

{
  console.log("\n== the bar ==");
  const { context, page } = await boot({
    events: [mkEvent("1", "Night One", [1])],
    init: [RECORDER],
    artists: { 1: { count: 3 } },
  });
  await openArtist(page, "DJ1");
  await waitBar(page);
  await until(page, (s) => s.playBtn === "Pause");
  await sleep(2200); // far enough in that a stale position would be obvious
  await page.evaluate(() => {
    window.__frames.length = 0;
  });
  await page.locator('button[aria-label="Next mix"]').click();
  await sleep(700);
  // The first frame only: the widget reports its real length within the next one.
  const frames = await page.evaluate(() => window.__frames.filter((f) => f.title === "DJ1 Set 2").slice(0, 1));
  check(
    "the first frame showing a new title has the new position and length",
    frames.length > 0 && frames.every((f) => Number(f.value) <= 1 && f.max === "2400"),
    JSON.stringify(frames),
  );
  await context.close();
}

{
  // A drag held across the end of a track must not be committed to the next one.
  const { context, page } = await boot({
    events: [mkEvent("1", "Night One", [1])],
    cfg: { duration: 4000 },
    artists: { 1: { count: 3 } },
  });
  await openArtist(page, "DJ1");
  await waitBar(page);
  await until(page, (s) => s.playBtn === "Pause" && !s.spinner);
  await sleep(400);
  const box = await page.locator(SEEK).boundingBox();
  await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(4000); // the first set finishes under the held finger
  const seeksBefore = await page.evaluate(() => window.__seekLog.length);
  await page.mouse.up();
  await sleep(1000);
  const end = await bar(page);
  check(
    "a drag held through the end of a set does not seek the next one",
    (await page.evaluate(() => window.__seekLog.length)) === seeksBefore && /2 of 3/.test(end.subtitle ?? ""),
    `${end.subtitle}`,
  );
  await context.close();
}

{
  // A keyup that lands on another element must not leave the scrubber stuck.
  const { context, page } = await boot({
    events: [mkEvent("1", "Night One", [1])],
    artists: { 1: { count: 3 } },
  });
  await openArtist(page, "DJ1");
  await waitBar(page);
  await until(page, (s) => s.playBtn === "Pause" && !s.spinner);
  await sleep(300);
  await page.focus(SEEK);
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  await sleep(80);
  const held = await bar(page);
  await page.evaluate(() => document.querySelector('button[aria-label="Next mix"]').focus());
  await page.keyboard.up("ArrowRight");
  await sleep(500);
  const released = await bar(page);
  check("the drag bubble appears while a key is held", held.bubble !== null, String(held.bubble));
  check("and goes when the key is released somewhere else", released.bubble === null, String(released.bubble));
  await context.close();
}

// ═══ 8. The playlist panel ═════════════════════════════════════════════════

{
  console.log("\n== the playlist panel ==");
  const { context, page } = await boot({
    events: [mkEvent("1", "Night One", [1])],
    artists: { 1: { count: 12 } },
  });
  await openArtist(page, "DJ1");
  await waitBar(page);
  await until(page, (s) => s.playBtn === "Pause");
  await backToEvent(page);
  // Out of the event sheet: an open modal traps keyboard focus inside itself, so
  // focus could not reach the bar at all.
  await closeSheet(page);

  const label = await page.locator('button[aria-label^="Show playlist"]').getAttribute("aria-label");
  check("the list button's name carries the count", /12/.test(label ?? ""), label ?? "");

  await panel(page);
  // Row identity: mark every <li>, remove one, count the survivors.
  await page.evaluate(() => {
    document.querySelectorAll('ul[aria-label="Playlist"] li').forEach((li, i) => {
      li.__mark = i;
    });
  });
  const removeButton = page.locator('button[aria-label="Remove DJ1 Set 4 from the playlist"]');
  await removeButton.focus();
  await page.keyboard.press("Enter");
  await sleep(400);
  const survivors = await page.evaluate(() =>
    [...document.querySelectorAll('ul[aria-label="Playlist"] li')].filter((li) => li.__mark !== undefined).length,
  );
  check("removing one row remounts none of the others", survivors === 11, `${survivors} of 11 kept`);
  const active = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName);
  check("and keyboard focus stays in the list", /^Remove /.test(active ?? ""), String(active));

  // The live row, last in a long list, must be in view when the panel opens.
  await page.locator('ul[aria-label="Playlist"] li').last().locator("button").first().click();
  await sleep(500);
  await page.locator('button[aria-label^="Hide playlist"]').click();
  await sleep(300);
  await page.locator('button[aria-label^="Show playlist"]').click();
  await sleep(500);
  const visible = await page.evaluate(() => {
    const ul = document.querySelector('ul[aria-label="Playlist"]');
    const live = ul?.querySelector('[aria-current="true"]');
    const box = ul?.parentElement?.getBoundingClientRect();
    const row = live?.getBoundingClientRect();
    return !!(box && row && row.top >= box.top - 1 && row.bottom <= box.bottom + 1);
  });
  check("the live row is fully inside the panel when it opens", visible);

  // A new session starts with the panel closed.
  await page.locator('button[aria-label="Close player"]').click();
  await sleep(500);
  await openEvent(page, "Night One");
  await openArtist(page, "DJ1");
  await waitBar(page);
  await sleep(800);
  check("the panel does not reopen by itself on the next session", (await page.locator('ul[aria-label="Playlist"]').count()) === 0);
  await context.close();
}

// ═══ 9. Tickets and listening time ═════════════════════════════════════════

{
  console.log("\n== tickets ==");
  const { context, page } = await boot({
    events: [mkEvent("1", "Night One", [1])],
    clock: true,
    artists: { 1: { count: 2 } },
  });
  await page.locator(PREVIEW).first().click();
  await page.clock.runFor(2000);
  await page.waitForSelector(SEEK, { timeout: 8000 });
  await page.clock.runFor(1000);
  await page.locator('button[aria-label="Pause"]').click();
  await page.clock.runFor(120000);
  check("two minutes paused earn no Tickets link", !(await bar(page)).tickets);
  await page.locator('button[aria-label="Play"]').first().click();
  await page.clock.runFor(30000);
  check("thirty seconds of listening is not enough", !(await bar(page)).tickets);
  await page.clock.runFor(35000);
  check("a minute of listening earns it", (await bar(page)).tickets);

  // Opening that DJ's page resumes the live set; it must not reset the clock.
  await openArtist(page, "DJ1");
  await page.clock.runFor(1500);
  await page.locator('button[aria-label="Back to event"]').click();
  await page.clock.runFor(1500);
  check("re-opening the DJ who is playing keeps the Tickets link", (await bar(page)).tickets);
  await context.close();
}

// ═══ 10. The end of the queue ══════════════════════════════════════════════

{
  console.log("\n== the end of the queue ==");
  const { context, page } = await boot({
    events: [mkEvent("1", "Night One", [1, 2])],
    cfg: { duration: 2000 },
    artists: { 1: { count: 3 }, 2: { count: 2 } },
  });
  await openArtist(page, "DJ1");
  await waitBar(page);
  const end = await until(page, (s) => /3 of 3/.test(s.subtitle ?? "") && s.playBtn === "Play", 14000);
  check("three short sets chain through to the last and stop", /3 of 3/.test(end.subtitle ?? "") && end.playBtn === "Play" && !end.spinner, `${end.subtitle} ${end.playBtn}`);
  await backToEvent(page);
  await page.evaluate(() => {
    window.__cfg.duration = 3600000;
  });
  await page.locator(plus("DJ2")).click();
  const next = await until(page, (s) => /4 of 4/.test(s.subtitle ?? "") && s.playBtn === "Pause", 6000);
  check("adding to a queue that has finished starts the new set", /DJ2/.test(next.subtitle ?? "") && /4 of 4/.test(next.subtitle ?? "") && next.playBtn === "Pause", `${next.subtitle} ${next.playBtn}`);
  await context.close();
}

// ═══ 11. An add that finds nothing says so ═════════════════════════════════

{
  console.log("\n== failed adds ==");
  // Nobody on this bill has a set anywhere. A `+` used to spin and go quiet.
  const { context, page } = await boot({
    events: [mkEvent("1", "Night One", [1, 2])],
    artists: { 1: { count: 0 }, 2: { count: 0 } },
  });
  const dj = page.getByText("No sets found for DJ2.", { exact: true });
  const night = page.getByText("No sets found for this lineup.", { exact: true });

  await page.locator(plus("DJ2")).click();
  await dj.waitFor({ timeout: 8000 }).catch(() => {});
  check("a DJ's add that finds nothing says so, by name", (await dj.count()) === 1);
  check("and the + is live again rather than silently inert", !(await page.locator(plus("DJ2")).isDisabled()));
  check("the night's message is not shown for one DJ", (await night.count()) === 0);

  await page.locator(NIGHT).click();
  await night.waitFor({ timeout: 8000 }).catch(() => {});
  check("the whole lineup finding nothing says so under the play row", (await night.count()) === 1);
  check("and the DJ's message is cleared by the new add", (await dj.count()) === 0);
  check("no player appeared for an empty queue", !(await bar(page)).present);
  await context.close();
}


// ═══ 12. A set that cannot be played does not hold the queue ═══════════════

{
  console.log("\n== the watchdog ==");
  const scSet = (title, slug) => ({
    provider: "soundcloud",
    id: `sc-${slug}`,
    title,
    url: `https://soundcloud.com/dj1/${slug}`,
    embedUrl: `https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fdj1%2F${slug}`,
    duration: 2400,
    plays: 1,
    createdAt: null,
    artwork: null,
  });
  const mcSet = (title, slug) => ({
    provider: "mixcloud",
    id: `mc-${slug}`,
    title,
    url: `https://www.mixcloud.com/a/${slug}/`,
    embedUrl: `https://www.mixcloud.com/widget/iframe/?feed=%2Fa%2F${slug}%2F`,
    duration: 2400,
    plays: 1,
    createdAt: null,
    artwork: null,
  });
  const noticeOf = (page) =>
    page.evaluate(() => document.querySelector("[data-player-host]")?.getAttribute("data-player-notice") ?? null);
  /** Moves the fake clock in small steps so React renders between the timers that matter. */
  const advance = async (page, ms, step = 500) => {
    for (let t = 0; t < ms; t += step) {
      await page.clock.runFor(step);
      await sleep(25);
    }
  };
  const nextBtn = (page) => page.locator('button[aria-label="Next mix"]');
  /** Like advance(), but stops as soon as `pred` holds. The notice is up for 4 s, so waiting for the next title is waiting it out. */
  const advanceUntil = async (page, pred, max = 30000, step = 250) => {
    for (let t = 0; t < max; t += step) {
      if (await pred()) return true;
      await page.clock.runFor(step);
      await sleep(25);
    }
    return pred();
  };
  /** Real-time poll, for the sections that do not install a fake clock. */
  const pollUntil = async (pred, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await pred()) return true;
      await sleep(100);
    }
    return pred();
  };
  const playing = (b) => b.playBtn === "Pause" && !b.spinner;

  {
    // A Mixcloud `ready` that never settles: skipped after the long fuse.
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      clock: true,
      artists: { 1: { sets: [mcSet("Dead Mix", "never"), scSet("Live Mix", "live")] } },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    await advance(page, 15000);
    check("a Mixcloud set still loading at 15 s is not given up on", (await bar(page)).title === "Dead Mix");
    await advance(page, 6000);
    const skipping = await advanceUntil(page, async () => (await noticeOf(page)) === "skipped", 10000);
    const shown = await bar(page);
    check("a Mixcloud set that never becomes ready is skipped", skipping, `notice ${await noticeOf(page)}`);
    check("and while the notice is up the bar names the skipped set", shown.title === "Dead Mix", shown.title);
    await advance(page, 5000);
    check("the notice clears itself", (await noticeOf(page)) === null);
    check("and the next set is the one playing", (await bar(page)).title === "Live Mix", (await bar(page)).title);
    await context.close();
  }
  {
    // Leaving a hung Mixcloud build must take its iframe with it.
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      artists: { 1: { sets: [mcSet("Dead Mix", "never"), scSet("Live Mix", "live")] } },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    await sleep(500);
    check("the hung build has put its iframe in the host", (await bar(page)).iframes === 1);
    await nextBtn(page).click();
    const b = await until(page, (s) => s.title === "Live Mix" && playing(s), 6000);
    await sleep(300);
    check("no orphan iframe after Next away from a hung Mixcloud build", (await bar(page)).iframes === 1, `iframes=${(await bar(page)).iframes} ${b.title}`);
    await context.close();
  }
  {
    // A SoundCloud swap that never calls back.
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      clock: true,
      cfg: { neverCallback: "stuck" },
      artists: { 1: { sets: [scSet("First", "one"), scSet("Stuck", "stuck"), scSet("Third", "three")] } },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    await advance(page, 2000);
    await nextBtn(page).click();
    const skipping = await advanceUntil(page, async () => (await noticeOf(page)) === "skipped", 30000);
    const stuck = await bar(page);
    check("a SoundCloud load() that never calls back is skipped", skipping && stuck.title === "Stuck", stuck.title);
    check("with a notice", (await noticeOf(page)) === "skipped");
    await advance(page, 5000);
    const b = await until(page, (s) => s.title === "Third", 3000);
    check("and the next set plays once the notice clears", b.title === "Third", b.title);
    await context.close();
  }
  {
    // A widget error skips straight away, and the notice outlives the next set starting.
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      cfg: { errorOnLoad: "broken" },
      artists: { 1: { sets: [scSet("First", "one"), scSet("Broken", "broken"), scSet("Third", "three")] } },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    await until(page, playing);
    await nextBtn(page).click();
    const gated = await pollUntil(async () => (await noticeOf(page)) === "skipped", 6000);
    const during = await until(page, playing, 6000);
    check("a widget error is skipped", gated && during.title === "Broken" && playing(during), `${during.title} ${during.playBtn}`);
    check("and the notice is up while the next set plays", (await noticeOf(page)) === "skipped");
    await sleep(4600);
    check("then it goes", (await noticeOf(page)) === null);
    check("and the next set is the one playing", (await bar(page)).title === "Third" && playing(await bar(page)), (await bar(page)).title);
    await context.close();
  }
  {
    // FINISH never arrives.
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      cfg: { noFinish: true, duration: 3000 },
      artists: { 1: { sets: [scSet("First", "one"), scSet("Second", "two")] } },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    await sleep(3800);
    check("at the end with no FINISH the set is not left yet", (await bar(page)).title === "First");
    const b = await until(page, (s) => s.title === "Second", 8000);
    check("with FINISH suppressed the queue still advances", b.title === "Second", b.title);
    await context.close();
  }
  {
    // Three dead sets in a row stop on the third.
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      cfg: { errorOnLoad: "dead" },
      artists: {
        1: {
          sets: [
            scSet("First", "one"),
            scSet("Dead A", "dead-a"),
            scSet("Dead B", "dead-b"),
            scSet("Dead C", "dead-c"),
            scSet("After", "after"),
          ],
        },
      },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    await until(page, playing);
    await nextBtn(page).click();
    const b = await until(page, (s) => s.title === "Dead C" && s.playBtn === "Play" && !s.spinner, 8000);
    await sleep(1500);
    const stopped = await bar(page);
    check("three dead sets in a row stop on the third", stopped.title === "Dead C", stopped.title);
    check("paused, nothing playing", stopped.playBtn === "Play" && !stopped.spinner, `${stopped.playBtn} ${stopped.spinner}`);
    check("with the blocked notice up, and it does not time out", (await noticeOf(page)) === "blocked");
    await page.evaluate(() => {
      window.__cfg.errorOnLoad = null;
    });
    const before = loads(await logOf(page));
    await page.locator('button[aria-label="Play"]').first().click();
    const again = await until(page, (s) => s.title === "Dead C" && playing(s), 6000);
    check("a tap on Play tries the set again", loads(await logOf(page)) === before + 1 && playing(again), `loads ${before} -> ${loads(await logOf(page))}, ${again.playBtn}`);
    check("and the notice goes once it plays", (await noticeOf(page)) === null);
    await context.close();
  }
  {
    // A seek to the very end must not end the set.
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      artists: { 1: { sets: [scSet("First", "one"), scSet("Second", "two")] } },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    await until(page, (s) => playing(s) && s.max === "3600", 8000);
    await page.locator(SEEK).focus();
    await page.keyboard.press("End");
    await sleep(900);
    const seeks = await page.evaluate(() => window.__seekLog);
    const last = seeks[seeks.length - 1];
    check("a seek to the far right stops short of the end", last !== undefined && last <= 3597000 && last > 3500000, `seekTo(${last})`);
    check("and the queue does not advance", (await bar(page)).title === "First");
    await context.close();
  }
  {
    // A tick from before the seek, landing after it.
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      cfg: { staleOnSeek: true },
      artists: { 1: { sets: [scSet("First", "one")] } },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    await until(page, (s) => playing(s) && s.max === "3600" && Number(s.value) >= 1, 8000);
    await page.locator(SEEK).focus();
    await page.keyboard.press("End");
    const low = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const input = document.querySelector('input[aria-label="Seek"]');
          let min = Infinity;
          const end = performance.now() + 700;
          (function sample() {
            if (input) min = Math.min(min, Number(input.value));
            if (performance.now() < end) setTimeout(sample, 10);
            else resolve(min);
          })();
        }),
    );
    check("a stale pre-seek tick does not drag the playhead back", low > 3000, `lowest ${low}`);
    await context.close();
  }
  {
    // Previous restarts the set once it is more than a few seconds in.
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      artists: { 1: { sets: [scSet("First", "one"), scSet("Second", "two")] } },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    const prev = page.locator('button[aria-label="Previous mix"]');
    await until(page, (s) => playing(s) && Number(s.value) >= 1, 6000);
    check("on the first set Previous is off at the start", await prev.isDisabled());
    await until(page, (s) => Number(s.value) >= 4, 8000);
    check("on the first set Previous is on once there is something to restart", !(await prev.isDisabled()));
    await prev.click();
    const r = await until(page, (s) => Number(s.value) <= 1, 3000);
    check("Previous on the first set restarts it", r.title === "First" && Number(r.value) <= 1, `${r.title} ${r.value}`);
    await nextBtn(page).click();
    await until(page, (s) => s.title === "Second" && Number(s.value) >= 4, 10000);
    await prev.click();
    const r2 = await until(page, (s) => Number(s.value) <= 1, 3000);
    check("Previous more than 3 s into a set restarts that set", r2.title === "Second" && Number(r2.value) <= 1, `${r2.title} ${r2.value}`);
    await prev.click();
    const r3 = await until(page, (s) => s.title === "First", 3000);
    check("and within 3 s of the start it goes back a set", r3.title === "First", r3.title);
    await context.close();
  }
}

// ═══ The watchdog, seen from the bar ═══════════════════════════════════════
// Pax's section above reads the host's data attribute. These read the bar a
// listener sees: the notice's name, its line of copy, the scrubber, the drain.

{
  const scSet = (title, slug) => ({
    provider: "soundcloud",
    id: `sc-${slug}`,
    title,
    url: `https://soundcloud.com/dj1/${slug}`,
    embedUrl: `https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fdj1%2F${slug}`,
    duration: 2400,
    plays: 1,
    createdAt: null,
    artwork: null,
  });
  const mcSet = (title, slug) => ({
    provider: "mixcloud",
    id: `mc-${slug}`,
    title,
    url: `https://www.mixcloud.com/a/${slug}/`,
    embedUrl: `https://www.mixcloud.com/widget/iframe/?feed=%2Fa%2F${slug}%2F`,
    duration: 2400,
    plays: 1,
    createdAt: null,
    artwork: null,
  });
  const advance = async (page, ms, step = 500) => {
    for (let t = 0; t < ms; t += step) {
      await page.clock.runFor(step);
      await sleep(25);
    }
  };
  const playing = (b) => b.playBtn === "Pause" && !b.spinner;
  const advanceUntil = async (page, pred, max = 30000, step = 250) => {
    for (let t = 0; t < max; t += step) {
      if (await pred()) return true;
      await page.clock.runFor(step);
      await sleep(25);
    }
    return pred();
  };
  /** The bar's own copy, notice state and scrubber, read off the DOM. */
  const barNow = (page) =>
    page.evaluate(() => {
      const seek = document.querySelector('input[aria-label="Seek"]');
      const root = seek?.closest("div.fixed");
      const main = document.querySelector('button[aria-label="Play"], button[aria-label="Pause"]');
      return {
        notice: root?.getAttribute("data-notice") ?? null,
        title: root?.querySelector(".player-title")?.textContent ?? null,
        sub: root?.querySelector(".player-sub")?.textContent ?? null,
        seekOpacity: seek ? getComputedStyle(seek).opacity : null,
        drain: root ? getComputedStyle(root, "::before").animationName : null,
        main: main?.getAttribute("aria-label") ?? null,
        height: root ? root.getBoundingClientRect().height : null,
        value: seek?.value ?? null,
        max: seek?.max ?? null,
      };
    });

  {
    // A Mixcloud set that never becomes ready: the bar names it while it is skipped.
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      clock: true,
      artists: { 1: { sets: [mcSet("Dead Mix", "never"), scSet("Live Mix", "live")] } },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    await advance(page, 1000);
    const quiet = await barNow(page);
    await advanceUntil(page, async () => (await barNow(page)).notice === "skipped", 30000);
    const skipped = await barNow(page);
    check("a skipped set: the bar says skipping, under the skipped set's own name",
      skipped.notice === "skipped" && skipped.title === "Dead Mix" && /skipping/.test(skipped.sub ?? ""),
      JSON.stringify({ notice: skipped.notice, title: skipped.title, sub: skipped.sub }));
    check("and the scrubber is hidden while the notice is up", skipped.seekOpacity === "0", `opacity ${skipped.seekOpacity}`);
    check("and the drain animation runs on the bar's top edge", skipped.drain === "skip-drain", `animationName ${skipped.drain}`);
    await advanceUntil(page, async () => (await barNow(page)).notice === null, 10000);
    const after = await barNow(page);
    check("after the notice clears the bar has no notice", after.notice === null, `notice ${after.notice}`);
    check("the bar is the same height once the notice clears", after.height === quiet.height, `${quiet.height} -> ${after.height}`);
    check("and the title is the set now playing", after.title === "Live Mix", after.title);
    await context.close();
  }
  {
    // Three dead sets in a row: the bar stops and says so, and the Play button is honest.
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      cfg: { errorOnLoad: "dead" },
      artists: {
        1: {
          sets: [scSet("First", "one"), scSet("Dead A", "dead-a"), scSet("Dead B", "dead-b"), scSet("Dead C", "dead-c"), scSet("After", "after")],
        },
      },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    await until(page, playing);
    await page.locator('button[aria-label="Next mix"]').click();
    await until(page, (s) => s.title === "Dead C" && s.playBtn === "Play" && !s.spinner, 8000);
    await sleep(800);
    const blocked = await barNow(page);
    check("three dead sets stop the bar in the blocked state", blocked.notice === "blocked", String(blocked.notice));
    check("the blocked line is exactly 'Tap play to continue'", blocked.sub === "Tap play to continue", JSON.stringify(blocked.sub));
    check("the blocked state has no drain animation", blocked.drain === "none", `animationName ${blocked.drain}`);
    check("the main transport button says Play, not Pause", blocked.main === "Play", `aria-label ${blocked.main}`);
    await sleep(4600);
    check("and the blocked state does not clear on its own", (await barNow(page)).notice === "blocked");
    await context.close();
  }
  {
    // Seek to the far right on a set that is not last: the queue stays put.
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      artists: { 1: { sets: [scSet("First", "one"), scSet("Second", "two")] } },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    await until(page, (s) => playing(s) && s.max === "3600", 8000);
    await page.locator(SEEK).focus();
    await page.keyboard.press("End");
    await sleep(900);
    const endKey = await barNow(page);
    check("End on the scrubber does not advance the queue", endKey.title === "First", endKey.title);
    check("and leaves the position within 5 s of the end",
      Number(endKey.max) - Number(endKey.value) <= 5, `value ${endKey.value} of ${endKey.max}`);
    await context.close();
  }
  {
    // The same, by dragging the thumb past the right edge with the pointer.
    const { context, page } = await boot({
      events: [mkEvent("1", "Night One", [1])],
      artists: { 1: { sets: [scSet("First", "one"), scSet("Second", "two")] } },
    });
    await openArtist(page, "DJ1");
    await waitBar(page);
    await until(page, (s) => playing(s) && s.max === "3600", 8000);
    const box = await page.locator(SEEK).boundingBox();
    const midY = box.y + box.height / 2;
    const v = Number((await barNow(page)).value);
    const thumbX = box.x + 6 + (box.width - 12) * (v / 3600);
    await page.mouse.move(thumbX, midY);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 30, midY, { steps: 8 });
    await sleep(150);
    await page.mouse.up();
    await sleep(900);
    const dragged = await barNow(page);
    check("dragging to the far right does not advance the queue", dragged.title === "First", dragged.title);
    check("and leaves the position within 5 s of the end",
      Number(dragged.max) - Number(dragged.value) <= 5, `value ${dragged.value} of ${dragged.max}`);
    await context.close();
  }
}

await browser.close();
shutdown();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
