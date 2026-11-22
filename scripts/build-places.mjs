#!/usr/bin/env node
/**
 * Builds public/places/venues.json and public/places/shops.json.
 *
 *   node scripts/build-places.mjs [--state <file>] [--shops-only|--venues-only]
 *
 * Plain Node 22, no dependencies, resumable: progress is written to the state
 * file after every step, and a second run only fills gaps.
 *
 * Venues: walks the indexed window through production's /api/events (one
 * request per 2.5 s), collects every distinct RA venue, then places each through
 * production's /api/venue (one per 2 s), which is the app's own geocoder and is
 * edge-cached. Placements are kept only when inside the NYC box AND the
 * geocoder's label starts with something that resembles the venue's name; the
 * rest are logged as rejected, not guessed.
 *
 * Shops: Nominatim directly (user agent ra-nyc/1.0, at most 1 request a second).
 * Nothing is added by hand and no coordinate is ever edited.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argVal = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const STATE = argVal("--state", resolve(ROOT, "scripts/.places-state.json"));
const SITE = "https://ra-nyc.vercel.app";
const UA = "ra-nyc/1.0 (+https://ra-nyc.vercel.app)";
const NYC_VIEWBOX = "-74.30,40.90,-73.65,40.45"; // as api/venue.ts: left,top,right,bottom
const BOX = { minLat: 40.45, maxLat: 40.92, minLng: -74.30, maxLng: -73.65 };
const LICENCE = "ODbL, © OpenStreetMap contributors";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const state = existsSync(STATE)
  ? JSON.parse(readFileSync(STATE, "utf8"))
  : { days: {}, venues: {}, placed: {}, rejected: {}, shopsQueries: {}, shops: {}, shopRequests: 0 };
const save = () => writeFileSync(STATE, JSON.stringify(state));

let last = 0;
async function paced(gapMs, url, init) {
  const wait = last + gapMs - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
      if (res.status === 429) { await sleep(15_000); last = Date.now(); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 2) { log("giving up on", url.slice(0, 120), String(e)); return null; }
      await sleep(3000); last = Date.now();
    }
  }
  return null;
}

const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const nyDate = (offset) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
};
const skipName = (n) => /^tba\b/i.test(n.trim()) || /secret location/i.test(n);

/* ---------------- venues ---------------- */
async function collectVenues() {
  for (let off = -120; off <= 45; off++) {
    const day = nyDate(off);
    if (state.days[day]) continue;
    const body = await paced(2500, `${SITE}/api/events?date=${day}`);
    if (!body) continue;
    for (const e of body.events ?? []) {
      const v = e.venue;
      if (!v?.name || skipName(v.name)) continue;
      const key = v.id ? `id:${v.id}` : `n:${norm(v.name)}`;
      const cur = state.venues[key] ?? { id: v.id ?? null, name: v.name.trim(), events: 0, lastSeen: day };
      cur.events += 1;
      if (day > cur.lastSeen) { cur.lastSeen = day; cur.name = v.name.trim(); }
      state.venues[key] = cur;
    }
    state.days[day] = true;
    save();
    if (off % 10 === 0) log("day", day, "venues so far", Object.keys(state.venues).length);
  }
}

/** The geocoder's label must open with something resembling the venue's name. */
function labelMatches(name, label) {
  if (!label) return false;
  const head = norm(label.split(",")[0]);
  const stop = new Set(["the", "nyc", "new", "york", "club", "bar", "ny", "and", "of", "manhattan", "brooklyn", "queens", "bronx"]);
  const toks = norm(name).split(" ").filter((t) => t.length > 1 && !stop.has(t));
  if (!toks.length) return false;
  return toks.some((t) => head.includes(t)) || norm(name).includes(head) && head.length > 3;
}

