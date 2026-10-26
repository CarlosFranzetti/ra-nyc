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

// ───────────────────────── T1: removeAt(0) while playing index 2
log("\n== T1 removeAt(i < index)");
await fresh();
await call("playSets", sets(5), 2, "Alice");
await wait(900);
let s0 = await snap();
check("precondition: playing sc-3 at index 2", s0.cur === "sc-3" && s0.index === 2 && s0.playing, j(s0));
await call("removeAt", 0);
let s1 = await snap();
check("current unchanged after removeAt(0)", s1.cur === "sc-3", `cur=${s1.cur}`);
check("index decremented to 1", s1.index === 1, `index=${s1.index}`);
check("queue is 4 long", s1.ids.length === 4, j(s1.ids));
check("no reload of the player (loads/built unchanged)", s1.loads === s0.loads && s1.built === s0.built, `loads ${s0.loads}->${s1.loads} built ${s0.built}->${s1.built}`);
check("still playing", s1.playing, `playing=${s1.playing}`);

// ───────────────────────── T2: removeAt(live) incl. at end
log("\n== T2 removeAt(live)");
// queue now sc-2..sc-5, index 1 (sc-3)
await call("jumpTo", 3);
await wait(700);
let t2a = await snap();
check("precondition: jumped to last (sc-5), playing", t2a.cur === "sc-5" && t2a.index === 3 && t2a.playing, j(t2a));
await call("toggle");
await wait();
let t2b = await snap();
check("paused before removing live row", t2b.playing === false, `playing=${t2b.playing}`);
await call("removeAt", 3);
await wait(700);
let t2c = await snap();
note("removeAt(last===index) result", `ids=${j(t2c.ids)} index=${t2c.index} cur=${t2c.cur} playing=${t2c.playing} loads ${t2b.loads}->${t2c.loads}`);
check("removing live+last falls back to previous set", t2c.cur === "sc-4" && t2c.index === 2, `cur=${t2c.cur}`);
check("it does NOT autoplay when user had paused", t2c.playing === false && t2c.loads === t2b.loads, `playing=${t2c.playing} loads=${t2c.loads}`);

// middle live remove
await call("jumpTo", 0); await wait(700);
const before = await snap();
await call("removeAt", 0); await wait(700);
const after = await snap();
note("removeAt(live, middle)", `before cur=${before.cur} -> after cur=${after.cur} index=${after.index} playing=${after.playing} loads ${before.loads}->${after.loads}`);

// removing only set
await fresh();
await call("playSets", sets(1), 0, "Solo"); await wait(700);
await call("removeAt", 0); await wait();
const solo = await snap().catch((e) => ({ err: String(e) }));
check("removing the only set stops and clears the bar", (await page.locator('input[aria-label="Seek"]').count()) === 0, j(solo));

// ───────────────────────── T3: enqueue dedupe
log("\n== T3 enqueue dedupe");
await fresh();
await call("playSets", sets(5), 2, "Alice"); await wait(700);
await call("enqueue", [mkSet(3)], "Alice");
let e1 = await snap();
check("enqueue(current) leaves count at 5", e1.ids.length === 5, j(e1.ids));
await call("enqueue", [mkSet(1)], "Alice");
let e2 = await snap();
check("enqueue(set already played earlier in queue) leaves count at 5 (silent drop)", e2.ids.length === 5, j(e2.ids));
await call("enqueue", [mkSet(6)], "Bob");
await call("enqueue", [mkSet(6)], "Bob");
let e3 = await snap();
check("enqueue(new) twice adds once", e3.ids.length === 6, j(e3.ids));
check("enqueue never changes current/index", e3.cur === "sc-3" && e3.index === 2, `cur=${e3.cur} idx=${e3.index}`);
// url-keyed dedupe with a different id
await call("enqueue", [{ ...mkSet(2), id: "other-id" }], "Alice");
let e4 = await snap();
check("same url, different id is deduped", e4.ids.length === 6, j(e4.ids));

// ───────────────────────── T4: playNext
log("\n== T4 playNext");
await fresh();
await call("playSets", sets(5), 1, "Alice"); await wait(700);
const X = mkSet(7);
await call("playNext", X, "Xavier");
let p1 = await snap();
await call("playNext", X, "Xavier");
let p2 = await snap();
check("playNext(X) inserts right after current and jumps", j(p1.ids) === j(["sc-1", "sc-2", "sc-7", "sc-3", "sc-4", "sc-5"]) && p1.index === 2, `${j(p1.ids)} idx=${p1.index}`);
check("playNext(X) twice -> single insertion", p2.ids.length === 6 && p2.index === 2, `${j(p2.ids)} idx=${p2.index}`);
await call("playNext", mkSet(5), "Alice");
let p3 = await snap();
check("playNext(set queued later) moves it (no dup further down)", j(p3.ids) === j(["sc-1", "sc-2", "sc-7", "sc-5", "sc-3", "sc-4"]) && p3.index === 3, `${j(p3.ids)} idx=${p3.index}`);
await call("playNext", mkSet(1), "Alice");
let p4 = await snap();
note("playNext(set queued EARLIER than current)", `${j(p4.ids)} idx=${p4.index}  (earlier copy is kept -> same set twice in queue)`);
check("playNext(earlier copy) keeps queue free of duplicate keys", new Set(p4.ids).size === p4.ids.length, j(p4.ids));

