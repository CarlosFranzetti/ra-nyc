/**
 * L3 probe: the playlist panel in PlayerBar.tsx.
 *
 * Investigation only. Not part of the suite. Run with:
 *   E2E_PORT=5513 node tests/agent-l3-playlist.mjs | tail -80
 *
 * Reuses the fake SoundCloud widget and the ARTIST fixture from
 * tests/player.e2e.mjs (copied, because that file runs its suite at import).
 * Prints OBS lines (measured values) and CHECK lines (expectation vs reality).
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 5513);
const BASE = `http://127.0.0.1:${PORT}`;

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

// ─── Fixtures (copied from tests/player.e2e.mjs) ────────────────────────────

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
  id,
  name,
  mixcloudUser: null,
  mixcloudUrl: null,
  soundcloudUser: handle,
  soundcloudUrl: `https://soundcloud.com/${handle}`,
  raUrl: null,
  bio: null,
  sets: Array.from({ length: count }, (_, i) => mkSet(prefix, i + 1, base)),
  links: [],
  linkSource: "auto",
  cached: false,
  persisted: false,
  soundcloud: "api-v2",
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

// ─── Dev server ─────────────────────────────────────────────────────────────

const server = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1"], {
  stdio: "ignore",
  detached: false,
});
const shutdown = () => {
  try {
    server.kill("SIGTERM");
  } catch {
    /* gone */
  }
};
process.on("exit", shutdown);

for (let attempt = 0; ; attempt += 1) {
  try {
    await fetch(BASE);
    break;
  } catch {
    if (attempt > 80) throw new Error("Dev server never came up");
    await new Promise((r) => setTimeout(r, 250));
  }
}

// ─── Browser ────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ executablePath: findChromium() });
const context = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true, isMobile: true });
const page = await context.newPage();
const keyWarnings = [];
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
page.on("console", (m) => {
  if ((m.type() === "error" || m.type() === "warning") && /key/i.test(m.text())) keyWarnings.push(m.text().slice(0, 160));
});

await page.route("**/api/events*", (route) =>
  route.fulfill({ contentType: "application/json", body: JSON.stringify({ date: "2026-08-02", events: [EVENT], count: 1 }) }),
);
await page.route("**/api/artist*", (route) => {
  const url = route.request().url();
  const body = url.includes("id=100") ? ARTIST2 : ARTIST;
  return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
});
await page.route("**/w.soundcloud.com/player/**", (route) =>
  route.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub</title>" }),
);
await page.route("**/w.soundcloud.com/player/api.js", (route) =>
  route.fulfill({ contentType: "application/javascript", body: FAKE_SC }),
);
await page.route("**/images.ra.co/**", (route) => route.abort());

// ─── Helpers ────────────────────────────────────────────────────────────────

const panelRows = page.locator('[aria-label="Playlist"] > li');
const listButton = () => page.locator('button[aria-label="Show playlist"], button[aria-label="Hide playlist"]').first();
const subtitle = () => page.locator(".player-live div.mx-1 p").nth(1).textContent().then((t) => (t ?? "").trim());
const bannerTitle = () => page.locator(".player-live div.mx-1 p").first().textContent().then((t) => (t ?? "").trim());
const liveRow = () => page.locator('[aria-label="Playlist"] li button[aria-current="true"]');
const builtCount = () => page.evaluate(() => window.__built);

const panelMetrics = () =>
  page.evaluate(() => {
    const ul = document.querySelector('[aria-label="Playlist"]');
    if (!ul) return null;
    const panel = ul.parentElement;
    const live = ul.querySelector('li button[aria-current="true"]');
    const pr = panel.getBoundingClientRect();
    const lr = live?.getBoundingClientRect();
    return {
      panelH: Math.round(pr.height),
      scrollTop: Math.round(panel.scrollTop),
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight,
      liveTitle: live?.textContent?.trim() ?? null,
      liveFullyInPanel: lr ? lr.top >= pr.top - 1 && lr.bottom <= pr.bottom + 1 : null,
    };
  });