async function placeVenues() {
  const keys = Object.keys(state.venues).sort((a, b) => state.venues[b].events - state.venues[a].events);
  let n = 0;
  for (const key of keys) {
    if (state.placed[key] || state.rejected[key]) continue;
    const v = state.venues[key];
    const q = new URLSearchParams({ name: v.name });
    if (v.id) q.set("id", v.id);
    const r = await paced(2000, `${SITE}/api/venue?${q}`);
    n++;
    if (!r) continue; // transient: try again on the next run
    const inBox = r.lat != null && r.lon != null && r.lat >= BOX.minLat && r.lat <= BOX.maxLat && r.lon >= BOX.minLng && r.lon <= BOX.maxLng;
    // Two ways in. The geocoder found a place whose name resembles the venue's;
    // or it could not by name, and the coordinates come from geocoding the street
    // address RA itself holds for the venue (addressSource "ra").
    const byName = labelMatches(v.name, r.label);
    const byRaAddress = r.addressSource === "ra";
    if (inBox && (byName || byRaAddress)) {
      state.placed[key] = { id: v.id, name: v.name, lat: +r.lat.toFixed(6), lng: +r.lon.toFixed(6), address: r.address, events: v.events, lastSeen: v.lastSeen, source: byName ? "nominatim via /api/venue" : "nominatim via /api/venue (RA's own address)" };
    } else {
      state.rejected[key] = { name: v.name, why: !inBox ? (r.lat == null ? "no result" : "outside NYC box") : "label does not resemble name", label: r.label };
    }
    save();
    if (n % 20 === 0) log("placed", Object.keys(state.placed).length, "rejected", Object.keys(state.rejected).length, "of", keys.length);
  }
}

/**
 * Second pass, for venues the first pass could not place and that matter
 * (3+ events): try the name's other spellings. "X at Y" is usually a room inside
 * Y; "SOBs" is "SOB's"; a bare name is ambiguous across the state, so a borough
 * is appended. A variant is accepted on the same terms as the first pass: inside
 * the NYC box and the geocoder's label resembles the venue.
 */
/** Stricter than labelMatches: every word of the variant (borough aside) must be in the label's name. */
function strictMatch(name, label) {
  if (!label) return false;
  const head = norm(label.split(",").slice(0, 2).join(" "));
  const toks = norm(name).split(" ").filter((t) => t && !["manhattan", "brooklyn", "queens", "bronx"].includes(t));
  // A school or a church is not a club that happens to share a word.
  if (/\b(school|church|cathedral|p s)\b/.test(head) && !/\b(school|church|cathedral)\b/.test(norm(name))) return false;
  return toks.length > 0 && toks.every((t) => head.includes(t));
}

async function retryVariants() {
  for (const [key, rej] of Object.entries(state.rejected)) {
    const v = state.venues[key];
    if (state.placed[key] || rej.retried || v.events < 3) continue;
    const variants = [];
    const at = v.name.match(/ at (.+)$/i);
    if (at) variants.push(at[1].trim());
    if (/[a-z]s$/i.test(v.name) && !v.name.includes("'")) variants.push(v.name.replace(/s$/i, "'s"));
    if (!/brooklyn|queens|manhattan|bronx/i.test(v.name)) for (const b of ["Manhattan", "Brooklyn", "Queens"]) variants.push(`${v.name} ${b}`);
    for (const variant of variants.slice(0, 4)) {
      const q = new URLSearchParams({ name: variant });
      if (v.id) q.set("id", v.id);
      const r = await paced(2000, `${SITE}/api/venue?${q}`);
      if (!r) continue;
      const inBox = r.lat != null && r.lon != null && r.lat >= BOX.minLat && r.lat <= BOX.maxLat && r.lon >= BOX.minLng && r.lon <= BOX.maxLng;
      if (inBox && strictMatch(variant, r.label)) {
        state.placed[key] = { id: v.id, name: v.name, lat: +r.lat.toFixed(6), lng: +r.lon.toFixed(6), address: r.address, events: v.events, lastSeen: v.lastSeen, source: `nominatim via /api/venue (as "${variant}")` };
        delete state.rejected[key];
        log("recovered", v.name, "as", variant);
        break;
      }
    }
    if (!state.placed[key]) rej.retried = true;
    save();
  }
}

/* ---------------- shops ---------------- */
const QUERIES = ["record store", "record shop", "records", "vinyl", "used records", "record store brooklyn", "record store queens", "record store manhattan", "record store bronx",
  "records brooklyn", "records manhattan", "records queens", "records bronx", "records staten island", "vinyl records", "record", "music store", "music shop", "wax", "lp records", "cds and records", "records and tapes"];
