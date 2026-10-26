import { matchesTerm, expandTerm, searchKey } from "./agent-s2-matcher.mjs";
const ev = (title, venue, artists) => ({
  id: "x", title, date: "2026-11-01", startTime: "", endTime: "", url: "",
  imageUrl: null, venue: { id: null, name: venue, area: "" },
  artists: artists.map((n, i) => ({ id: String(i), name: n })),
  attending: 0, isPick: false, pickBlurb: null,
});
const cases = [
  ["live", ev("Unrelated Night", "Nowadays", ["Dave Clark"])],
  ["bass", ev("Something", "Luke Hall", ["Luke Hess"])],
  ["queer", ev("Hunter Presents", "Hunter", ["Gunter Flo"])],
  ["ko", ev("Plain Night", "Venue", ["Akash"])],
  ["dj kose", ev("DJ Koze Live", "Nowadays", ["DJ Koze"])],
  ["kose", ev("DJ Koze Live", "Nowadays", ["DJ Koze"])],
  ["kozz", ev("DJ Koze Live", "Nowadays", ["DJ Koze"])],
  ["Кирилл", ev("Кирилл Т", "Nowadays", ["Кирилл Т"])],
  ["ψ", ev("Ψ party", "Nowadays", ["Ψ"])],
  ["hélène", ev("Hélène Night", "Elsewhere", ["Hélène"])],
  ["ø", ev("Ø Night", "Elsewhere", ["Øyvind"])],
];
for (const [term, e] of cases) {
  console.log(JSON.stringify(term).padEnd(12), "live-match:", matchesTerm(e, term), "| keys:", JSON.stringify(expandTerm(term)));
}
const cross = ev("Vanilla", "Nowadays", ["Sam"]);
console.log("joined haystack (index path):", searchKey(["Vanilla","Nowadays","Sam"].join(" ")));
console.log("live per-field, 'llanow':", matchesTerm(cross, "llanow"), "| index substring 'llanow':", searchKey(["Vanilla","Nowadays","Sam"].join(" ")).includes("llanow"));
