/**
 * L2 probe: how sets get INTO the playlist (usePlaylistAdd / useEventPreview).
 * Investigation only. Run: E2E_PORT=5512 node tests/agent-l2-playlist-add.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 5512);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), ".cache", "ms-playwright"),
  ].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).filter((d) => d.startsWith("chromium"))) {
      for (const parts of [["chrome-linux", "chrome"]]) {
        const c = join(root, entry, ...parts);
        if (existsSync(c)) return c;
      }
    }
  }
  throw new Error("No Chromium found");
}

const TODAY = new Date().toISOString().slice(0, 10);

// Artist behaviour, keyed by RA id.
//   delay: ms before answering; sets: "ok" | "empty" | 429 | "hang"
const ARTISTS = {
  a0: { name: "Alpha", delay: 100, sets: "ok" },
  a1: { name: "Bravo", delay: 4000, sets: "ok" },
  a2: { name: "Charlie", delay: 200, sets: "empty" },
  a3: { name: "Foxtrot", delay: 200, sets: 429 },
  d0: { name: "Delta", delay: 300, sets: "ok" },
  d1: { name: "Echo", delay: 200, sets: "empty" },
  g0: { name: "Ghost", delay: 200, sets: "empty" },
  g1: { name: "Hollow", delay: 200, sets: "empty" },
  h0: { name: "Hang", delay: 0, sets: "hang" },
};

const mkEvent = (id, title, ids) => ({
  id,
  title,
  date: `${TODAY}T00:00:00.000`,
  startTime: `${TODAY}T22:00:00.000`,
  endTime: null,
  url: `https://ra.co/events/${id}`,
  imageUrl: null,
  venue: { name: "Nowadays", area: "New York" },
  artists: ids.map((aid) => ({ id: aid, name: ARTISTS[aid].name })),
  attending: 120,
  isPick: false,
  pickBlurb: null,
});

const EVENTS = [
  mkEvent("e1", "Night One", ["a0", "a1", "a2", "a3"]),
  mkEvent("e2", "Night Two", ["d0", "d1"]),
  mkEvent("e3", "Dead Night", ["g0", "g1"]),
  mkEvent("e4", "Hung Night", ["h0"]),
];

const setsFor = (name, id) =>
  Array.from({ length: 10 }, (_, i) => ({
    provider: "soundcloud",
    id: `${id}-set${i}`,
    title: `${name} — set ${i}`,
    url: `https://soundcloud.com/${id}/${i}`,
    embedUrl: `https://w.soundcloud.com/player/?url=${id}-${i}`,
    duration: 3600,
    plays: 100,
    createdAt: null,
    artwork: null,
  }));

const FAKE_SC = `
(function(){
  var Events={READY:'ready',PLAY:'play',PAUSE:'pause',FINISH:'finish',PLAY_PROGRESS:'playProgress',ERROR:'error'};
  function Widget(iframe){
    var l={},pos=0,timer=null,duration=3600000,activated=false;
    function emit(e,p){(l[e]||[]).forEach(function(f){f(p);});}
    function run(){ if(timer) return; emit(Events.PLAY);
      timer=setInterval(function(){ pos+=250; emit(Events.PLAY_PROGRESS,{currentPosition:pos});
        if(pos>=duration){clearInterval(timer);timer=null;emit(Events.FINISH);} },250); }
    return {
      bind:function(e,cb){(l[e]=l[e]||[]).push(cb); if(e===Events.READY) setTimeout(cb,40);},
      getDuration:function(cb){cb(duration);},
      load:function(url,opts){ pos=0; activated=true; if(opts&&opts.callback) setTimeout(opts.callback,20); },
      play:function(){ if(!activated){ activated=true; run(); return; } run(); },
      pause:function(){ if(timer){clearInterval(timer);timer=null;} emit(Events.PAUSE); },
      seekTo:function(ms){ pos=ms; emit(Events.PLAY_PROGRESS,{currentPosition:pos}); }
    };
  }
  Widget.Events=Events;
  window.SC={Widget:Widget};
})();`;

const server = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1", "--strictPort"], {
  stdio: "ignore",
  cwd: "/home/user/ra-nyc",
});
process.on("exit", () => { try { server.kill("SIGTERM"); } catch {} });
for (let attempt = 0; ; attempt += 1) {
  try { await fetch(BASE); break; } catch {
    if (attempt > 120) throw new Error("Dev server never came up");
    await sleep(250);
  }
}


const browser = await chromium.launch({ executablePath: findChromium() });
const L = (...a) => console.log(...a);

// The query cache is persisted to localStorage (src/main.tsx), so every scenario
// gets a brand-new context: nothing a previous scenario fetched can answer this one.
let T0 = Date.now();
const t = () => `+${String(Date.now() - T0).padStart(5)}ms`;

async function freshPage() {
  const context = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true, isMobile: true });
  const page = await context.newPage();
  page.on("pageerror", (e) => L("PAGEERROR:", e.message));
  page.on("console", (m) => { if (m.type() === "error") L("CONSOLE-ERROR:", m.text().slice(0, 160)); });
  const calls = [];
  await page.route("**/api/events*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ date: TODAY, events: EVENTS, count: EVENTS.length }) }),
  );
  await page.route("**/w.soundcloud.com/player/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub</title>" }),
  );
  await page.route("**/w.soundcloud.com/player/api.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: FAKE_SC }),
  );
  await page.route("**/api/artist*", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("id") ?? "";
    const spec = ARTISTS[id];
    calls.push(id);
    L(`  ${t()} req ${spec?.name ?? id}`);
    if (!spec) return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"unknown"}' });
    if (spec.sets === "hang") return; // never answer
    await sleep(spec.delay);
    L(`  ${t()} resp ${spec.name} (${spec.sets === 429 ? 429 : spec.sets})`);
    if (spec.sets === 429) {
      return route.fulfill({ status: 429, contentType: "application/json", body: '{"error":"Too many requests"}' });
    }
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id, name: spec.name,
        sets: spec.sets === "ok" ? setsFor(spec.name, id) : [],
        links: [], bio: null, mixcloudUrl: null, soundcloudUrl: null, raUrl: null,
        cached: false, linkSource: "auto",
      }),
    });
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Night One", { timeout: 20000 });
  await sleep(300);
  page.calls = calls;
  return page;
}

