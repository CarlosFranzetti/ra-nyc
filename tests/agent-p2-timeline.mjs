/**
 * P2 probe: timeline (position / duration / seek / scrubber).
 * Investigation only. Drives the same fake SoundCloud widget as player.e2e.mjs,
 * with a configurable track length and a DOM-commit recorder on the bar.
 * Run: E2E_PORT=5502 node tests/agent-p2-timeline.mjs | tail -120
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 5502);
const BASE = `http://127.0.0.1:${PORT}`;
const log = (tag, name, detail = "") =>
  console.log(`${tag.padEnd(5)} ${name}${detail !== "" ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
const check = (name, pass, detail = "") => log(pass ? "PASS" : "FAIL", name, detail);
const obs = (name, detail = "") => log("OBS", name, detail);

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), ".cache", "ms-playwright")].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).filter((d) => d.startsWith("chromium"))) {
      const candidate = join(root, entry, "chrome-linux", "chrome");
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error("no chromium");
}

// Same stub as player.e2e.mjs, plus: configurable length (window.__SC_DURATION),
// a seekTo log, and a load log.
const FAKE_SC = `
(function(){
  var Events={READY:'ready',PLAY:'play',PAUSE:'pause',FINISH:'finish',PLAY_PROGRESS:'playProgress',ERROR:'error'};
  window.__built = window.__built || 0;
  window.__seekLog = window.__seekLog || [];
  window.__loadLog = window.__loadLog || [];
  function Widget(iframe){
    var l={},pos=0,timer=null,duration=(window.__SC_DURATION||3600000),activated=false,parsed=false;
    window.__built++;
    function emit(e,p){(l[e]||[]).forEach(function(f){f(p);});}
    function tick(){ emit(Events.PLAY_PROGRESS,{currentPosition:pos,relativePosition:pos/duration}); }
    function run(){ if(timer) return; parsed=true; emit(Events.PLAY);
      timer=setInterval(function(){ pos+=250; tick();
        if(pos>=duration){clearInterval(timer);timer=null;emit(Events.FINISH);} },250); }
    return {
      bind:function(e,cb){(l[e]=l[e]||[]).push(cb); if(e===Events.READY) setTimeout(cb,40);},
      getDuration:function(cb){cb(parsed?duration:0);},
      load:function(url,opts){ var stale=pos; pos=0; activated=true; window.__loadLog.push(url);
        setTimeout(function(){ emit(Events.PLAY_PROGRESS,{currentPosition:stale,relativePosition:stale/duration}); },5);
        if(opts&&opts.callback) setTimeout(opts.callback,20); },
      play:function(){ if(!activated){ activated=true; run(); return; } run(); },
      pause:function(){ if(timer){clearInterval(timer);timer=null;} emit(Events.PAUSE); },
      seekTo:function(ms){ window.__seekLog.push(ms); pos=ms; tick(); }
    };
  }
  Widget.Events=Events;
  window.SC={Widget:Widget};
})();`;

// Records every distinct (title, value, max, aria) state the bar presents, from
// two sources: MutationObserver (every React commit) and rAF (every painted frame).
const RECORDER = `
(function(){
  window.__timeline = [];
  var last = null;
  function read(src){
    var input = document.querySelector('input[aria-label="Seek"]');
    if (!input) return;
    var bar = input.closest('div.fixed');
    var titleEl = bar && bar.querySelector('p.truncate');
    var s = { title: titleEl ? titleEl.textContent : null, value: input.value, max: input.max, aria: input.getAttribute('aria-valuetext') };
    if (!last || last.title !== s.title || last.value !== s.value || last.max !== s.max || last.aria !== s.aria) {
      last = s;
      window.__timeline.push(Object.assign({ t: Math.round(performance.now()), src: src }, s));
    }
  }
  function start(){
    new MutationObserver(function(){ read('mut'); }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    (function frame(){ read('raf'); requestAnimationFrame(frame); })();
  }
  if (document.documentElement) start(); else document.addEventListener('readystatechange', start, { once: true });
})();`;

const EVENT = {
  id: "1", title: "Test Night", date: "2026-08-02T00:00:00.000",
  startTime: "2026-08-02T22:00:00.000", endTime: "2026-08-03T04:00:00.000",
  url: "https://ra.co/events/1", imageUrl: "https://images.ra.co/x.jpg",
  venue: { name: "Nowadays", area: "New York" }, artists: [{ id: "99", name: "Test DJ" }],
  attending: 100, isPick: false, pickBlurb: null,
};
const mkSet = (n) => ({
  provider: "soundcloud", id: `sc-${n}`, title: `Set Number ${n}`,
  url: `https://soundcloud.com/test/${n}`,
  embedUrl: `https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Ftest%2F${n}&auto_play=false`,
  duration: 2400, plays: 1000 * n, createdAt: null, artwork: null,
});
const ARTIST = {
  id: "99", name: "Test DJ", mixcloudUser: null, mixcloudUrl: null, soundcloudUser: "test",
  soundcloudUrl: "https://soundcloud.com/test", raUrl: null, bio: null,
  sets: Array.from({ length: 9 }, (_, i) => mkSet(i + 1)), links: [], linkSource: "auto",
  cached: false, persisted: false, soundcloud: "api-v2",
};

const server = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1"], { stdio: "ignore" });
const shutdown = () => { try { server.kill("SIGTERM"); } catch {} };
process.on("exit", shutdown);
for (let attempt = 0; ; attempt += 1) {
  try { await fetch(BASE); break; } catch {
    if (attempt > 80) throw new Error("Dev server never came up");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const browser = await chromium.launch({ executablePath: findChromium() });
const context = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true, isMobile: true });

async function openPlayer(durationMs) {
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.addInitScript(`window.__SC_DURATION = ${durationMs};`);
  await page.addInitScript(RECORDER);
  await page.route("**/api/events*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ date: "2026-08-02", events: [EVENT], count: 1 }) }));
  await page.route("**/api/artist*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(ARTIST) }));
  await page.route("**/w.soundcloud.com/player/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub</title>" }));
  await page.route("**/w.soundcloud.com/player/api.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: FAKE_SC }));
  await page.route("**/images.ra.co/**", (route) => route.abort());
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Test Night", { timeout: 20000 });
  await page.waitForTimeout(900);
  await page.locator("text=Test Night").first().click();
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  await page.locator('[role="dialog"] button:has-text("Test DJ")').first().click();
  await page.waitForSelector('input[aria-label="Seek"]', { timeout: 8000 });
  return page;
}

