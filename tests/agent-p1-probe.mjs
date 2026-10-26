/**
 * P1 probes — player bug hunt. Investigation only; nothing in src/ is touched.
 *
 *   E2E_PORT=5501 node tests/agent-p1-probe.mjs [scenario ...]
 *
 * A copy of the suite's FAKE_SC, extended with knobs (window.__cfg) so the
 * scenarios can reproduce things the stock fake cannot: short tracks that
 * FINISH, ERROR events, delayed load() callbacks. Plus a fake Mixcloud widget.
 */
import { spawn } from "node:child_process";
import { chromium, devices } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 5501);
const BASE = `http://127.0.0.1:${PORT}`;
const only = process.argv.slice(2);

const out = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── fixtures ────────────────────────────────────────────────────────────────
const mkSet = (artist, n, extra = {}) => ({
  provider: "soundcloud",
  id: `sc-${artist}-${n}`,
  title: `A${artist} Set ${n}`,
  url: `https://soundcloud.com/a${artist}/${n}`,
  embedUrl: `https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fa${artist}%2F${n}`,
  duration: 2400,
  plays: 1,
  createdAt: null,
  artwork: null,
  ...extra,
});
const artistPayload = (id, name, sets) => ({
  id, name, mixcloudUser: null, mixcloudUrl: null, soundcloudUser: "t", soundcloudUrl: "https://soundcloud.com/t",
  raUrl: null, bio: null, sets, links: [], linkSource: "auto", cached: false, persisted: false,
});
const EVENT = (artists) => ({
  id: "1", title: "Test Night", date: "2026-08-02T00:00:00.000",
  startTime: "2026-08-02T22:00:00.000", endTime: "2026-08-03T04:00:00.000",
  url: "https://ra.co/events/1", imageUrl: "https://images.ra.co/x.jpg",
  venue: { name: "Nowadays", area: "New York" },
  artists: artists.map((n) => ({ id: String(n), name: `DJ${n}` })),
  attending: 100, isPick: false, pickBlurb: null,
});

const FAKE_SC = `
(function(){
  var Events={READY:'ready',PLAY:'play',PAUSE:'pause',FINISH:'finish',PLAY_PROGRESS:'playProgress',ERROR:'error'};
  var cfg = window.__cfg = window.__cfg || {};
  window.__built = 0; window.__log = [];
  function Widget(iframe){
    var l={},pos=0,timer=null,duration=cfg.duration||3600000,activated=false,parsed=false,plays=0;
    window.__built++;
    function emit(e,p){(l[e]||[]).forEach(function(f){f(p);});}
    function tick(){ emit(Events.PLAY_PROGRESS,{currentPosition:pos,relativePosition:pos/duration}); }
    function run(){ if(timer) return;
      plays++;
      if(cfg.errorOnFirstPlay && plays===1){ window.__log.push('ERROR'); emit(Events.ERROR); return; }
      parsed=true; emit(Events.PLAY);
      timer=setInterval(function(){ pos+=250; tick();
        if(pos>=duration){clearInterval(timer);timer=null;pos=0;window.__log.push('FINISH');emit(Events.FINISH);} },250); }
    return {
      bind:function(e,cb){(l[e]=l[e]||[]).push(cb); if(e===Events.READY) setTimeout(cb,40);},
      getDuration:function(cb){cb(parsed?duration:0);},
      load:function(url,opts){ window.__log.push('load '+url); var stale=pos; pos=0; activated=true;
        if(timer){clearInterval(timer);timer=null;}
        setTimeout(function(){ emit(Events.PLAY_PROGRESS,{currentPosition:stale,relativePosition:stale/duration}); },5);
        if(opts&&opts.callback) setTimeout(opts.callback,cfg.loadDelay||20); },
      play:function(){ window.__log.push('play'); run(); },
      pause:function(){ window.__log.push('pause'); if(timer){clearInterval(timer);timer=null;} emit(Events.PAUSE); },
      seekTo:function(ms){ pos=ms; tick(); }
    };
  }
  Widget.Events=Events;
  window.SC={Widget:Widget};
})();
`;