const barMetrics = () =>
  page.evaluate(() => {
    const bar = document.querySelector('input[aria-label="Seek"]')?.closest("div.fixed");
    if (!bar) return null;
    const pad = parseFloat(getComputedStyle(document.querySelector(".min-h-screen")).paddingBottom);
    return {
      barH: Math.round(bar.getBoundingClientRect().height),
      pagePadBottom: Math.round(pad),
      playerHVar: document.documentElement.style.getPropertyValue("--player-h"),
    };
  });

const closeSheets = async () => {
  for (let i = 0; i < 3; i += 1) {
    const back = page.locator('button[aria-label="Back to event"]');
    if (await back.count()) await back.click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    if ((await page.locator('[role="dialog"]').count()) === 0) break;
  }
};

// ─── Part 1: nine-set catalogue ─────────────────────────────────────────────

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Test Night", { timeout: 20000 });
await page.waitForTimeout(900);
await page.locator("text=Test Night").first().click();
await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
await page.locator('[role="dialog"] button:has-text("Test DJ")').first().click();
await page.waitForSelector('button[aria-label="Pause Set Number 1"]', { timeout: 8000 });
await page.waitForTimeout(400);
await closeSheets();

// 1. Badge and accessible name
const toggleInfo = await page.evaluate(() => {
  const b = document.querySelector('button[aria-label="Show playlist"]');
  return b ? { ariaLabel: b.getAttribute("aria-label"), text: b.textContent.trim(), expanded: b.getAttribute("aria-expanded") } : null;
});
obs("list button (closed)", toggleInfo);
check(
  "badge number is part of the list button's accessible name",
  toggleInfo !== null && toggleInfo.ariaLabel.includes(String(toggleInfo.text)),
  `aria-label="${toggleInfo?.ariaLabel}" but visible text="${toggleInfo?.text}"`,
);
obs("subtitle at start", await subtitle());

// 2. Measure the bar with the panel closed, then open
const closedBar = await barMetrics();
obs("bar metrics, panel closed", closedBar);

await listButton().click();
await page.waitForTimeout(400);
obs("rows when opened", await panelRows.count());
const openMetrics = await panelMetrics();
obs("panel metrics, first open", openMetrics);
check("live row is visible on open (position 0)", openMetrics.liveFullyInPanel === true, `liveTitle=${openMetrics.liveTitle}`);

const openBar = await barMetrics();
obs("bar metrics, panel open", openBar);
check(
  "page reserves bottom space equal to bar+panel when panel open",
  openBar.pagePadBottom === openBar.barH,
  `pad=${openBar.pagePadBottom} barH=${openBar.barH} --player-h=${openBar.playerHVar}`,
);
check(
  "panel adds height to the bar (ResizeObserver fired)",
  openBar.barH > closedBar.barH,
  `closed=${closedBar.barH} open=${openBar.barH} panel=${openMetrics.panelH}`,
);

// Accessibility of the rows
const xMetrics = await page.evaluate(() => {
  const xs = [...document.querySelectorAll('[aria-label="Playlist"] li button[aria-label^="Remove "]')];
  const r = xs[0]?.getBoundingClientRect();
  return { count: xs.length, firstLabel: xs[0]?.getAttribute("aria-label"), w: r && Math.round(r.width), h: r && Math.round(r.height) };
});
obs("remove buttons", xMetrics);
check("no remove button on the live row", xMetrics.count === 8, `${xMetrics.count} X buttons for 9 rows`);
check("remove X is 44x44", xMetrics.w === 44 && xMetrics.h === 44, `${xMetrics.w}x${xMetrics.h}`);