const NOT_A_RECORD_SHOP = /guitar|piano|drum|violin|lesson|school|studio|rehears|academy|conservator|instrument|synth|keyboard|brass|bass center/i;

async function collectShops() {
  for (const query of QUERIES) {
    let excluded = [];
    for (let page = 0; page < 6; page++) {
      const id = `${query}#${page}`;
      if (state.shopsQueries[id]) { excluded = excluded.concat(state.shopsQueries[id].ids); if (!state.shopsQueries[id].ids.length) break; continue; }
      if (state.shopRequests >= 85) { log("shop request cap reached"); return; }
      const q = new URLSearchParams({ q: query, format: "jsonv2", addressdetails: "1", extratags: "1", limit: "50", bounded: "1", viewbox: NYC_VIEWBOX });
      if (excluded.length) q.set("exclude_place_ids", excluded.join(","));
      const rows = await paced(1100, `https://nominatim.openstreetmap.org/search?${q}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
      state.shopRequests++;
      if (!rows) break;
      const ids = rows.map((r) => r.place_id);
      state.shopsQueries[id] = { ids };
      for (const r of rows) {
        const typ = r.type, cat = r.category ?? r.class;
        if (cat !== "shop" || !["music", "records", "record", "vinyl"].includes(typ)) continue;
        // The five boroughs only: the viewbox also catches New Jersey.
        if (r.address?.state && r.address.state !== "New York") continue;
        const name = r.name || r.display_name.split(",")[0];
        if (NOT_A_RECORD_SHOP.test(name) || NOT_A_RECORD_SHOP.test(r.extratags?.description ?? "")) continue;
        const osm = `${r.osm_type}/${r.osm_id}`;
        if (state.shops[osm]) continue;
        const a = r.address ?? {};
        const street = [a.house_number, a.road].filter(Boolean).join(" ");
        state.shops[osm] = {
          osm, name, lat: +(+r.lat).toFixed(6), lng: +(+r.lon).toFixed(6),
          address: [street, a.neighbourhood ?? a.suburb ?? a.city_district, a.city ?? a.borough ?? a.town, a.postcode].filter(Boolean).join(", ") || null,
          hours: r.extratags?.opening_hours ?? null, website: r.extratags?.website ?? r.extratags?.["contact:website"] ?? null,
          osmType: typ, source: "OpenStreetMap via Nominatim",
        };
      }
      excluded = excluded.concat(ids);
      save();
      log("shops", query, "page", page, "rows", rows.length, "kept so far", Object.keys(state.shops).length);
      if (!rows.length) break;
    }
  }
}

/* ---------------- output ---------------- */
function write() {
  mkdirSync(resolve(ROOT, "public/places"), { recursive: true });
  const fetched = new Date().toISOString().slice(0, 10);
  const venues = Object.values(state.placed).sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));
  const tidy = (a) => (a ? a.replace(/(Manhattan )?Community Board \d+,? ?/g, "").replace(/, ,/g, ",").replace(/,\s*$/, "") : a);
  // The NYC viewbox also catches New Jersey and Nassau County. The five boroughs
  // are ZIPs 100-104 and 111-114 and 116; a shop with no ZIP is dropped rather than guessed.
  const inNewYork = (s) => /\b(10[0-4]|11[1-4]|116)\d{2}\b/.test(s.address ?? "");
  const shops = Object.values(state.shops).filter(inNewYork).map((s) => ({ ...s, address: tidy(s.address) })).sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(resolve(ROOT, "public/places/venues.json"), JSON.stringify({ source: "Resident Advisor listings, placed with Nominatim (OpenStreetMap)", licence: LICENCE, fetched, items: venues }) + "\n");
  writeFileSync(resolve(ROOT, "public/places/shops.json"), JSON.stringify({ source: "OpenStreetMap via Nominatim", licence: LICENCE, fetched, items: shops }) + "\n");
  log("wrote", venues.length, "venues,", shops.length, "shops;", Object.keys(state.rejected).length, "venues rejected");
}

if (!args.includes("--venues-only")) await collectShops();
write();
if (!args.includes("--shops-only")) { await collectVenues(); write(); await placeVenues(); await retryVariants(); }
write();