// ───────────────────────── T5: within-batch dedupe
log("\n== T5 enqueue batch dedupe (addNight b2b case)");
await fresh();
await call("playSets", sets(3), 0, "Alice"); await wait(700);
const Z = mkSet(8); const W = mkSet(9);
await call("enqueue", [Z, { ...Z }, W], null);
let b1 = await snap();
check("non-empty queue: enqueue([Z,Z,W]) adds Z once", b1.ids.filter((i) => i === "sc-8").length === 1, j(b1.ids));
await fresh();
await call("enqueue", [Z, { ...Z }, W], null);
let b2 = await snap();
check("empty queue: enqueue([Z,Z,W]) starts with Z once", b2.ids.filter((i) => i === "sc-8").length === 1, j(b2.ids));

// ───────────────────────── T6: adjacent same-id entries stall
log("\n== T6 FINISH handling");
await fresh(2000);
await call("playSets", [mkSet(1), mkSet(2)], 0, "Alice");
await wait(4200);
let f1 = await snap();
check("baseline [S,T]: advances to T after S finishes and loads it", f1.index === 1 && f1.cur === "sc-2" && f1.loads >= 1, j(f1));
await wait(2800);
let f2 = await snap();
note("after LAST set finishes", `index=${f2.index} cur=${f2.cur} playing=${f2.playing} button=${f2.playLabel} position=${f2.position} subtitle="${f2.subtitle}"`);
await call("enqueue", [mkSet(3)], "Alice");
await wait(1500);
let f3 = await snap();
note("enqueue(T) after queue finished", `ids=${j(f3.ids)} index=${f3.index} cur=${f3.cur} playing=${f3.playing} loads ${f2.loads}->${f3.loads}`);
check("enqueue after the queue finished starts the new set (doc: 'with nothing playing it starts')", f3.cur === "sc-3" && f3.loads > f2.loads, `cur=${f3.cur}`);

await fresh(2000);
await call("playSets", [mkSet(1), mkSet(1), mkSet(2)], 0, "Alice");
await wait(1200);
const d0 = await snap();
await wait(3200);
const d1 = await snap();
note("duplicate-id queue [S,S,T] after S ends", `index=${d1.index} cur=${d1.cur} playing=${d1.playing} position=${d1.position} loads ${d0.loads}->${d1.loads}`);
await wait(2500);
const d2 = await snap();
check("[S,S,T]: second S actually loads/plays (loads incremented)", d1.loads > d0.loads, `loads ${d0.loads}->${d1.loads}`);
check("[S,S,T]: reaches T eventually", d2.cur === "sc-2", `cur=${d2.cur} index=${d2.index} playing=${d2.playing}`);

// ───────────────────────── T7/T8: artistName + source are per-queue
log("\n== T7 artistName / source per queue");
await fresh();
const party = { label: "Test Night", url: "https://ra.co/events/1" };
await call("playSets", [mkSet(1, "a")], 0, "Alice", party);
await call("appendSets", [mkSet(1, "b")]);
await call("enqueue", [mkSet(1, "c")], "Carol");
await call("jumpTo", 0); await wait(600);
const n0 = await snap();
await call("jumpTo", 1); await wait(600);
const n1 = await snap();
await call("jumpTo", 2); await wait(600);
const n2 = await snap();
note("bar subtitle per track", `[0] "${n0.subtitle}" | [1] "${n1.subtitle}" | [2] "${n2.subtitle}"`);
note("lock-screen artist per track", `[0] ${n0.lock} | [1] ${n1.lock} | [2] ${n2.lock}`);
check("track 1 (appended, other DJ) is NOT labelled with first DJ's name", !/Alice/.test(n1.subtitle ?? ""), n1.subtitle);
check("track 2 (enqueue name='Carol') shows Carol", /Carol/.test(n2.subtitle ?? ""), n2.subtitle);
await call("playNext", mkSet(1, "d"), "Dave");
await call("jumpTo", 0); await wait(600);
const n3 = await snap();
note("after playNext(.., 'Dave'), first track subtitle", `"${n3.subtitle}"`);
check("playNext(name) does not relabel other tracks", /Alice/.test(n3.subtitle ?? ""), n3.subtitle);

// ───────────────────────── UI: opening an artist replaces a built playlist; stale enqueue race
log("\n== T10/T9 UI interactions");
await fresh();
await page.locator("text=Test Night").first().click();
await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
await call("playSets", sets(3, "mine"), 0, "Custom");
await wait(700);
const u0 = await snap();
await page.locator('[role="dialog"] button:has-text("Test DJ")').first().click();
await page.waitForSelector('button[aria-label^="Pause Set sc"], button[aria-label^="Play Set sc"]', { timeout: 10000 });
await wait(900);
const u1 = await snap();
check("opening an artist sheet keeps the playlist that was built", j(u1.ids) === j(u0.ids), `${j(u0.ids)} -> ${j(u1.ids)}`);

// stale-closure race
await page.locator('button[aria-label="Back to event"]').click();
await wait(700);
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
