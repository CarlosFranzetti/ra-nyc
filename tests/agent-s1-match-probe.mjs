// Probe only (agent S1). Run: npx vite-node tests/agent-s1-match-probe.mjs
// Calls the exported matcher functions on adversarial inputs. No network.
import { isPlausibleMatch } from "../api/_lib/artistLinks.ts";
import {
  buildArtistContext,
  contextScore,
  pickByContext,
} from "../api/_lib/artistContext.ts";
import { normalizeName } from "../api/_lib/normalize.ts";

const row = (label, v) => console.log(label.padEnd(64), v);

console.log("\n== A. name test on handle shapes ==");
for (const [a, c] of [
  ["Cosmo (NY)", "Cosmo"],
  ["Cosmo (NY)", "cosmobandz"], // production pick for RA 103962
  ["Cosmo (NY)", "DJ Cosmo"],
  ["Cosmo (NY)", "djcosmo_sns"],
  ["Cosmo", "cosmo_nyc"],
  ["Cosmo", "cosmo.music"],
  ["Cosmo", "cosmos"],
  ["Cosmo", "Cosmo Hamada"],
  ["Gianna (US)", "Gianna (US)"],
  ["Gianna (US)", "gianna-y-g-ingalls"],
  ["Beatrice Dillon", "beatricedillonmusic"],
  ["Objekt", "objekt_official"],
  ["Objekt", "objekt-uk"],
  ["Bjørn Torske", "bjorntorske"],
  ["Jordan Rakei", "jordanrakeiofficial"],
  ["Ben UFO", "benufo_"],
  ["Ben UFO", "ben-ufo-official"],
  ["Four Tet", "fourtet"],
  ["Eris Drew", "erisdrewmusic"],
  ["DJ Python", "python"],
  ["Python", "djpython"],
  ["Peggy Gou", "peggygou_official"],
  ["Nina Kraviz", "ninakraviz"],
  ["DJ Nobu", "nobu"], // core "nobu" (4) -> candidate shorter than artist
  ["Lakuti", "lakutifanpage"],
]) {
  row(`isPlausibleMatch(${JSON.stringify(a)}, ${JSON.stringify(c)})`, isPlausibleMatch(a, c));
}

console.log("\n== B. 'ny' parenthetical term is a raw substring ==");
const ctx = buildArtistContext("Cosmo (NY)", null);
row("terms for 'Cosmo (NY)' with no bio", JSON.stringify(ctx.terms));
for (const text of [
  "DJ Cosmo is a Southwest Florida-based DJ and producer", // production Mixcloud bio (wrong Cosmo)
  "Booking: company@example.com",
  "many parties, funny nights, sunny days",
  "Brooklyn / New York resident",
  "NYC",
  "Based in Miami",
]) {
  row(`contextScore vs ${JSON.stringify(text.slice(0, 50))}`, contextScore(ctx, text));
}

console.log("\n== C. terms from a synthetic NY bio ==");
const bio =
  "Cosmo is a Brooklyn-based DJ and a resident at Public Records. She has played Good Room, Elsewhere and Nowadays and runs a night with Resolute.";
const c2 = buildArtistContext("Cosmo (NY)", bio);
row("terms", JSON.stringify(c2.terms));
const cands = [
  { username: "Cosmo", description: "DJ Cosmo is a Southwest Florida-based DJ" },
  { username: "cosmo_nyc", description: "Brooklyn. Public Records resident." },
];
row(
  "pickByContext with bio -> ",
  pickByContext(cands, c2, (u) => [u.username, u.description])?.username,
);
// Same candidates but with only the parenthetical (what production sees today)
row(
  "pickByContext, parenthetical only -> ",
  pickByContext(cands, ctx, (u) => [u.username, u.description])?.username,
);
row("cosmo_nyc passes name test for 'Cosmo (NY)'?", isPlausibleMatch("Cosmo (NY)", "cosmo_nyc"));

console.log("\n== D. titleMentions (non-exported) re-implemented verbatim ==");
const titleMentions = (name, title) => {
  const a = normalizeName(name);
  return a.length >= 4 && normalizeName(title).includes(a);
};
for (const t of [
  "cosmo @ The Lot Radio 08-29-2026",
  "Blackpool NY Podcast#3: Cosmo Hamada, Cassius Luber, and Miles Wachsteter.",
  "Cosmos Radio Hour 14",
  "Cosmopolitan Brunch Mix",
  "Lepota Luba Cosmo - Lowest Edge",
]) {
  row(`titleMentions("Cosmo (NY)", ${JSON.stringify(t.slice(0, 40))})`, titleMentions("Cosmo (NY)", t));
}