// 3. Keys and focus: mark DOM nodes, then remove Set Number 2 from the keyboard
await page.evaluate(() =>
  document.querySelectorAll('[aria-label="Playlist"] > li').forEach((li) => (li.__probe = 1)),
);
const xSet2 = page.locator('button[aria-label="Remove Set Number 2 from the playlist"]');
await xSet2.focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const survivors = await page.evaluate(() =>
  [...document.querySelectorAll('[aria-label="Playlist"] > li')].filter((li) => li.__probe).length,
);
const rowsAfter = await panelRows.count();
obs("after removing row 2 (keyboard): rows, DOM nodes that survived", { rowsAfter, survivors });
check("removal leaves rows after the removed one remounted (position keys)", survivors === 1, `${survivors} of ${rowsAfter} rows kept their DOM node`);
const focusAfter = await page.evaluate(() => {
  const a = document.activeElement;
  return { tag: a?.tagName, label: a?.getAttribute("aria-label") ?? null };
});
obs("focus after removing via keyboard", focusAfter);
check("focus stays in the list after removing a row", focusAfter.tag !== "BODY", JSON.stringify(focusAfter));

// 4. Stale index: jump forward, then remove a row BEFORE the live one
await page.locator('[aria-label="Playlist"] > li > button', { hasText: "Set Number 5" }).click();
await page.waitForTimeout(150);
obs("after jumping to Set Number 5", { live: await liveRow().textContent(), subtitle: await subtitle(), banner: await bannerTitle() });
const builtBefore = await builtCount();
await page.locator('button[aria-label="Remove Set Number 3 from the playlist"]').click();
await page.waitForTimeout(300);
const afterEarlierRemove = { live: (await liveRow().textContent()).trim(), subtitle: await subtitle(), banner: await bannerTitle(), rows: await panelRows.count() };
obs("after removing row before live", afterEarlierRemove);
check(
  "N of M follows the removal (index decremented)",
  afterEarlierRemove.subtitle.includes("3 of 7"),
  afterEarlierRemove.subtitle,
);
check(
  "removing an earlier row does not reload the playing set",
  (await builtCount()) === builtBefore && afterEarlierRemove.banner === "Set Number 5",
  `built ${builtBefore} -> ${await builtCount()}, banner=${afterEarlierRemove.banner}`,
);

// 5. Scroll: advance with Next while panel is open, then see whether the live row is in view
const panelRowsNow = await panelRows.count();
for (let i = 0; i < panelRowsNow; i += 1) {
  const sub = await subtitle();
  if (sub.includes(`${panelRowsNow} of ${panelRowsNow}`)) break;
  await page.locator('button[aria-label="Next mix"]').click();
  await page.waitForTimeout(120);
}
await page.waitForTimeout(300);
const advanced = await panelMetrics();
obs("panel after advancing to the last row with Next, panel open", advanced);
check("the live row scrolls into view as playback advances", advanced.liveFullyInPanel === true, `scrollTop=${advanced.scrollTop} liveTitle=${advanced.liveTitle}`);

// Close and reopen: does the panel bring the live row into view on open?
await listButton().click();
await page.waitForTimeout(200);
await listButton().click();
await page.waitForTimeout(400);
const reopened = await panelMetrics();
obs("panel after close + reopen at the last row", reopened);
check("reopening the panel shows the live row", reopened.liveFullyInPanel === true, `scrollTop=${reopened.scrollTop} scrollHeight=${reopened.scrollHeight} clientHeight=${reopened.clientHeight}`);

// 6. Jump while loading: where does the marker go, and when does loading show?
await page.locator('[aria-label="Playlist"] > li > button', { hasText: "Set Number 4" }).click();
const immediate = {
  live: (await liveRow().textContent()).trim(),
  subtitle: await subtitle(),
  banner: await bannerTitle(),
  spinner: (await page.locator('button[aria-label="Play"] svg.animate-spin, button[aria-label="Pause"] svg.animate-spin').count()) > 0,
};
obs("immediately after jumping to Set Number 4", immediate);
await page.waitForSelector('button[aria-label="Pause"]', { timeout: 8000 }).catch(() => undefined);
obs("playing again after jump", { banner: await bannerTitle(), subtitle: await subtitle() });

