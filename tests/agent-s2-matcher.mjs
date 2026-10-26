// tests/agent-s2-tmp/lib/db.ts
import { neon } from "@neondatabase/serverless";

// tests/agent-s2-tmp/lib/normalize.ts
var TRANSLITERATIONS = {
  \u00F8: "o",
  \u00E6: "ae",
  \u0153: "oe",
  \u00DF: "ss",
  \u0142: "l",
  \u0111: "d",
  \u00F0: "d",
  \u00FE: "th",
  \u0127: "h",
  \u0131: "i"
};
function normalizeName(value) {
  return value.toLowerCase().replace(/\([^)]*\)/g, "").replace(/&/g, "and").replace(/[øæœßłđðþħı]/g, (c) => TRANSLITERATIONS[c] ?? c).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").trim();
}
var LEET = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
  "!": "i"
};
function searchKey(value) {
  return normalizeName(value.replace(/[0134578@$!]/g, (c) => LEET[c] ?? c));
}
function withinEditDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  if (a === b) return true;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
      current.push(value);
      if (value < best) best = value;
    }
    if (best > max) return false;
    previous = current;
  }
  return previous[b.length] <= max;
}

// tests/agent-s2-tmp/lib/vocab.ts
var VOCAB = {
  techno: ["techno", "tekno", "industrial", "ebm", "hardgroove", "warehouse"],
  house: ["house", "disco", "garage", "lofi", "deephouse", "techhouse"],
  disco: ["disco", "italo", "nudisco", "boogie", "funk"],
  jungle: ["jungle", "dnb", "drumandbass", "breakbeat", "breaks", "hardcore"],
  bass: ["bass", "dubstep", "grime", "uk", "garage"],
  trance: ["trance", "psytrance", "hardstyle", "gabber"],
  ambient: ["ambient", "drone", "listening", "experimental", "sound bath"],
  dembow: ["dembow", "reggaeton", "perreo", "latin", "cumbia", "baile"],
  afro: ["afro", "afrohouse", "amapiano", "gqom", "highlife"],
  // Vibe rather than genre. These are the words people actually type when they
  // are choosing a night rather than a sound.
  after: ["after", "afters", "afterhours", "sunrise", "morning", "allnight", "late"],
  queer: ["queer", "gay", "lesbian", "trans", "femme", "drag", "pride", "unter", "papijuice"],
  lgbtq: ["queer", "gay", "lesbian", "trans", "femme", "drag", "pride", "unter", "papijuice"],
  heads: ["heads", "headsy", "deep", "nerd", "sound system", "soundsystem"],
  dirty: ["dirty", "filth", "raw", "grimy", "sweaty", "basement"],
  rooftop: ["rooftop", "roof", "terrace", "outdoor", "garden", "backyard", "daytime"],
  day: ["day", "daytime", "daytimedisco", "brunch", "afternoon", "outdoor"],
  loft: ["loft", "diy", "warehouse", "underground", "secret", "tba"],
  live: ["live", "liveset", "band", "performance", "av"]
};
function expandTerm(term) {
  const key = searchKey(term);
  if (!key) return [];
  const extra = VOCAB[key];
  if (!extra) return [key];
  return [.../* @__PURE__ */ new Set([key, ...extra.map(searchKey).filter(Boolean)])];
}

// tests/agent-s2-tmp/lib/ra.ts
function normalizeImageUrl(src) {
  const s = src.trim();
  if (s.startsWith("http")) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.includes("images.ra.co/")) {
    return `https://${s.replace(/^https?:\/\//, "").replace(/^\/+/, "")}`;
  }
  return `https://images.ra.co/${s.replace(/^\/+/, "")}`;
}
function transformListing(listing) {
  const event = listing.event;
  const rawImage = event.flyerFront ?? event.images?.[0]?.filename ?? null;
  return {
    id: event.id,
    title: event.title,
    date: event.date,
    startTime: event.startTime ?? "",
    endTime: event.endTime ?? "",
    url: `https://ra.co${event.contentUrl}`,
    imageUrl: rawImage ? normalizeImageUrl(rawImage) : null,
    // The id travels with the name so the venue sheet can ask RA for an
    // address. Nullable because a TBA listing has no venue at all.
    venue: {
      id: event.venue?.id ?? null,
      name: event.venue?.name ?? "TBA",
      area: "New York"
    },
    // Keep ids, not just names: the artist page and its Mixcloud lookup are
    // keyed on them, and RA reuses names across different artists.
    artists: event.artists?.map((a) => ({ id: a.id, name: a.name })) ?? [],
    attending: event.attending ?? 0,
    isPick: Boolean(event.pick),
    pickBlurb: event.pick?.blurb ?? null
  };
}
var FUZZY_MIN_LENGTH = 5;
function matchesTerm(event, term) {
  const exact = normalizeName(term);
  if (!exact) return false;
  const fields = [event.title, event.venue.name, ...event.artists.map((a) => a.name)];
  if (fields.some((value) => normalizeName(value).includes(exact))) return true;
  const keys = expandTerm(term);
  if (keys.some((key) => fields.some((value) => searchKey(value).includes(key)))) {
    return true;
  }
  const folded = keys[0] ?? "";
  const split = (value) => value.split(/[\s,&·/]+/).map(searchKey).filter(Boolean);
  const words = (value) => split(value).filter((key) => key.length >= FUZZY_MIN_LENGTH);
  const pool = (value) => {
    const parts = split(value);
    const out = [];
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i].length >= FUZZY_MIN_LENGTH) out.push(parts[i]);
      if (i + 1 < parts.length) {
        const pair = parts[i] + parts[i + 1];
        if (pair.length >= FUZZY_MIN_LENGTH) out.push(pair);
      }
    }
    return out;
  };
  const haystack = fields.flatMap(pool);
  if (haystack.length === 0) return false;
  const near = (needle) => haystack.some((word) => withinEditDistance(word, needle, 1));
  const termWords = words(term);
  if (termWords.length === 0) {
    return folded.length >= FUZZY_MIN_LENGTH && near(folded);
  }
  return termWords.every(near);
}
export {
  expandTerm,
  matchesTerm,
  normalizeName,
  searchKey,
  transformListing
};
