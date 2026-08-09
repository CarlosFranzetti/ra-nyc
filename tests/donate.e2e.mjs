/**
 * The donate links, end to end.
 *
 * Run with:  npm run test:donate
 *
 * Small suite, narrow point. A donate link has a failure mode nothing else in
 * this app has: it can look completely correct and still send money nowhere, or
 * — worse — somewhere. And it lives inside a vaul drawer, which drags on
 * pointer events and is exactly the kind of thing that swallows a tap on a link
 * it contains. So this asserts the href, and then actually taps it under touch
 * emulation and reads the URL the browser ended up at.
 *
 * The donate hosts are stubbed at the *context* level rather than the page
 * level: a target="_blank" link opens a new page, and page-level routes do not
 * follow it. Getting that wrong is what made this suite fail against a working
 * app the first time it ran.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

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

// The expected handles, spelled out here rather than imported from
// `src/lib/donate.ts`. Importing them would make this test agree with whatever
// the file says, including a typo — the whole point is that a second copy has
// to be changed deliberately.
const EXPECTED = [
  ["Cash App", "https://cash.app/$hypedrum"],
  ["PayPal", "https://paypal.me/losfiesta"],
];

const TODAY = new Date().toISOString().slice(0, 10);
const PAYLOAD = JSON.stringify({
  date: TODAY,
  count: 1,
  events: [
    {
      id: "e0",
      title: "Event number 0",
      date: `${TODAY}T00:00:00.000`,
      startTime: `${TODAY}T22:00:00.000`,
      endTime: null,
      url: "https://ra.co/events/1",
      imageUrl: null,
      venue: { name: "Nowadays", area: "New York" },
      artists: [{ id: "a", name: "Objekt" }],
      attending: 50,
      isPick: false,
      pickBlurb: null,
    },
  ],
});

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
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
await page.route("**/api/events*", (route) =>
  route.fulfill({ contentType: "application/json", body: PAYLOAD }),
);
await page.route("**/images.ra.co/**", (route) => route.abort());
for (const host of ["cash.app", "paypal.me"]) {
  await context.route(`**/${host}/**`, (route) =>
    route.fulfill({ contentType: "text/html", body: `<h1>${host}</h1>` }),
  );
}

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Event number 0", { timeout: 20000 });
await page.tap('button[aria-label="Customize"]');
await page.waitForTimeout(700);

for (const [label, expected] of EXPECTED) {
  const link = page.locator(`a:has-text("${label}")`);
  check(`${label} is a real link`, (await link.count()) === 1);
  check(
    `${label} points at the right handle`,
    (await link.getAttribute("href")) === expected,
    (await link.getAttribute("href")) ?? "missing",
  );

  const [popup] = await Promise.all([
    context.waitForEvent("page", { timeout: 5000 }).catch(() => null),
    link.tap(),
  ]);
  check(`tapping ${label} opens it rather than being swallowed by the drawer`,
    Boolean(popup), popup ? popup.url() : "nothing opened");
  if (popup) {
    check(`${label} arrives at the handle itself`, popup.url() === expected, popup.url());
    await popup.close();
  }
  await page.waitForTimeout(200);
}

// Tapping a link should not also dismiss the panel behind it — coming back to
// a closed sheet reads as the tap having done something else.
check("the panel stays open behind the new tab",
  await page.locator("button[aria-pressed]").first().isVisible());

await browser.close();
shutdown();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