// 7. Shrink the queue to one while the panel is open
for (let guard = 0; guard < 12; guard += 1) {
  const xs = page.locator('[aria-label="Playlist"] li button[aria-label^="Remove "]');
  if ((await xs.count()) === 0) break;
  await xs.first().click();
  await page.waitForTimeout(120);
}
await page.waitForTimeout(300);
const shrunk = {
  panelRendered: (await page.locator('[aria-label="Playlist"]').count()) > 0,
  listButtonCount: await listButton().count(),
  subtitle: await subtitle(),
  banner: await bannerTitle(),
};
obs("queue shrunk to one, panel had been open", shrunk);
check("panel and list button disappear at a queue of one", !shrunk.panelRendered && shrunk.listButtonCount === 0);

// ─── Part 2: close the player, then start a two-DJ preview ─────────────────

await page.locator('button[aria-label="Close player"]').click();
await page.waitForTimeout(500);
check("bar is gone after Close player", (await page.locator('input[aria-label="Seek"]').count()) === 0);

await page.locator("text=Test Night").first().click();
await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
await page.locator('button:has-text("Preview the night")').first().click();
await page.waitForSelector('input[aria-label="Seek"]', { timeout: 15000 });
await page.waitForTimeout(300);
const firstSet = {
  queueLabel: await subtitle(),
  panelRendered: (await page.locator('[aria-label="Playlist"]').count()) > 0,
  listButtonCount: await listButton().count(),
  banner: await bannerTitle(),
};
obs("preview: first set started", firstSet);

// Wait for the second DJ's set to be appended
let appended = false;
for (let i = 0; i < 40 && !appended; i += 1) {
  appended = (await listButton().count()) > 0;
  if (!appended) await page.waitForTimeout(250);
}
await page.waitForTimeout(500);
const secondSet = {
  panelRendered: (await page.locator('[aria-label="Playlist"]').count()) > 0,
  listButtonLabel: await page.locator('button[aria-label="Show playlist"], button[aria-label="Hide playlist"]').first().getAttribute("aria-label").catch(() => null),
  rows: await panelRows.count(),
  subtitle: await subtitle(),
};
obs("preview: second set appended, nobody touched the button", secondSet);
check(
  "the panel does not open by itself when the queue grows",
  !secondSet.panelRendered,
  `panel rendered=${secondSet.panelRendered}, button=${secondSet.listButtonLabel}`,
);

// 8. Tickets chip: wait past 60s of actual playback, measure the transport row
const titleWidth = () =>
  page.evaluate(() => {
    const p = document.querySelector(".player-live div.mx-1 p");
    return p ? Math.round(p.getBoundingClientRect().width) : null;
  });
const barBeforeChip = await barMetrics();
const titleBefore = await titleWidth();
const rowBefore = await page.evaluate(() => {
  const row = document.querySelector('.player-live .shell');
  return [...row.children].map((c) => ({ tag: c.tagName, w: Math.round(c.getBoundingClientRect().width), x: Math.round(c.getBoundingClientRect().left) }));
});
obs("transport row before tickets", { titleBefore, barH: barBeforeChip.barH, row: rowBefore });

let chip = 0;
const deadline = Date.now() + 75000;
while (Date.now() < deadline) {
  chip = await page.locator('a[aria-label^="Tickets for"]').count();
  if (chip) break;
  await page.waitForTimeout(1000);
}
await page.waitForTimeout(300);
const rowAfter = await page.evaluate(() => {
  const row = document.querySelector('.player-live .shell');
  return [...row.children].map((c) => ({ tag: c.tagName, w: Math.round(c.getBoundingClientRect().width), x: Math.round(c.getBoundingClientRect().left) }));
});
const barAfterChip = await barMetrics();
obs("transport row after tickets chip", { chipShown: chip > 0, titleAfter: await titleWidth(), barH: barAfterChip.barH, row: rowAfter });
check("tickets chip appears after listening", chip > 0);
check("the chip does not change the bar height", barAfterChip.barH === barBeforeChip.barH, `${barBeforeChip.barH} -> ${barAfterChip.barH}`);

const openPanelNow = await page.evaluate(() => document.querySelector('[aria-label="Playlist"]') !== null);
obs("panel open during tickets chip", openPanelNow);

obs("React key warnings captured", keyWarnings);

await browser.close();
shutdown();
process.exit(0);
