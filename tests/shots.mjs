/**
 * Screenshots for review. Not a test — nothing here asserts anything.
 *
 * Renders the same screens at the settings that were changing size behind the
 * app's back, so the fix can be looked at rather than taken on trust:
 * the transport at its new proportions, and the listings at Tight against Airy
 * with the glyphs held still.
 *
 * Usage: E2E_PORT=5321 node tests/shots.mjs [outDir]
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

// Same discovery as the e2e suites — playwright-core ships no browsers, so the
// binary has to be found wherever `playwright install` put it.
function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), ".cache", "ms-playwright"),
    join(homedir(), "Library", "Caches", "ms-playwright"),
  ].filter(Boolean);
  const binaries = [
    ["chrome-linux", "chrome"],
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
  throw new Error("No Chromium found. Run `npx playwright install chromium`.");
}

const PORT = process.env.E2E_PORT ?? "5321";
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.argv[2] ?? "/tmp/shots";

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
      // 0 before the track is parsed — the real widget's behaviour, and the
      // whole reason the adapter cannot rely on asking once.
      getDuration:function(cb){cb(parsed?duration:0);},
      // A late tick from the OUTGOING track, fired after load() was called and
      // before the swap completes. The real widget does this — postMessage is
      // in flight when the swap is requested — and it is the second half of the
      // timeline bug: that stale position landed as the new track's, so a set
      // skipped into opened its timeline wherever the previous one had got to.
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

// One artist with a queue behind it, so the transport renders with its playlist
// badge and both skip buttons live. Borrowed wholesale from player.e2e.mjs.
const mkSet = (n) => ({
  provider: "soundcloud",
  id: `sc-${n}`,
  title: `Set Number ${n}`,
  url: `https://soundcloud.com/test/${n}`,
  embedUrl: `https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Ftest%2F${n}&auto_play=false`,
  duration: 2400,
  plays: 1000 * n,
  createdAt: null,
  artwork: null,
});

const ARTIST = {
  id: "99",
  name: "Test DJ",
  mixcloudUser: null,
  mixcloudUrl: null,
  soundcloudUser: "test",
  soundcloudUrl: "https://soundcloud.com/test",
  raUrl: null,
  bio: null,
  sets: Array.from({ length: 9 }, (_, i) => mkSet(i + 1)),
  links: [],
  linkSource: "auto",
  cached: false,
  persisted: false,
  soundcloud: "api-v2",
};

const PAYLOAD = JSON.stringify({
  date: "2026-09-10",
  events: Array.from({ length: 8 }, (_, i) => ({
    id: `e${i}`,
    title: [
      "Test Night",
      "Warehouse Session",
      "Basement Transmission",
      "Sunday Service",
      "Low End Theory",
      "After Hours",
      "Rooftop Sundown",
      "Dark Room",
    ][i],
    date: "2026-09-10",
    startTime: "2026-09-10T22:00:00",
    endTime: "2026-09-11T04:00:00",
    venue: { id: `v${i}`, name: ["Nowadays", "Basement", "Good Room", "Elsewhere"][i % 4] },
    artists: [
      { id: `a${i}0`, name: "Test DJ" },
      { id: `a${i}1`, name: "Second Name" },
      { id: `a${i}2`, name: "Third Name" },
    ],
    attending: 40 + i * 17,
    isPick: i === 1,
    imageUrl: null,
    contentUrl: `/events/${i}`,
  })),
});

const server = spawn(
  "npx",
  ["vite", "--port", PORT, "--host", "127.0.0.1"],
  { stdio: "ignore" },
);
const shutdown = () => server.kill("SIGTERM");
process.on("exit", shutdown);

await new Promise((resolve) => setTimeout(resolve, 4000));

const browser = await chromium.launch({ executablePath: findChromium() });

const shot = async (name, { density = "default", textSize = "0", typography = "base", after } = {}) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  await page.route("**/api/events*", (route) =>
    route.fulfill({ contentType: "application/json", body: PAYLOAD }),
  );
  await page.route("**/api/artist*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(ARTIST) }),
  );
  // Registration order matters: Playwright matches last-registered-first, so
  // the narrower api.js route has to come after the catch-all.
  await page.route("**/w.soundcloud.com/player/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>stub</title>" }),
  );
  await page.route("**/w.soundcloud.com/player/api.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: FAKE_SC }),
  );
  await page.addInitScript(FAKE_SC);
  await page.route("**/images.ra.co/**", (route) => route.abort());
  await page.addInitScript(
    ([d, t, ty]) =>
      localStorage.setItem(
        "ra-theme-settings",
        JSON.stringify({
          colorTheme: "neon",
          layoutDensity: d,
          typography: ty,
          textSize: t,
        }),
      ),
    [density, textSize, typography],
  );
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("article", { timeout: 20000 });
  await page.waitForTimeout(500);
  if (after) await after(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await ctx.close();
  console.log(name);
};

// The listings, at the two ends of the Density axis. Same glyphs, same size.
await shot("density-tight", { density: "tight" });
await shot("density-airy", { density: "airy" });

// The type ladder, one shot per rung of the typography preference.
await shot("type-base", { typography: "base" });
await shot("type-late", { typography: "late" });

// The largest setting of both, which is the rung that exists for reading a
// phone at 4am and the one that has to survive its own size.
await shot("largest", { density: "airy", textSize: "5", typography: "late" });

// The event sheet, where most of the glyphs live.
const openSheet = async (page) => {
  await page.locator("article").first().click();
  await page.waitForTimeout(800);
};
await shot("sheet-tight", { density: "tight", after: openSheet });
await shot("sheet-airy", { density: "airy", after: openSheet });

// And the transport, playing, with a queue behind it.
const startPlaying = async (page) => {
  await page.locator("article").first().click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /Preview the night/ }).click();
  await page.waitForTimeout(2500);
  // Back to the listings, so the bar is seen over the screen it usually covers
  // rather than over a sheet.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
};
await shot("player", { after: startPlaying });
await shot("player-tight", { density: "tight", after: startPlaying });
await shot("player-largest", {
  density: "airy",
  textSize: "5",
  typography: "late",
  after: startPlaying,
});
await shot("player-list", {
  after: async (page) => {
    await startPlaying(page);
    await page.getByRole("button", { name: /Show playlist/ }).click();
    await page.waitForTimeout(500);
  },
});

await browser.close();
shutdown();
console.log(`\nwritten to ${OUT}`);