const plus = (name) => `button[aria-label="Add ${name} to the playlist"]`;
const NIGHT = 'button[aria-label="Add the whole lineup to the playlist"]';
const PREVIEW = 'button:has-text("Preview the night"), button:has-text("Finding sets")';

async function state(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return "absent";
    const spin = el.querySelector("svg.animate-spin") !== null;
    return `${el.disabled ? "disabled" : "enabled"}${spin ? ",spinning" : ""}`;
  }, sel);
}
async function openEvent(page, title) {
  await page.getByText(title, { exact: true }).first().click();
  await page.waitForSelector(PREVIEW, { timeout: 8000 });
  await sleep(250);
}
const closeSheet = async (page) => { await page.keyboard.press("Escape"); await sleep(600); };
async function queue(page) {
  // Opens the playlist panel (sticky per page) and waits a render before reading it.
  const opened = await page.evaluate(() => {
    const toggle = document.querySelector('button[aria-label="Show playlist"]');
    if (toggle) { toggle.click(); return true; }
    return false;
  });
  if (opened) await sleep(700);
  return page.evaluate(() => {
    return [...document.querySelectorAll('ul[aria-label="Playlist"] li')].map((li) => {
      const title = li.querySelector("span.block")?.textContent ?? "?";
      return (li.querySelector('button[aria-current="true"]') ? "*" : "") + title;
    });
  });
}
async function show(page, label) {
  await sleep(120);
  const sub = await page.evaluate(() => document.querySelectorAll(".player-live p")[1]?.textContent ?? "(no transport)");
  L(`  ${label}: transport="${sub.slice(0, 48)}"`);
  await queue(page); // first call opens the panel; read again once it has rendered
  await sleep(400);
  L(`  ${label}: queue=${JSON.stringify(await queue(page))}`);
}
async function feedback(page) {
  return page.evaluate(() =>
    document.body.innerText.match(/[^\n]*(no sets|couldn|could not|failed|try again|not found|too many|rate)[^\n]*/gi) ?? [],
  );
}
// A tap on a disabled button does nothing in a browser; dispatch it the same way.
const tap = (page, sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

// ── S1: + on Bravo (4s); Alpha and a second Bravo tap while pending ───────────
L("\n=== S1 race: + Bravo (4s), then + Alpha and + Bravo again while pending ===");
T0 = Date.now();
let page = await freshPage();
await openEvent(page, "Night One");
page.calls.length = 0;
L(`  ${t()} tap Bravo +`);
await tap(page, plus("Bravo"));
await sleep(100);
L(`  ${t()} t+100ms  Bravo=${await state(page, plus("Bravo"))}  Alpha=${await state(page, plus("Alpha"))}  NIGHT=${await state(page, NIGHT)}`);
await tap(page, plus("Alpha"));
await tap(page, plus("Bravo"));
L(`  ${t()} tapped Alpha and Bravo again (should be swallowed)`);
await sleep(1500);
L(`  ${t()} t+1.6s   Bravo=${await state(page, plus("Bravo"))}  Alpha=${await state(page, plus("Alpha"))}`);
await sleep(3000);
L(`  ${t()} t+4.6s   Bravo=${await state(page, plus("Bravo"))}  Alpha=${await state(page, plus("Alpha"))}`);
await show(page, "after Bravo settles");
L(`  requests during S1: ${JSON.stringify(page.calls)}`);
await tap(page, plus("Alpha"));
await sleep(600);
await show(page, "after Alpha + (now allowed)");
await page.context().close();

// ── S2: + Bravo (4s), then Preview the night 100ms later ──────────────────────
L("\n=== S2 + Bravo (4s), then Preview the night 100ms later ===");
T0 = Date.now();
page = await freshPage();
await openEvent(page, "Night One");
page.calls.length = 0;
L(`  ${t()} tap Bravo +`);
await tap(page, plus("Bravo"));
await sleep(100);
L(`  ${t()} tap Preview`);
await page.locator(PREVIEW).first().click();
await sleep(1000);
await show(page, "t+1.1s");
await sleep(4900);
await show(page, "t+6s (Bravo resolved ~5.4s)");
L(`  Bravo=${await state(page, plus("Bravo"))}`);
await page.context().close();

// ── S3: no-sets artist, 429 artist, night over a mixed bill ───────────────────
L("\n=== S3 Charlie (no sets), Foxtrot (429), then night on Night One ===");
T0 = Date.now();
page = await freshPage();
await openEvent(page, "Night One");
await tap(page, plus("Charlie"));
await sleep(900);
L(`  Charlie=${await state(page, plus("Charlie"))} feedback=${JSON.stringify(await feedback(page))}`);
await show(page, "after Charlie");
await tap(page, plus("Foxtrot"));
await sleep(900);
L(`  Foxtrot=${await state(page, plus("Foxtrot"))} feedback=${JSON.stringify(await feedback(page))}`);
await show(page, "after Foxtrot");
await tap(page, NIGHT);
await sleep(4800);
L(`  NIGHT=${await state(page, NIGHT)} feedback=${JSON.stringify(await feedback(page))}`);
await show(page, "after night");
await page.context().close();

// ── S4: night where every DJ has zero sets ────────────────────────────────────
L("\n=== S4 night on Dead Night (all sets empty) ===");
T0 = Date.now();
page = await freshPage();
await openEvent(page, "Dead Night");
await tap(page, NIGHT);
await sleep(900);
L(`  NIGHT=${await state(page, NIGHT)} Ghost=${await state(page, plus("Ghost"))} feedback=${JSON.stringify(await feedback(page))}`);
await show(page, "after dead night");
await page.context().close();

// ── S5: artist request never answers ──────────────────────────────────────────
L("\n=== S5 Hung Night: artist request never answers ===");
T0 = Date.now();
page = await freshPage();
await openEvent(page, "Hung Night");
await tap(page, plus("Hang"));
await sleep(6000);
L(`  Hang=${await state(page, plus("Hang"))} NIGHT=${await state(page, NIGHT)} feedback=${JSON.stringify(await feedback(page))}`);
await page.context().close();

// ── S6: build a playlist, then Preview a different night ──────────────────────
L("\n=== S6 Delta from Night Two into the playlist, then Preview Night One ===");
T0 = Date.now();
page = await freshPage();
await openEvent(page, "Night Two");
await tap(page, plus("Delta"));
await sleep(900);
await show(page, "before preview");
await closeSheet(page);
await openEvent(page, "Night One");
await page.locator(PREVIEW).first().click();
await sleep(4800);
await show(page, "after preview");
await page.context().close();

// ── S7: Preview Night One, switch to Night Two while Bravo (E1) still pending ─
L("\n=== S7 Preview Night One (Bravo pending), switch to Night Two, Preview it ===");
T0 = Date.now();
page = await freshPage();
await openEvent(page, "Night One");
await page.locator(PREVIEW).first().click();
await sleep(300);
await closeSheet(page);
await openEvent(page, "Night Two");
await page.locator(PREVIEW).first().click();
L(`  ${t()} Night Two preview tapped`);
await sleep(1500);
await show(page, "t+1.5s");
await sleep(3500);
await show(page, "t+5s");
await page.context().close();

await browser.close();
server.kill("SIGTERM");
process.exit(0);
