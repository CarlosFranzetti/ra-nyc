/**
 * P2 follow-up: did the transient "new title + old position" commit reach a
 * painted frame? Samples every rAF (undeduped), plus commit timestamps, for the
 * FINISH auto-advance and the Next-click paths. Also measures the drag bubble at
 * default and largest text sizes.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 5502);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), ".cache", "ms-playwright")].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).filter((d) => d.startsWith("chromium"))) {
      const c = join(root, entry, "chrome-linux", "chrome");
      if (existsSync(c)) return c;
    }
  }
  throw new Error("no chromium");
}

// Stub: identical to tests/agent-p2-timeline.mjs
const FAKE_SC = `
(function(){
  var Events={READY:'ready',PLAY:'play',PAUSE:'pause',FINISH:'finish',PLAY_PROGRESS:'playProgress',ERROR:'error'};
  window.__seekLog = window.__seekLog || [];
  function Widget(iframe){
    var l={},pos=0,timer=null,duration=(window.__SC_DURATION||3600000),activated=false,parsed=false;
    function emit(e,p){(l[e]||[]).forEach(function(f){f(p);});}
    function tick(){ emit(Events.PLAY_PROGRESS,{currentPosition:pos,relativePosition:pos/duration}); }
    function run(){ if(timer) return; parsed=true; emit(Events.PLAY);
      timer=setInterval(function(){ pos+=250; tick();
        if(pos>=duration){clearInterval(timer);timer=null;emit(Events.FINISH);} },250); }
    return {
      bind:function(e,cb){(l[e]=l[e]||[]).push(cb); if(e===Events.READY) setTimeout(cb,40);},
      getDuration:function(cb){cb(parsed?duration:0);},
      load:function(url,opts){ var stale=pos; pos=0; activated=true;
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

// Every rAF frame, and every React commit that touches the bar, with timestamps.
const RECORDER = `
(function(){
  window.__frames = []; window.__commits = [];
  function state(){
    var input = document.querySelector('input[aria-label="Seek"]');
    if (!input) return null;
    var bar = input.closest('div.fixed');
    var t = bar && bar.querySelector('p.truncate');
    return { title: t ? t.textContent : null, value: input.value, max: input.max };
  }
  function start(){
    new MutationObserver(function(){
      var s = state(); if (!s) return;
      var c = window.__commits; var prev = c.length ? c[c.length-1] : null;
      if (!prev || prev.title!==s.title || prev.value!==s.value || prev.max!==s.max)
        c.push(Object.assign({t: Math.round(performance.now())}, s));
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    (function frame(){ var s = state(); if (s) window.__frames.push(Object.assign({t: Math.round(performance.now())}, s)); requestAnimationFrame(frame); })();
  }
  if (document.documentElement) start(); else document.addEventListener('readystatechange', start, {once:true});
})();`;

const EVENT = { id: "1", title: "Test Night", date: "2026-08-02T00:00:00.000", startTime: "2026-08-02T22:00:00.000", endTime: "2026-08-03T04:00:00.000", url: "https://ra.co/events/1", imageUrl: "https://images.ra.co/x.jpg", venue: { name: "Nowadays", area: "New York" }, artists: [{ id: "99", name: "Test DJ" }], attending: 100, isPick: false, pickBlurb: null };
const mkSet = (n) => ({ provider: "soundcloud", id: `sc-${n}`, title: `Set Number ${n}`, url: `https://soundcloud.com/test/${n}`, embedUrl: `https://w.soundcloud.com/player/?url=x${n}&auto_play=false`, duration: 2400, plays: 1000 * n, createdAt: null, artwork: null });
const ARTIST = { id: "99", name: "Test DJ", mixcloudUser: null, mixcloudUrl: null, soundcloudUser: "test", soundcloudUrl: "https://soundcloud.com/test", raUrl: null, bio: null, sets: Array.from({ length: 9 }, (_, i) => mkSet(i + 1)), links: [], linkSource: "auto", cached: false, persisted: false, soundcloud: "api-v2" };

const server = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1"], { stdio: "ignore" });
const shutdown = () => { try { server.kill("SIGTERM"); } catch {} };
process.on("exit", shutdown);
for (let a = 0; ; a++) { try { await fetch(BASE); break; } catch { if (a > 80) throw new Error("no vite"); await sleep(250); } }

const browser = await chromium.launch({ executablePath: findChromium() });
const context = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true, isMobile: true });

async function openPlayer(durationMs) {
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.addInitScript(`window.__SC_DURATION = ${durationMs};`);
  await page.addInitScript(RECORDER);
  await page.route("**/api/events*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ date: "2026-08-02", events: [EVENT], count: 1 }) }));
  await page.route("**/api/artist*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(ARTIST) }));
  await page.route("**/w.soundcloud.com/player/**", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub</title>" }));
  await page.route("**/w.soundcloud.com/player/api.js", (r) => r.fulfill({ contentType: "application/javascript", body: FAKE_SC }));
  await page.route("**/images.ra.co/**", (r) => r.abort());
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Test Night", { timeout: 20000 });
  await page.waitForTimeout(900);
  await page.locator("text=Test Night").first().click();
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  await page.locator('[role="dialog"] button:has-text("Test DJ")').first().click();
  await page.waitForSelector('input[aria-label="Seek"]', { timeout: 8000 });
  return page;
}

/** Summarise one track change: commits and painted frames (title new, value old). */
async function transition(page, fromTitle, toTitle, sinceCommit, sinceFrame) {
  const commits = await page.evaluate((s) => window.__commits.slice(s), sinceCommit);
  const frames = await page.evaluate((s) => window.__frames.slice(s), sinceFrame);
  const firstNew = commits.findIndex((c) => c.title === toTitle);
  const newCommits = commits.filter((c) => c.title === toTitle);
  const t0 = newCommits[0]?.t;
  const painted = frames.filter((f) => f.title === toTitle);
  console.log(`  ${fromTitle} -> ${toTitle}`);
  console.log(`    commits (t, title, value, max):`);
  for (const c of commits.slice(Math.max(0, firstNew - 1), firstNew + 4)) console.log(`      ${c.t}  ${c.title}  v=${c.value}  max=${c.max}`);
  console.log(`    rAF frames showing ${toTitle}: ${painted.length}`);
  for (const f of painted.slice(0, 4)) console.log(`      frame t=${f.t}  v=${f.value} max=${f.max}`);
  const paintedOld = painted.filter((f) => Number(f.value) > 1);
  console.log(`    painted frames with new title and old position (v>1): ${paintedOld.length}`);
  return { t0, paintedOld: paintedOld.length };
}

// Auto-advance at FINISH.
{
  console.log("== A: FINISH auto-advance (4s tracks) ==");
  const page = await openPlayer(4000);
  for (let i = 0; i < 80; i++) { if (await page.evaluate(() => window.__commits.some((c) => c.title === "Set Number 2"))) break; await sleep(100); }
  await sleep(500);
  const r = await transition(page, "Set Number 1", "Set Number 2", 0, 0);
  // Next click on set 2 at a mid-track position.
  await sleep(1300);
  const cBefore = await page.evaluate(() => window.__commits.length);
  const fBefore = await page.evaluate(() => window.__frames.length);
  await page.locator('button[aria-label="Next mix"]').click();
  await sleep(800);
  console.log("== B: Next click (discrete) ==");
  const r2 = await transition(page, "Set Number 2", "Set Number 3", cBefore, fBefore);
  console.log("RESULT auto-advance painted-old-position frames:", r.paintedOld, " next-click:", r2.paintedOld);
  await page.close();
}

// Bubble geometry at default and largest text, 2h track.
{
  console.log("== C: drag bubble geometry ==");
  const page = await openPlayer(7200000);
  await sleep(600);
  const measure = (label) =>
    page.evaluate(([label]) => {
      const input = document.querySelector('input[aria-label="Seek"]');
      const bar = input.closest("div.fixed");
      const b = bar.querySelector("span.bg-secondary");
      const r = b.getBoundingClientRect(), br = bar.getBoundingClientRect(), ir = input.getBoundingClientRect();
      return { label, fontPx: parseFloat(getComputedStyle(b).fontSize), bubbleTop: Math.round(r.top), bubbleBottom: Math.round(r.bottom), barTop: Math.round(br.top), bubbleGapAboveBar: +(br.top - r.bottom).toFixed(1), height: Math.round(r.height), thumbTopApprox: Math.round(ir.top) };
    }, [label]);
  const setDrag = () => page.evaluate(() => {
    const el = document.querySelector('input[aria-label="Seek"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "3700");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await setDrag();
  await sleep(80);
  console.log(JSON.stringify(await measure("default text")));
  await page.evaluate(() => document.documentElement.classList.add("text-size-5"));
  await sleep(150); await setDrag(); await sleep(80);
  console.log(JSON.stringify(await measure("text-size-5 only")));
  await page.evaluate(() => document.documentElement.classList.add("type-late"));
  await sleep(150); await setDrag(); await sleep(80);
  console.log(JSON.stringify(await measure("text-size-5 + type-late")));
  await page.close();
}

await context.close();
await browser.close();
shutdown();
console.log("probe done");