const snap = (page) =>
  page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Seek"]');
    if (!input) return null;
    const bar = input.closest("div.fixed");
    const bubble = bar && bar.querySelector("span.bg-secondary");
    return {
      title: bar?.querySelector("p.truncate")?.textContent ?? null,
      value: input.value, max: input.max, disabled: input.disabled,
      aria: input.getAttribute("aria-valuetext"),
      bubble: bubble ? bubble.textContent : null,
    };
  });

/** Sets the range the way a finger would: input event, then optionally pointerup. */
const setRange = (page, v, commit = true) =>
  page.evaluate(([v, commit]) => {
    const el = document.querySelector('input[aria-label="Seek"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    if (commit) el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }, [v, commit]);

const seekCount = (page) => page.evaluate(() => window.__seekLog.length);
const seekLast = (page) => page.evaluate(() => window.__seekLog.at(-1) ?? null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Phase 1: 2h track — late duration, h:mm:ss, drag, seek(0), 90% then next ──
{
  console.log("\n== Phase 1: 2h track ==");
  const page = await openPlayer(7200000);
  // Wait for the widget's duration to land.
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => window.__timeline.some((e) => e.max === "7200"))) break;
    await sleep(100);
  }
  const maxSeq = await page.evaluate(() => {
    const out = []; for (const e of window.__timeline) if (!out.length || out.at(-1) !== e.max) out.push(e.max); return out;
  });
  obs("max attr over time (seed 2400, widget 7200)", maxSeq);
  check("duration arrives late: max goes 2400 -> 7200", JSON.stringify(maxSeq.slice(0, 2)) === '["2400","7200"]' || maxSeq.includes("7200"), maxSeq);

  await setRange(page, 3700, false);
  const dragging = await snap(page);
  obs("bubble while dragging to 3700 (no pointerup)", dragging);
  check("bubble reads h:mm:ss while dragging", /^1:01:4\d \/ 2:00:00$/.test(dragging.bubble ?? ""), dragging.bubble);

  const before = await seekCount(page);
  for (let i = 0; i < 12; i++) await setRange(page, 3700 + i * 90, false);
  check("no seek per tick while dragging (12 input events)", (await seekCount(page)) === before, `seeks during drag: ${(await seekCount(page)) - before}`);

  await setRange(page, 3900, true);
  await sleep(150);
  check("pointerup commits exactly one seek", (await seekCount(page)) === before + 1, `last seek ${await seekLast(page)} ms`);
  const afterCommit = await snap(page);
  check("bubble gone after commit", afterCommit.bubble === null, afterCommit.bubble);

  await setRange(page, 0, true);
  await sleep(300);
  const zero = await snap(page);
  check("seek(0) commits and reads 0:00", /^0:0\d of 2:00:00$/.test(zero.aria ?? ""), zero.aria);

  await setRange(page, 6480, true);
  await sleep(400);
  const ninety = await snap(page);
  obs("after seek to 6480 (90%)", ninety);
  check("90% reads 1:48:xx of 2:00:00", /^1:48:\d\d of 2:00:00$/.test(ninety.aria ?? ""), ninety.aria);

  const seeksBeforeNext = await seekCount(page);
  const loadsBefore = await page.evaluate(() => window.__loadLog.length);
  const tlStart = await page.evaluate(() => window.__timeline.length);
  await page.locator('button[aria-label="Next mix"]').click();
  await sleep(900);
  const after = await snap(page);
  const tl = await page.evaluate((s) => window.__timeline.slice(s), tlStart);
  const nextTrackStates = tl.filter((e) => e.title === "Set Number 2");
  obs("states shown for Set Number 2 after Next from 90%", nextTrackStates.map((e) => `${e.src} v=${e.value} max=${e.max} aria=${e.aria}`));
  const flash = nextTrackStates.filter((e) => Number(e.value) > 1);
  check("next from 90%: no frame shows old position for the new track", flash.length === 0, flash.length ? JSON.stringify(flash.slice(0, 3)) : "none");
  check("next from 90%: new track reads 0:0x", /^0:0\d of 2:00:00$/.test(after.aria ?? ""), after.aria);
  check("next from 90%: title is Set Number 2", after.title === "Set Number 2", after.title);
  check("next from 90%: no seek issued by the UI", (await seekCount(page)) === seeksBeforeNext);
  check("next from 90%: widget loaded set 2", (await page.evaluate(() => window.__loadLog.length)) === loadsBefore + 1);

  // Keyboard: arrows change on keydown, commit on keyup.
  await page.focus('input[aria-label="Seek"]');
  const kBefore = await seekCount(page);
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  await sleep(100);
  const kDown = await snap(page);
  obs("keyboard: 3x ArrowRight held (keydown only)", kDown);
  check("keyboard: no seek before keyup", (await seekCount(page)) === kBefore);
  await page.keyboard.up("ArrowRight");
  await sleep(150);
  check("keyboard: one seek on keyup", (await seekCount(page)) === kBefore + 1, `last ${await seekLast(page)} ms`);

  // Pointer leaves the input before releasing (mouse, desktop-style drag).
  const box = await page.locator('input[aria-label="Seek"]').boundingBox();
  const pBefore = await seekCount(page);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await sleep(120);
  const pDown = await snap(page);
  await page.mouse.move(4, 4, { steps: 5 });
  await page.mouse.up();
  await sleep(250);
  const pAfter = await snap(page);
  const v1 = await snap(page); await sleep(1000); const v2 = await snap(page);
  obs("pointer released outside input: bubble after release", pAfter.bubble);
  obs("pointer released outside input: seeks issued", (await seekCount(page)) - pBefore);
  obs("pointer released outside input: value 1s apart (playhead moving?)", { a: v1.value, b: v2.value, aria: v2.aria });
  check("pointer released outside input still commits (no stuck scrubbing)", pAfter.bubble === null && (await seekCount(page)) > pBefore,
    { bubbleAfterRelease: pAfter.bubble, seeks: (await seekCount(page)) - pBefore, downBubble: pDown.bubble });

  // Large text: whole-app text-size-5 + type-late (largest rungs).
  await page.evaluate(() => document.documentElement.classList.add("text-size-5", "type-late"));
  await sleep(200);
  await setRange(page, 3700, false);
  await sleep(100);
  const big = await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Seek"]');
    const bar = input.closest("div.fixed");
    const b = bar.querySelector("span.bg-secondary");
    const r = b.getBoundingClientRect(), br = bar.getBoundingClientRect();
    return { font: getComputedStyle(b).fontSize, bubble: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
      barTop: Math.round(br.top), vw: window.innerWidth, text: b.textContent, overflowX: b.scrollWidth > b.clientWidth };
  });
  obs("largest text: bubble geometry", big);
  check("largest text: bubble fully on screen", big.bubble[0] >= 0 && big.bubble[2] <= big.vw && big.bubble[1] >= 0,
    `bubble ${big.bubble} vw ${big.vw}`);
  await setRange(page, 3700, true);
  await page.evaluate(() => document.documentElement.classList.remove("text-size-5", "type-late"));

  // Lift the tap-through limits: the e2e suite closes the bar here.
  await page.locator('button[aria-label="Close player"]').click();
  await page.close();
}

