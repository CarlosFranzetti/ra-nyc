/**
 * L1 probe: queue operations in PlayerContext.
 *
 * Drives the real app (fake SoundCloud widget, stubbed /api) and calls the
 * context's mutators directly by finding the provider's value on the React fiber
 * tree, so removeAt/jumpTo/playNext/enqueue can be exercised in states the UI
 * deliberately cannot reach (e.g. removing the live row).
 *
 * Run:  E2E_PORT=5511 node tests/agent-l1-queue.mjs | tail -120
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 5511);
const BASE = `http://127.0.0.1:${PORT}`;
const log = (...a) => console.log(...a);
const check = (name, pass, detail = "") =>
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
const note = (name, detail) => log(`INFO  ${name} — ${detail}`);

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), ".cache", "ms-playwright")].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).filter((d) => d.startsWith("chromium"))) {
      const c = join(root, entry, "chrome-linux", "chrome");
      if (existsSync(c)) return c;
    }
  }
  throw new Error("No Chromium");
}

const EVENT = {
  id: "1", title: "Test Night", date: "2026-08-02T00:00:00.000",
  startTime: "2026-08-02T22:00:00.000", endTime: "2026-08-03T04:00:00.000",
  url: "https://ra.co/events/1", imageUrl: "https://images.ra.co/x.jpg",
  venue: { name: "Nowadays", area: "New York" },
  artists: [{ id: "99", name: "Test DJ" }, { id: "98", name: "Slow DJ" }],
  attending: 100, isPick: false, pickBlurb: null,
};
const mkSet = (n, prefix = "sc") => ({
  provider: "soundcloud", id: `${prefix}-${n}`, title: `Set ${prefix} ${n}`,
  url: `https://soundcloud.com/test/${prefix}/${n}`,
  embedUrl: `https://w.soundcloud.com/player/?url=x${n}&auto_play=false`,
  duration: 2400, plays: 1, createdAt: null, artwork: null,
});
const mkArtist = (id, name, prefix) => ({
  id, name, mixcloudUser: null, mixcloudUrl: null, soundcloudUser: "t", soundcloudUrl: "https://soundcloud.com/t",
  raUrl: null, bio: null, sets: Array.from({ length: 5 }, (_, i) => mkSet(i + 1, prefix)),
  links: [], linkSource: "auto", cached: false, persisted: false, soundcloud: "api-v2",
});

const FAKE_SC = `
(function(){
  var Events={READY:'ready',PLAY:'play',PAUSE:'pause',FINISH:'finish',PLAY_PROGRESS:'playProgress',ERROR:'error'};
  window.__built=0; window.__loads=0;
  function Widget(){
    var l={},pos=0,timer=null,activated=false,parsed=false;
    var duration=(window.__DUR||3600000);
    window.__built++;
    function emit(e,p){(l[e]||[]).forEach(function(f){f(p);});}
    function tick(){ emit(Events.PLAY_PROGRESS,{currentPosition:pos,relativePosition:pos/duration}); }
    function run(){ if(timer) return; parsed=true; emit(Events.PLAY);
      timer=setInterval(function(){ pos+=250; tick();
        if(pos>=duration){clearInterval(timer);timer=null;emit(Events.FINISH);} },250); }
    return {
      bind:function(e,cb){(l[e]=l[e]||[]).push(cb); if(e===Events.READY) setTimeout(cb,40);},
      getDuration:function(cb){cb(parsed?duration:0);},
      load:function(url,opts){ window.__loads++; window.__lastLoad=url; pos=0; activated=true;
        duration=(window.__DUR||3600000);
        if(timer){clearInterval(timer);timer=null;}
        if(opts&&opts.callback) setTimeout(opts.callback,20); },
      play:function(){ activated=true; run(); },
      pause:function(){ if(timer){clearInterval(timer);timer=null;} emit(Events.PAUSE); },
      seekTo:function(ms){ pos=ms; tick(); }
    };
  }
  Widget.Events=Events;
  window.SC={Widget:Widget};
})();
`;

const server = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1"], { stdio: "ignore" });
const shutdown = () => { try { server.kill("SIGTERM"); } catch { /* gone */ } };
process.on("exit", shutdown);
for (let a = 0; ; a += 1) {
  try { await fetch(BASE); break; } catch {
    if (a > 120) throw new Error("server never came up");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const browser = await chromium.launch({ executablePath: findChromium() });
const context = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true, isMobile: true });
const page = await context.newPage();
page.on("pageerror", (e) => log("PAGEERROR:", e.message));

