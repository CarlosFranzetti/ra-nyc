/**
 * L3 probe, part B: panel state across a stop, the queue-of-one to two
 * transition, and the transport row when the Tickets chip appears.
 *
 * Investigation only. Run with:
 *   E2E_PORT=5514 node tests/agent-l3-playlist-b.mjs | tail -60
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 5514);
const BASE = `http://127.0.0.1:${PORT}`;
const DELAY_SECOND_DJ = 4000;

const obs = (name, value) => console.log(`OBS   ${name}: ${JSON.stringify(value)}`);
const check = (name, pass, detail = "") =>
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);

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
  throw new Error("No Chromium found");
}

const EVENT = {
  id: "1",
  title: "Test Night",
  date: "2026-08-02T00:00:00.000",
  startTime: "2026-08-02T22:00:00.000",
  endTime: "2026-08-03T04:00:00.000",
  url: "https://ra.co/events/1",
  imageUrl: "https://images.ra.co/x.jpg",
  venue: { name: "Nowadays", area: "New York" },
  artists: [
    { id: "99", name: "Test DJ" },
    { id: "100", name: "Second DJ" },
  ],
  attending: 100,
  isPick: false,
  pickBlurb: null,
};
const mkSet = (prefix, n, base) => ({
  provider: "soundcloud",
  id: `${prefix}-${n}`,
  title: `${base} ${n}`,
  url: `https://soundcloud.com/${prefix}/${n}`,
  embedUrl: `https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2F${prefix}%2F${n}&auto_play=false`,
  duration: 2400,
  plays: 1000 * n,
  createdAt: null,
  artwork: null,
});
const artistFixture = (id, name, handle, prefix, base, count) => ({
  id, name, mixcloudUser: null, mixcloudUrl: null, soundcloudUser: handle,
  soundcloudUrl: `https://soundcloud.com/${handle}`, raUrl: null, bio: null,
  sets: Array.from({ length: count }, (_, i) => mkSet(prefix, i + 1, base)),
  links: [], linkSource: "auto", cached: false, persisted: false, soundcloud: "api-v2",
});
const ARTIST = artistFixture("99", "Test DJ", "test", "test", "Set Number", 9);
const ARTIST2 = artistFixture("100", "Second DJ", "second", "second", "Second Set", 9);

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
      getDuration:function(cb){cb(parsed?duration:0);},
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

const server = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1"], { stdio: "ignore" });
const shutdown = () => { try { server.kill("SIGTERM"); } catch { /* gone */ } };
process.on("exit", shutdown);
for (let attempt = 0; ; attempt += 1) {
  try { await fetch(BASE); break; } catch {
    if (attempt > 80) throw new Error("Dev server never came up");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const browser = await chromium.launch({ executablePath: findChromium() });
const context = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true, isMobile: true });

// Context-level routes so a fresh page (control run) gets the same stubs.
await context.route("**/api/events*", (route) =>
  route.fulfill({ contentType: "application/json", body: JSON.stringify({ date: "2026-08-02", events: [EVENT], count: 1 }) }),
);
await context.route("**/api/artist*", async (route) => {
  const url = route.request().url();
  if (url.includes("id=100")) {
    await new Promise((r) => setTimeout(r, DELAY_SECOND_DJ));
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(ARTIST2) });
  }
  return route.fulfill({ contentType: "application/json", body: JSON.stringify(ARTIST) });
});
await context.route("**/w.soundcloud.com/player/**", (route) =>
  route.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub</title>" }),
);
await context.route("**/w.soundcloud.com/player/api.js", (route) =>
  route.fulfill({ contentType: "application/javascript", body: FAKE_SC }),
);
await context.route("**/images.ra.co/**", (route) => route.abort());

const listButton = (page) => page.locator('button[aria-label="Show playlist"], button[aria-label="Hide playlist"]').first();
const subtitle = (page) => page.locator(".player-live div.mx-1 p").nth(1).textContent().then((t) => (t ?? "").trim()).catch(() => null);
const panelRendered = (page) => page.evaluate(() => document.querySelector('[aria-label="Playlist"]') !== null);
const buttonLabel = (page) =>
  page.locator('button[aria-label="Show playlist"], button[aria-label="Hide playlist"]').first()
    .getAttribute("aria-label").catch(() => null);

const closeSheets = async (page) => {
  for (let i = 0; i < 3; i += 1) {
    const back = page.locator('button[aria-label="Back to event"]');
    if (await back.count()) await back.click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    if ((await page.locator('[role="dialog"]').count()) === 0) break;
  }
};

const bootPage = async () => {
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Test Night", { timeout: 20000 });
  await page.waitForTimeout(900);
  return page;
};

// ─── Session A: open the panel on a catalogue, then Close player ───────────

