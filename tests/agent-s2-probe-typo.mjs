import { matchesTerm } from "./agent-s2-matcher.mjs";
const ev = { id: "x", title: "DJ Koze", date: "2026-11-01", startTime: "", endTime: "", url: "", imageUrl: null,
  venue: { id: null, name: "Nowadays", area: "" }, artists: [{ id: "a", name: "DJ Koze" }], attending: 0, isPick: false, pickBlurb: null };
for (const q of ["kozz", "dj kozz", "dj koze", "koze", "dj kose"]) console.log(JSON.stringify(q).padEnd(12), matchesTerm(ev, q));