const A = mkArtist("99", "Test DJ", "sc");
const B = mkArtist("98", "Slow DJ", "slow");
await page.route("**/api/events*", (r) =>
  r.fulfill({ contentType: "application/json", body: JSON.stringify({ date: "2026-08-02", events: [EVENT], count: 1 }) }));
await page.route("**/api/artist*", async (r) => {
  const id = new URL(r.request().url()).searchParams.get("id");
  if (id === "98") {
    await new Promise((res) => setTimeout(res, Number(process.env.SLOW_MS ?? 3000)));
    return r.fulfill({ contentType: "application/json", body: JSON.stringify(B) });
  }
  return r.fulfill({ contentType: "application/json", body: JSON.stringify(A) });
});
await page.route("**/w.soundcloud.com/player/**", (r) =>
  r.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub</title>" }));
await page.route("**/w.soundcloud.com/player/api.js", (r) =>
  r.fulfill({ contentType: "application/javascript", body: FAKE_SC }));
await page.route("**/images.ra.co/**", (r) => r.abort());

await page.addInitScript(() => {
  // Finds the PlayerProvider's context value on the fiber tree.
  window.__pl = () => {
    const root = document.getElementById("root");
    const key = Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
    let start = root[key];
    if (start && start.stateNode && start.stateNode.current) start = start.stateNode.current;
    const stack = [start];
    while (stack.length) {
      const f = stack.pop();
      if (!f) continue;
      const v = f.memoizedProps && f.memoizedProps.value;
      if (v && typeof v.playNext === "function" && typeof v.removeAt === "function") return v;
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    return null;
  };
});

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Test Night", { timeout: 30000 });
await page.waitForTimeout(900);

const wait = (ms = 450) => page.waitForTimeout(ms);
const snap = () =>
  page.evaluate(() => {
    const p = window.__pl();
    const bar = document.querySelector('input[aria-label="Seek"]')?.closest("div.fixed");
    const ps = bar ? [...bar.querySelectorAll("p")].map((e) => e.textContent) : [];
    return {
      ids: p.queue.map((s) => s.id),
      index: p.index,
      cur: p.current?.id ?? null,
      playing: p.playing,
      loading: p.loading,
      name: p.artistName,
      source: p.source?.label ?? null,
      position: p.position,
      loads: window.__loads,
      built: window.__built,
      title: ps[0] ?? null,
      subtitle: ps[1] ?? null,
      lock: navigator.mediaSession?.metadata ? navigator.mediaSession.metadata.artist : undefined,
      playLabel: bar?.querySelector('button[aria-label="Pause"], button[aria-label="Play"]')?.getAttribute("aria-label") ?? null,
    };
  });
const call = async (fn, ...args) => {
  await page.evaluate(([f, a]) => { window.__pl()[f](...a); }, [fn, args]);
  await wait();
};
const sets = (n, prefix = "sc") => Array.from({ length: n }, (_, i) => mkSet(i + 1, prefix));
const fresh = async (dur = 3600000) => {
  await page.evaluate((d) => { window.__DUR = d; }, dur);
  await call("stop");
};
const j = (x) => JSON.stringify(x);


page.on("request", (r) => { if (r.url().includes("/api/artist")) console.log("REQ", new Date().toISOString().slice(17,23), r.url().split("?")[1]); });
page.on("requestfinished", (r) => { if (r.url().includes("/api/artist")) console.log("DONE", new Date().toISOString().slice(17,23), r.url().split("?")[1]); });
await fresh();
await page.locator("text=Test Night").first().click();
await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
// stale-closure race
await call("stop");
await wait(300);
const t0 = Date.now();
await page.locator('button[aria-label="Add Slow DJ to the playlist"]').click();
await wait(200);
await page.locator('[role="dialog"] button:has-text("Test DJ")').first().click();
await page.waitForSelector('button[aria-label^="Pause Set sc"], button[aria-label^="Play Set sc"]', { timeout: 10000 });
await wait(600);
const r0 = await snap();
note("race: before slow add resolves", `t+${Date.now() - t0}ms ids=${j(r0.ids)}`);
await page.waitForTimeout(Number(process.env.SLOW_MS ?? 3000) + 1200);
const r1 = await snap();
note("race: after slow add resolves", `ids=${j(r1.ids)} cur=${r1.cur} name=${r1.name}`);
check("a `+` that resolves late does not replace the queue the user started meanwhile", r1.ids.every((i) => i.startsWith("sc-")) && r1.ids.length === 5, j(r1.ids));

await browser.close();
shutdown();
process.exit(0);