const FAKE_MC = `
(function(){
  window.__mcBuilt = 0;
  window.Mixcloud = { PlayerWidget: function(iframe){
    window.__mcBuilt++;
    var delay = /slow/.test(iframe.src) ? 3000 : 800;
    var dur = /slow/.test(iframe.src) ? 2222 : 1111;
    var mk=function(){return {on:function(){}};};
    return { ready: new Promise(function(r){setTimeout(r,delay);}),
      play:function(){return Promise.resolve();}, pause:function(){return Promise.resolve();},
      seek:function(){return Promise.resolve(true);}, getDuration:function(){return Promise.resolve(dur);},
      events:{play:mk(),pause:mk(),ended:mk(),error:mk(),progress:mk()} };
  }};
})();
`;

// ── infra ───────────────────────────────────────────────────────────────────
const server = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1"], { stdio: "ignore" });
const shutdown = () => { try { server.kill("SIGTERM"); } catch { /* gone */ } };
process.on("exit", shutdown);
for (let i = 0; ; i += 1) {
  try { await fetch(BASE); break; } catch { if (i > 80) throw new Error("no server"); await sleep(250); }
}
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

/** opts: artists{id:{sets,delay}}, lineup[], cfg, scApi(route handler), clock */
async function boot(opts) {
  const context = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true, isMobile: true });
  const page = await context.newPage();
  page.on("pageerror", (e) => out("  PAGEERROR:", e.message));
  await page.addInitScript((cfg) => { window.__cfg = cfg; }, opts.cfg ?? {});
  const seen = {};
  await page.route("**/api/events*", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ date: "2026-08-02", events: [EVENT(opts.lineup)], count: 1 }) }));
  await page.route("**/api/artist*", async (r) => {
    const id = new URL(r.request().url()).searchParams.get("id");
    const a = opts.artists[id];
    seen[id] = (seen[id] ?? 0) + 1;
    if (a.delay && seen[id] === 1) await sleep(a.delay);
    r.fulfill({ contentType: "application/json", body: JSON.stringify(artistPayload(id, `DJ${id}`, a.sets)) });
  });
  await page.route("**/w.soundcloud.com/player/**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub</title>" }));
  await page.route("**/w.soundcloud.com/player/api.js", opts.scApi ?? ((r) =>
    r.fulfill({ contentType: "application/javascript", body: FAKE_SC })));
  await page.route("**/widget.mixcloud.com/**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub</title>" }));
  await page.route("**/widget.mixcloud.com/media/js/widgetApi.js", (r) =>
    r.fulfill({ contentType: "application/javascript", body: FAKE_MC }));
  await page.route("**/images.ra.co/**", (r) => r.abort());
  if (opts.clock) await page.clock.install();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Test Night", { timeout: 20000 });
  await page.waitForTimeout(900);
  await page.locator("text=Test Night").first().click();
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  return { context, page };
}

const bar = (page) => page.evaluate(() => {
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
    playBtn: document.querySelector('button[aria-label="Play"], button[aria-label="Pause"]')?.getAttribute("aria-label") ?? null,
    tickets: !!document.querySelector('a[aria-label^="Tickets for"]'),
    iframes: document.querySelectorAll("[data-player-host] iframe").length,
  };
});