const pageA = await bootPage();
await pageA.locator("text=Test Night").first().click();
await pageA.waitForSelector('[role="dialog"]', { timeout: 8000 });
await pageA.locator('[role="dialog"] button:has-text("Test DJ")').first().click();
await pageA.waitForSelector('button[aria-label="Pause Set Number 1"]', { timeout: 8000 });
await closeSheets(pageA);
await listButton(pageA).click();
await pageA.waitForTimeout(300);
obs("A: panel open before Close player", { rendered: await panelRendered(pageA), label: await buttonLabel(pageA) });
await pageA.locator('button[aria-label="Close player"]').click();
await pageA.waitForTimeout(500);
obs("A: bar after Close player", { seekCount: await pageA.locator('input[aria-label="Seek"]').count() });

// ─── Session B: preview the night, second DJ resolves 4s late ─────────────

await pageA.locator("text=Test Night").first().click();
await pageA.waitForSelector('[role="dialog"]', { timeout: 8000 });
await pageA.locator('button:has-text("Preview the night")').first().click();
await pageA.waitForSelector('input[aria-label="Seek"]', { timeout: 15000 });
await pageA.waitForTimeout(1200);
const queueOfOne = {
  subtitle: await subtitle(pageA),
  panelRendered: await panelRendered(pageA),
  listButton: await buttonLabel(pageA),
};
obs("B: queue of one, second DJ still resolving", queueOfOne);
check("B: no list button while the queue is one", queueOfOne.listButton === null);

// Layout while the queue is one: title width with no list button, no chip.
const rowLayout = (page) =>
  page.evaluate(() => {
    const row = document.querySelector(".player-live div.shell.flex");
    const title = document.querySelector(".player-live div.mx-1 p");
    return {
      title: Math.round(title.getBoundingClientRect().width),
      children: [...row.children].map((c) => ({
        tag: c.tagName,
        cls: (c.className?.baseVal ?? c.className ?? "").toString().slice(0, 40),
        left: Math.round(c.getBoundingClientRect().left),
        w: Math.round(c.getBoundingClientRect().width),
      })),
    };
  });
obs("B: transport row, queue of one", await rowLayout(pageA));

let regrew = false;
for (let i = 0; i < 60 && !regrew; i += 1) {
  regrew = (await listButton(pageA).count()) > 0;
  if (!regrew) await pageA.waitForTimeout(250);
}
await pageA.waitForTimeout(600);
const afterRegrow = {
  subtitle: await subtitle(pageA),
  panelRendered: await panelRendered(pageA),
  listButton: await buttonLabel(pageA),
  rows: await pageA.locator('[aria-label="Playlist"] > li').count(),
};
obs("B: second DJ appended, nobody touched the button", afterRegrow);
check(
  "B: the list does not open itself when the queue grows from one",
  !afterRegrow.panelRendered,
  `rendered=${afterRegrow.panelRendered}, button=${afterRegrow.listButton}`,
);

// Tickets: measure the transport row before and after the chip (60s of playback).
const beforeChip = await rowLayout(pageA);
obs("B: transport row, queue of two, panel as it is, before chip", beforeChip);

let chip = 0;
const deadline = Date.now() + 80000;
while (Date.now() < deadline) {
  chip = await pageA.locator('a[aria-label^="Tickets for"]').count();
  if (chip) break;
  await pageA.waitForTimeout(1000);
}
await pageA.waitForTimeout(300);
const afterChip = await rowLayout(pageA);
const chipBox = await pageA.locator('a[aria-label^="Tickets for"]').evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
}).catch(() => null);
obs("B: transport row, after chip", { ...afterChip, chipBox });
check("B: chip appeared", chip > 0);
check(
  "B: the list button does not move when the chip appears",
  beforeChip.children.find((c) => c.tag === "BUTTON" && c.cls.includes("relative"))?.left ===
    afterChip.children.find((c) => c.tag === "BUTTON" && c.cls.includes("relative"))?.left,
);
obs("B: title width before and after chip", { before: beforeChip.title, after: afterChip.title });

// ─── Control: fresh page, same preview, no earlier open panel ──────────────

const pageC = await bootPage();
await pageC.locator("text=Test Night").first().click();
await pageC.waitForSelector('[role="dialog"]', { timeout: 8000 });
await pageC.locator('button:has-text("Preview the night")').first().click();
await pageC.waitForSelector('input[aria-label="Seek"]', { timeout: 15000 });
let regrewC = false;
for (let i = 0; i < 60 && !regrewC; i += 1) {
  regrewC = (await listButton(pageC).count()) > 0;
  if (!regrewC) await pageC.waitForTimeout(250);
}
await pageC.waitForTimeout(600);
obs("C (control, fresh page): after second DJ appended", {
  panelRendered: await panelRendered(pageC),
  listButton: await buttonLabel(pageC),
});

await browser.close();
shutdown();
process.exit(0);
