/**
 * End-to-end checks for the party preview and the earned ticket link.
 *
 * Run with:  npm run test:preview
 *
 * `/api/artist` is stubbed with a deliberate *staggered* delay so the thing
 * that matters can actually be observed: the preview must start on the first
 * DJ who resolves, not wait for the whole bill. A stub that answered instantly
 * would pass whether or not that were true.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright-core";

const PORT = Number(process.env.E2E_PORT ?? 5203);
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), ".cache", "ms-playwright"),
    join(homedir(), "Library", "Caches", "ms-playwright"),
  ].filter(Boolean);
  for (const root of roots) {
    if (!root || !existsSync(root)) continue;
    for (const entry of readdirSync(root).filter((d) => d.startsWith("chromium"))) {
      for (const parts of [
        ["chrome-linux", "chrome"],
        ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
        ["chrome-win", "chrome.exe"],
      ]) {
        const candidate = join(root, entry, ...parts);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  throw new Error("No Chromium found. Run `npx playwright install chromium`.");
}

const TODAY = new Date().toISOString().slice(0, 10);
const LINEUP = ["Objekt", "Avalon Emerson", "Mike Servito"];

const EVENT = {
  id: "e1",
  title: "Mister Sunday",
  date: `${TODAY}T00:00:00.000`,
  startTime: `${TODAY}T22:00:00.000`,
  endTime: null,
  url: "https://ra.co/events/1",
  imageUrl: null,
  venue: { name: "Nowadays", area: "New York" },
  artists: LINEUP.map((name, i) => ({ id: `a${i}`, name })),
  attending: 120,
  isPick: false,
  pickBlurb: null,
};

/** Ten sets each, so the seeded pick has a pool to choose from. */
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
  window.__built = 0;
  function Widget(iframe){
    var l={},pos=0,timer=null,duration=3600000,activated=false;
    window.__built++;
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
})();
`;
const server = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1"], {
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

for (let attempt = 0; ; attempt += 1) {
  try {
    await fetch(BASE);
    break;
  } catch {
    if (attempt > 60) throw new Error("Dev server never came up");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const browser = await chromium.launch({ executablePath: findChromium() });
const context = await browser.newContext({
  ...devices["iPhone 13"],
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));


await page.route("**/api/events*", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ date: TODAY, events: [EVENT], count: 1 }),
  }),
);

// Registration order matters: Playwright matches routes last-registered-first,
// so the catch-all must come BEFORE the api.js stub or it swallows it and the
// page gets HTML where it expected a script.
await page.route("**/w.soundcloud.com/player/**", (route) =>
  route.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub</title>" }),
);
await page.route("**/w.soundcloud.com/player/api.js", (route) =>
  route.fulfill({ contentType: "application/javascript", body: FAKE_SC }),
);

let artistCalls = [];
await page.route("**/api/artist*", async (route) => {
  const url = new URL(route.request().url());
  const id = url.searchParams.get("id") ?? "";
  const name = url.searchParams.get("name") ?? "";
  artistCalls.push(id);
  // Staggered: a0 is slowest. If the preview waited for the whole lineup this
  // would show up as a delay; if it starts on whoever is first, it does not.
  const delayByArtist = { a0: 1500, a1: 200, a2: 700 };
  await new Promise((r) => setTimeout(r, delayByArtist[id] ?? 300));
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      id,
      name,
      sets: setsFor(name, id),
      links: [],
      bio: null,
      mixcloudUrl: null,
      soundcloudUrl: null,
          raUrl: null,
      cached: false,
      linkSource: "auto",
    }),
  });
});

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Mister Sunday", { timeout: 20000 });
await page.waitForTimeout(700);

// ── opening the party warms the bill
artistCalls = [];
await page.locator("text=Mister Sunday").first().click();
await page.waitForSelector("text=Preview the night", { timeout: 8000 });
check("the party offers a preview", true);

await page.waitForTimeout(1800);
check("opening a party warms every DJ on the bill",
  new Set(artistCalls).size === LINEUP.length,
  `${new Set(artistCalls).size} of ${LINEUP.length}`);

// Nothing may play until asked. Sound the user did not request is the one
// thing this feature must never do.
check("opening a party plays nothing on its own",
  (await page.locator('button[aria-label="Play"], button[aria-label="Pause"]').count()) === 0);

// ── the preview itself
const started = Date.now();
await page.locator("text=Preview the night").click();
await page.waitForSelector('button[aria-label="Pause"], button[aria-label="Play"]', {
  timeout: 10000,
});
const latency = Date.now() - started;

// a1 answers in 200ms and a0 in 1500ms. Starting inside a second proves it did
// not wait for the slowest DJ on the bill.
check("playback starts on the first DJ back, not the last", latency < 1200, `${latency}ms`);

await page.waitForTimeout(2500);

const bar = await page.evaluate(() => {
  const el = document.querySelector('[data-player-bar], .fixed.inset-x-0.bottom-0');
  return el?.textContent ?? "";
});
check("the transport names the party, not just the provider",
  bar.includes("Mister Sunday"), bar.slice(0, 80));

const queued = await page.evaluate(() => {
  const text = document.body.textContent ?? "";
  const match = text.match(/(\d+) of (\d+)/);
  return match ? Number(match[2]) : 0;
});
check("the rest of the lineup lands in the queue behind the music",
  queued === LINEUP.length, `${queued} sets queued`);

// ── the ticket link is earned, not given
check("no ticket link before anyone has listened",
  (await page.locator('a[aria-label*="Tickets for"]').count()) === 0);

// The 60-second reveal itself is asserted in tests/unit/tickets.test.ts.
// Faking a minute of playback here is not possible without breaking the page:
// Playwright's fake clock has to be installed before navigation, and advancing
// it far enough blanks the app by firing every startup timer at once. What can
// be checked in a browser is the guarantee that actually matters — that nothing
// is promoted to someone who has only just arrived — and that is asserted
// above.

await browser.close();
shutdown();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