const scenarios = {
  // ── S1: close the player while a party preview is still resolving ────────
  async stopThenLatePreview() {
    const { context, page } = await boot({
      lineup: [1, 2, 3],
      artists: {
        1: { sets: [mkSet(1, 1)] },
        2: { sets: [mkSet(2, 1)], delay: 2500 },
        3: { sets: [mkSet(3, 1)], delay: 3500 },
      },
    });
    await page.locator('button:has-text("Preview the night")').click();
    await page.waitForSelector('input[aria-label="Seek"]', { timeout: 8000 });
    await page.waitForTimeout(600);
    out("  after preview starts:", JSON.stringify(await bar(page)));
    await page.locator('button[aria-label="Close player"]').click();
    await page.waitForTimeout(300);
    out("  right after Close:   ", JSON.stringify(await bar(page)));
    await page.waitForTimeout(4500);
    out("  4.5s later:          ", JSON.stringify(await bar(page)));
    await context.close();
  },

  // ── S2: a "+" add resolves late with a stale enqueue() ───────────────────
  async staleEnqueueReplacesQueue() {
    const { context, page } = await boot({
      lineup: [1, 2],
      artists: {
        1: { sets: [mkSet(1, 1)] },
        2: { sets: [mkSet(2, 1)], delay: 2500 },
      },
    });
    // nothing is playing; add DJ2 (slow)
    await page.locator('button[aria-label="Add DJ2 to the playlist"]').click();
    await page.waitForTimeout(100);
    // meanwhile the listener starts a preview (DJ1 fast)
    await page.locator('button:has-text("Preview the night")').click();
    await page.waitForSelector('input[aria-label="Seek"]', { timeout: 8000 });
    await page.waitForTimeout(500);
    out("  DJ1 playing, DJ2 add still pending:", JSON.stringify(await bar(page)));
    await page.waitForTimeout(3500);
    const b = await bar(page);
    out("  after DJ2 add resolves:            ", JSON.stringify(b));
    out("  EXPECTED: current stays A1 Set 1, queue 2 (1 of 2). If title is 'A2 Set 1' the add replaced the queue.");
    await context.close();
  },

  // ── S3: API script fails once; can the listener retry the same set? ──────
  async retryAfterCreateFailure() {
    let hits = 0;
    const { context, page } = await boot({
      lineup: [1],
      artists: { 1: { sets: [mkSet(1, 1), mkSet(1, 2)] } },
      scApi: (r) => {
        hits += 1;
        if (hits === 1) return r.abort();
        return r.fulfill({ contentType: "application/javascript", body: FAKE_SC });
      },
    });
    await page.locator('[role="dialog"] button:has-text("DJ1")').first().click();
    await page.waitForSelector('input[aria-label="Seek"]', { timeout: 8000 });
    await page.waitForTimeout(1000);
    out("  after failed load:", JSON.stringify(await bar(page)));
    await page.locator('button[aria-label="Play"]').first().click().catch(() => out("  (no Play button)"));
    await page.waitForTimeout(1200);
    out("  after tapping bar Play:", JSON.stringify(await bar(page)), "api.js requests:", hits);
    await page.locator('button[aria-label="Play A1 Set 1"]').first().click();
    await page.waitForTimeout(1200);
    out("  after tapping the set row:", JSON.stringify(await bar(page)), "api.js requests:", hits);
    await page.locator('button[aria-label="Close player"]').click();
    await page.waitForTimeout(300);
    await page.locator('button[aria-label="Play A1 Set 1"]').first().click();
    await page.waitForTimeout(1500);
    out("  after Close + tap set again:", JSON.stringify(await bar(page)), "api.js requests:", hits);
    await context.close();
  },

  // ── S4: ERROR then a successful play — is the error cleared? ─────────────
  async errorSticks() {
    const { context, page } = await boot({
      lineup: [1],
      cfg: { errorOnFirstPlay: true },
      artists: { 1: { sets: [mkSet(1, 1), mkSet(1, 2)] } },
    });
    await page.locator('[role="dialog"] button:has-text("DJ1")').first().click();
    await page.waitForSelector('input[aria-label="Seek"]', { timeout: 8000 });
    await page.waitForTimeout(1200);
    out("  after ERROR:             ", JSON.stringify(await bar(page)));
    await page.waitForTimeout(2500);
    out("  2.5s later (the 700ms start-retry recovered it):", JSON.stringify(await bar(page)));
    await context.close();
  },

  // ── S5: auto-advance + end of queue (3s tracks) ──────────────────────────
  async finishChain() {
    const { context, page } = await boot({
      lineup: [1],
      cfg: { duration: 3000 },
      artists: { 1: { sets: [mkSet(1, 1), mkSet(1, 2), mkSet(1, 3)] } },
    });
    await page.locator('[role="dialog"] button:has-text("DJ1")').first().click();
    await page.waitForSelector('input[aria-label="Seek"]', { timeout: 8000 });
    for (let i = 0; i < 14; i += 1) {
      await page.waitForTimeout(1000);
      const b = await bar(page);
      out(`  t=${i + 1}s`, b.title, "|", b.subtitle, "| pos", b.value, "/", b.max, "|", b.playBtn, b.spinner ? "spinner" : "", "ifr", b.iframes);
    }
    out("  widget log:", JSON.stringify(await page.evaluate(() => window.__log)));
    await context.close();
  },

  // ── S6: rapid Next x3 ────────────────────────────────────────────────────
  async rapidNext() {
    const { context, page } = await boot({
      lineup: [1],
      cfg: { loadDelay: 300 },
      artists: { 1: { sets: [1, 2, 3, 4, 5].map((n) => mkSet(1, n)) } },
    });
    await page.locator('[role="dialog"] button:has-text("DJ1")').first().click();
    await page.waitForSelector('input[aria-label="Seek"]', { timeout: 8000 });
    await page.waitForTimeout(1500);
    for (let i = 0; i < 3; i += 1) { await page.locator('button[aria-label="Next mix"]').click(); await page.waitForTimeout(60); }
    await page.waitForTimeout(2500);
    out("  state after 3 quick Nexts:", JSON.stringify(await bar(page)));
    out("  widget log:", JSON.stringify(await page.evaluate(() => window.__log.slice(-14))));
    await context.close();
  },

  // ── S7: pause while a swap is loading ────────────────────────────────────
  async pauseDuringLoad() {
    const { context, page } = await boot({
      lineup: [1],
      cfg: { loadDelay: 800 },
      artists: { 1: { sets: [mkSet(1, 1), mkSet(1, 2)] } },
    });
    await page.locator('[role="dialog"] button:has-text("DJ1")').first().click();
    await page.waitForSelector('input[aria-label="Seek"]', { timeout: 8000 });
    await page.waitForTimeout(1500);
    await page.locator('button[aria-label="Next mix"]').click();
    await page.waitForTimeout(150);
    out("  mid-load:", JSON.stringify(await bar(page)));
    await page.locator('button[aria-label="Pause"], button[aria-label="Play"]').first().click();
    out("  tapped the transport button mid-load");
    await page.waitForTimeout(2000);
    const b1 = await bar(page);
    await page.waitForTimeout(1500);
    const b2 = await bar(page);
    out("  2s after:", JSON.stringify(b1));
    out("  3.5s after:", JSON.stringify(b2), b2.value !== b1.value ? "=> still advancing: the pause was undone" : "=> paused");
    out("  widget log:", JSON.stringify(await page.evaluate(() => window.__log.slice(-8))));
    await context.close();
  },

  // ── S8: opening an artist wipes the playlist ─────────────────────────────
  async artistOpenClobbersPlaylist() {
    const { context, page } = await boot({
      lineup: [1, 2],
      artists: {
        1: { sets: [mkSet(1, 1)] },
        2: { sets: [1, 2, 3, 4, 5].map((n) => mkSet(2, n)) },
      },
    });
    await page.locator('button:has-text("Preview the night")').click();
    await page.waitForSelector('input[aria-label="Seek"]', { timeout: 8000 });
    await page.waitForTimeout(1500);
    out("  built a party playlist:", JSON.stringify(await bar(page)));
    await page.locator('[role="dialog"] button:has-text("DJ2")').first().click();
    await page.waitForSelector('button[aria-label^="Pause A2"], button[aria-label^="Play A2"]', { timeout: 8000 });
    await page.waitForTimeout(1200);
    out("  after merely OPENING DJ2's page:", JSON.stringify(await bar(page)));
    await context.close();
  },

  // ── S9: `listened` gating (fake clock) ───────────────────────────────────
  async listenedGate() {
    const { context, page } = await boot({
      lineup: [1],
      cfg: { duration: 3600000 },
      clock: true,
      artists: { 1: { sets: [mkSet(1, 1), mkSet(1, 2)] } },
    });
    await page.locator('button:has-text("Preview the night")').click();
    await page.clock.runFor(2000);
    await page.waitForSelector('input[aria-label="Seek"]', { timeout: 8000 });
    await page.clock.runFor(1000);
    out("  playing:", JSON.stringify(await bar(page)));
    await page.locator('button[aria-label="Pause"]').click();
    await page.clock.runFor(1000);
    await page.clock.runFor(120000);
    out("  paused for 2 min of fake time -> tickets:", (await bar(page)).tickets, "(expect false)");
    await page.locator('button[aria-label="Play"]').first().click();
    await page.clock.runFor(30000);
    out("  playing 30s -> tickets:", (await bar(page)).tickets, "(expect false)");
    await page.clock.runFor(35000);
    out("  playing 65s -> tickets:", (await bar(page)).tickets, "(expect true)");
    await context.close();
  },

  // ── S10: stale Mixcloud onReady from a superseded build ──────────────────
  async mixcloudStaleReady() {
    const mc = (artist, n, slow) => ({
      provider: "mixcloud", id: `mc-${artist}-${n}`, title: `M${n}${slow ? " slow" : ""}`,
      url: `https://www.mixcloud.com/a/${n}/`,
      embedUrl: `https://www.mixcloud.com/widget/iframe/?feed=%2Fa%2F${n}%2F${slow ? "&slow=1" : ""}`,
      duration: 999, plays: 1, createdAt: null, artwork: null,
    });
    const { context, page } = await boot({
      lineup: [1],
      artists: { 1: { sets: [mc(1, 1, false), mc(1, 2, true)] } },
    });
    await page.locator('[role="dialog"] button:has-text("DJ1")').first().click();
    await page.waitForSelector('input[aria-label="Seek"]', { timeout: 8000 });
    await page.waitForTimeout(150);
    out("  M1 building (800ms ready):", JSON.stringify(await bar(page)));
    await page.locator('button[aria-label="Next mix"]').click();   // supersede M1 with M2 (3000ms ready)
    for (const ms of [300, 700, 1200, 1500]) {
      await page.waitForTimeout(ms === 300 ? 300 : ms - [300, 700, 1200, 1500][[300, 700, 1200, 1500].indexOf(ms) - 1]);
      out(`  ~${ms + 150}ms after Next:`, JSON.stringify(await bar(page)), "mixcloud widgets built so far:", await page.evaluate(() => window.__mcBuilt));
    }
    await context.close();
  },
  // ── S11: "+ whole lineup" where two DJs resolve to the same b2b recording ─
  async duplicateFromAddNight() {
    const S = mkSet(7, 1); // one upload, on both DJs' profiles
    const { context, page } = await boot({
      lineup: [1, 2],
      cfg: { duration: 3000 },
      artists: { 1: { sets: [S] }, 2: { sets: [S] } },
    });
    await page.locator('button[aria-label="Add the whole lineup to the playlist"]').click();
    await page.waitForSelector('input[aria-label="Seek"]', { timeout: 8000 });
    for (let i = 0; i < 9; i += 1) {
      await page.waitForTimeout(1000);
      const b = await bar(page);
      out(`  t=${i + 1}s`, b.title, "|", b.subtitle, "| pos", b.value, "/", b.max, "|", b.playBtn, b.spinner ? "spinner" : "");
    }
    out("  widget log:", JSON.stringify(await page.evaluate(() => window.__log)));
    await context.close();
  },
};

const names = only.length ? only : Object.keys(scenarios);
for (const name of names) {
  out(`\n=== ${name}`);
  try { await scenarios[name](); } catch (e) { out("  SCENARIO ERROR:", e.message.split("\n")[0]); }
}
await browser.close();
shutdown();
process.exit(0);
