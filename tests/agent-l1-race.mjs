// Focused re-run of the stale-closure race with request tracing.
import fs from "node:fs";
let src = fs.readFileSync(new URL("./agent-l1-queue.mjs", import.meta.url), "utf8");
// keep fixtures/harness, drop T1..T7 sections, keep race section
const start = src.indexOf("// ───────────────────────── T1");
const raceStart = src.indexOf("// stale-closure race");
const head = src.slice(0, start);
const tail = src.slice(raceStart);
const prelude = `
page.on("request", (r) => { if (r.url().includes("/api/artist")) console.log("REQ", new Date().toISOString().slice(17,23), r.url().split("?")[1]); });
page.on("requestfinished", (r) => { if (r.url().includes("/api/artist")) console.log("DONE", new Date().toISOString().slice(17,23), r.url().split("?")[1]); });
await fresh();
await page.locator("text=Test Night").first().click();
await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
`;
const out = head + prelude + tail.replace('await page.locator(\'button[aria-label="Back to event"]\').click();\nawait wait(700);\n', "");
fs.writeFileSync(new URL("./agent-l1-race.gen.mjs", import.meta.url), out);