// ─── Phase 2: auto-advance at FINISH (non-discrete) vs Next click (discrete) ──
{
  console.log("\n== Phase 2: 4s track, FINISH auto-advance vs Next click ==");
  const page = await openPlayer(4000);
  // Let set 1 play to its end and advance on its own.
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate(() => window.__timeline.some((e) => e.title === "Set Number 2"))) break;
    await sleep(100);
  }
  await sleep(600);
  const tl = await page.evaluate(() => window.__timeline);
  const idx = tl.findIndex((e) => e.title === "Set Number 2");
  const window_ = tl.slice(Math.max(0, idx - 3), idx + 4);
  obs("auto-advance: timeline around the title change", window_.map((e) => `${e.t} ${e.src} title=${e.title} v=${e.value} max=${e.max}`));
  const firstNew = tl.filter((e) => e.title === "Set Number 2");
  const painted = firstNew.filter((e) => Number(e.value) > 1);
  check("auto-advance: new title never paired with old end position", painted.length === 0,
    painted.length ? `${painted.length} states, first: ${painted[0].src} v=${painted[0].value} max=${painted[0].max}` : "none");
  // Next click from mid-track on set 2.
  await sleep(1200);
  const tlStart = (await page.evaluate(() => window.__timeline)).length;
  const pre = await snap(page);
  await page.locator('button[aria-label="Next mix"]').click();
  await sleep(900);
  const tl2 = (await page.evaluate((s) => window.__timeline.slice(s), tlStart));
  const set3 = tl2.filter((e) => e.title === "Set Number 3");
  obs(`next click at v=${pre.value}: states for Set Number 3`, set3.map((e) => `${e.src} v=${e.value} max=${e.max}`));
  check("next click: new track never paired with old position", set3.every((e) => Number(e.value) <= 1),
    set3.map((e) => e.value).join(","));
  await page.close();
}

await context.close();
await browser.close();
shutdown();
console.log("\nprobe done");
