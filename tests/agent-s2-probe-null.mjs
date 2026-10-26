import { transformListing, matchesTerm, searchKey, expandTerm } from "./agent-s2-matcher.mjs";
const good = { id: "1", listingDate: "2026-11-01", event: { id: "e1", title: "Night", attending: 3, date: "2026-11-01", startTime: null, endTime: null, contentUrl: "/events/1", flyerFront: null, images: [], venue: null, artists: [{ id: "a", name: "Dave Clark" }], pick: null } };
const bad = { id: "2", listingDate: "2026-11-01", event: null };
console.log("good row ->", transformListing(good).title);
try { transformListing(bad); console.log("bad row: no throw"); } catch (e) { console.log("bad row throws:", e.message); }
for (const q of ["A-Trak", "atrak", "Dj. Koze", "$hi", "ALL CAPS", "dj"]) console.log(JSON.stringify(q), "->", JSON.stringify(searchKey(q)), JSON.stringify(expandTerm(q)));
