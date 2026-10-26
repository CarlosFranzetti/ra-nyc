import { describe, expect, it } from "vitest";
import {
  buildArtistContext,
  contextScore,
  contradictsOrigin,
  isContradicted,
  pickByContext,
  placesMentioned,
  scoreCandidate,
  soundcloudHandleFrom,
  EMPTY_CONTEXT,
} from "../../api/_lib/artistContext.js";

describe("buildArtistContext — handles", () => {
  it("lifts a SoundCloud handle out of the bio", () => {
    const ctx = buildArtistContext(
      "Objekt",
      "TJ Hertz. Releases on PAN and Hessle Audio. soundcloud.com/objekt",
    );
    expect(ctx.handles.soundcloud).toBe("objekt");
  });

  it("reads a full URL as readily as a bare host", () => {
    const ctx = buildArtistContext(
      "Lakuti",
      "More at https://www.mixcloud.com/lakuti-uzuri/ and elsewhere.",
    );
    expect(ctx.handles.mixcloud).toBe("lakuti-uzuri");
  });

  it("ignores site furniture masquerading as a handle", () => {
    // A bio that links a search rather than a profile must not resolve the
    // artist to a user called "search".
    const ctx = buildArtistContext("Cosmo", "soundcloud.com/search?q=cosmo");
    expect(ctx.handles.soundcloud).toBeNull();
  });

  it("does not match a host that merely ends in soundcloud.com", () => {
    const ctx = buildArtistContext("X", "notsoundcloud.com/impostor");
    expect(ctx.handles.soundcloud).toBeNull();
  });

  it("finds a handle on the second artist resolved by the same instance", () => {
    // The patterns are module-level and /g, so a stale lastIndex would make
    // this pass once and fail forever after.
    buildArtistContext("A", "soundcloud.com/aaaaaaaaaaaaaaaaaaaa");
    const ctx = buildArtistContext("B", "soundcloud.com/bbb");
    expect(ctx.handles.soundcloud).toBe("bbb");
  });
});

describe("buildArtistContext — terms", () => {
  it("reads RA's disambiguating parenthetical off the name", () => {
    // The one signal that survives an artist having no biography at all.
    expect(buildArtistContext("Cosmo (NY)", null).terms).toContain("ny");
  });

  it("ignores RA's numeric tiebreakers", () => {
    expect(buildArtistContext("SRI (1)", null).terms).toEqual([]);
  });

  it("keeps short place names, which the length floor was eating", () => {
    // The floor exists to throw out accidental short tokens from the
    // proper-noun sweep. Places arrive from a curated list, so nothing is
    // accidental — and dropping "nyc" on an app called ra-nyc was absurd.
    const ctx = buildArtistContext("Someone", "A DJ based in NYC, touring the USA.");
    expect(ctx.terms).toContain("nyc");
    expect(ctx.terms).toContain("usa");
  });

  it("picks up places and named affiliations", () => {
    const ctx = buildArtistContext(
      "Mike Servito",
      "Born in Detroit, Servito is a resident at The Bunker New York and has " +
        "played Tresor and Berghain. A regular on the RA Podcast.",
    );
    expect(ctx.terms).toContain("detroit");
    expect(ctx.terms).toContain("newyork");
    expect(ctx.terms).toContain("tresor");
    expect(ctx.terms).toContain("rapodcast");
  });

  it("does not mistake sentence openers for proper nouns", () => {
    const ctx = buildArtistContext(
      "Someone",
      "Since 2010 they have toured. After that came a break. Their sound is raw.",
    );
    expect(ctx.terms).not.toContain("since");
    expect(ctx.terms).not.toContain("after");
    expect(ctx.terms).not.toContain("their");
  });

  it("never lists the artist's own name as corroboration", () => {
    const ctx = buildArtistContext("Tresor", "Tresor is a Berlin institution.");
    expect(ctx.terms).not.toContain("tresor");
    expect(ctx.terms).toContain("berlin");
  });
});

describe("contextScore", () => {
  const ctx = buildArtistContext(
    "Cosmo",
    "A New York DJ and a founding member of Resolute.",
  );

  it("counts the context a candidate echoes back", () => {
    expect(contextScore(ctx, "Resolute resident, New York")).toBeGreaterThan(
      contextScore(ctx, "Techno producer from Leipzig"),
    );
  });

  it("scores zero when there is nothing to go on", () => {
    expect(contextScore(EMPTY_CONTEXT, "anything at all")).toBe(0);
    expect(contextScore(ctx, null, undefined)).toBe(0);
  });
});

describe("pickByContext", () => {
  const ctx = buildArtistContext("Cosmo (NY)", "Founding member of Resolute.");

  it("separates two accounts with the same name", () => {
    const picked = pickByContext(
      [
        { id: "wrong", blurb: "Ambient tapes from Lisbon." },
        { id: "right", blurb: "Resolute. NY." },
      ],
      ctx,
      (c) => [c.blurb],
    );
    expect(picked?.id).toBe("right");
  });

  it("keeps the provider's own ranking when nothing corroborates", () => {
    // Zero is the common answer — most profile blurbs say nothing useful — so
    // an uninformative tie must not reshuffle the search results.
    const picked = pickByContext(
      [{ id: "first", blurb: "" }, { id: "second", blurb: "" }],
      ctx,
      (c) => [c.blurb],
    );
    expect(picked?.id).toBe("first");
  });

  it("handles the empty and single-candidate cases", () => {
    expect(pickByContext([], ctx, () => [])).toBeUndefined();
    expect(pickByContext([{ id: "only" }], ctx, () => [])?.id).toBe("only");
  });
});

describe("word-boundary matching (B6)", () => {
  const ny = buildArtistContext("Cosmo (NY)", null);

  it("no longer finds `ny` inside other words", () => {
    // Each of these scored 1 under the old substring test.
    expect(contextScore(ny, "Booking: company@example.com")).toBe(0);
    expect(contextScore(ny, "many parties, funny nights, sunny days")).toBe(0);
  });

  it("finds a New York artist where the bio says so in words", () => {
    // ...and each of these scored 0.
    expect(contextScore(ny, "Brooklyn / New York resident")).toBeGreaterThan(0);
    expect(contextScore(ny, "NYC")).toBeGreaterThan(0);
    expect(contextScore(ny, "Manhattan-based")).toBeGreaterThan(0);
    expect(contextScore(ny, "From the Bronx")).toBeGreaterThan(0);
    expect(contextScore(ny, "NY")).toBeGreaterThan(0);
  });

  it("still finds multi-word terms across a space", () => {
    const ctx = buildArtistContext("Someone", "Resident at The Bunker New York and on the RA Podcast.");
    expect(contextScore(ctx, "plays the RA Podcast")).toBeGreaterThan(0);
    expect(contextScore(ctx, "new york")).toBeGreaterThan(0);
  });

  it("does not find a term in the middle of a longer word", () => {
    const ctx = buildArtistContext("Someone", "A resident at Tresor.");
    expect(contextScore(ctx, "tresors of the deep")).toBe(0);
    expect(contextScore(ctx, "Tresor")).toBe(1);
  });

  it("only reads `US` and `LA` as places when written in capitals", () => {
    const us = buildArtistContext("Gianna (US)", null);
    expect(contextScore(us, "come and join us")).toBe(0);
    expect(contextScore(us, "US-based")).toBeGreaterThan(0);
    expect(contextScore(us, "Based in the United States")).toBeGreaterThan(0);

    const la = buildArtistContext("Someone (LA)", null);
    expect(contextScore(la, "la musique")).toBe(0);
    expect(contextScore(la, "LA-based")).toBeGreaterThan(0);
    expect(contextScore(la, "Los Angeles")).toBeGreaterThan(0);
  });

  it("has a region table for the other codes too", () => {
    expect(contextScore(buildArtistContext("X (UK)", null), "London")).toBeGreaterThan(0);
    expect(contextScore(buildArtistContext("X (SF)", null), "San Francisco")).toBeGreaterThan(0);
    expect(contextScore(buildArtistContext("X (DC)", null), "Washington DC")).toBeGreaterThan(0);
  });
});

describe("origin (B6)", () => {
  it("expands the parenthetical into the places it stands for", () => {
    const ctx = buildArtistContext("Cosmo (NY)", null);
    expect(ctx.origin?.places).toEqual(
      expect.arrayContaining(["ny", "newyork", "nyc", "brooklyn", "queens", "manhattan", "bronx"]),
    );
  });

  it("has no origin at all when nothing says anywhere", () => {
    expect(buildArtistContext("Cosmo", null).origin).toBeUndefined();
    expect(buildArtistContext("SRI (1)", null).origin).toBeUndefined();
  });

  it("adds the places a bio names, and the rest of a metro it implies", () => {
    const ctx = buildArtistContext("Someone", "Based in Brooklyn.");
    expect(ctx.origin?.places).toEqual(expect.arrayContaining(["brooklyn", "newyork", "nyc"]));
  });

  it("does not treat one UK city as the whole country", () => {
    const ctx = buildArtistContext("Someone", "Based in London.");
    expect(ctx.origin?.places).toContain("london");
    expect(ctx.origin?.places).not.toContain("glasgow");
  });

  it("carries RA's country, code and name", () => {
    const ctx = buildArtistContext("Someone", null, {
      origin: { iso2: "de", countryName: "Germany" },
    });
    expect(ctx.origin).toEqual({ iso2: "DE", places: ["germany"] });
  });

  it("recognises US cities and states", () => {
    expect(placesMentioned("Southwest Florida-based DJ")).toContain("florida");
    expect(placesMentioned("from Houston, now in Los Angeles")).toEqual(
      expect.arrayContaining(["houston", "losangeles"]),
    );
  });
});

describe("handles from RA (B6)", () => {
  it("treats a structured soundcloud field as the artist's own statement", () => {
    const ctx = buildArtistContext("Cosmo", "Also at soundcloud.com/a-label", {
      soundcloud: "https://soundcloud.com/cosmo-nyc",
    });
    expect(ctx.handles.soundcloud).toBe("cosmo-nyc");
    expect(ctx.handleSource.soundcloud).toBe("structured");
  });

  it("marks a handle that came out of prose as such", () => {
    const ctx = buildArtistContext("Cosmo", "Also at soundcloud.com/a-label");
    expect(ctx.handles.soundcloud).toBe("a-label");
    expect(ctx.handleSource.soundcloud).toBe("bio");
  });

  it("accepts a bare handle or an @name, and ignores junk", () => {
    expect(soundcloudHandleFrom("cosmo-nyc")).toBe("cosmo-nyc");
    expect(soundcloudHandleFrom("@cosmo_nyc")).toBe("cosmo_nyc");
    expect(soundcloudHandleFrom("not a handle at all")).toBeNull();
    expect(soundcloudHandleFrom("")).toBeNull();
    expect(soundcloudHandleFrom(null)).toBeNull();
    expect(soundcloudHandleFrom("search")).toBeNull();
  });

  it("is unchanged when RA offers nothing extra", () => {
    const ctx = buildArtistContext("Objekt", "TJ Hertz. soundcloud.com/objekt");
    expect(ctx.handles.soundcloud).toBe("objekt");
    expect(ctx.origin).toBeUndefined();
  });
});

describe("scoreCandidate (B6)", () => {
  const ny = buildArtistContext("Cosmo (NY)", null);

  it("scores a candidate with no fields at zero, never below", () => {
    // Absent fields are "no information", not a penalty.
    expect(scoreCandidate("Cosmo (NY)", ny, {})).toBe(0);
    expect(scoreCandidate("Cosmo", EMPTY_CONTEXT, { description: "anything" })).toBe(0);
  });

  it("ranks the New York account above the Florida one", () => {
    const florida = scoreCandidate("Cosmo (NY)", ny, {
      description: "DJ Cosmo is a Southwest Florida-based DJ and producer",
    });
    const brooklyn = scoreCandidate("Cosmo (NY)", ny, {
      description: "Brooklyn. Resident at Public Records.",
    });
    expect(florida).toBeLessThan(0);
    expect(brooklyn).toBeGreaterThan(0);
  });

  it("rewards a matching country and penalises a conflicting one", () => {
    const ctx = buildArtistContext("Cosmo", null, { origin: { iso2: "US", countryName: "United States" } });
    expect(scoreCandidate("Cosmo", ctx, { countryCode: "US" })).toBe(6);
    expect(scoreCandidate("Cosmo", ctx, { countryCode: "us" })).toBe(6);
    expect(scoreCandidate("Cosmo", ctx, { countryCode: "AU" })).toBe(-4);
    expect(scoreCandidate("Cosmo", ctx, {})).toBe(0);
  });

  it("reads the city against the artist's places", () => {
    expect(scoreCandidate("Cosmo (NY)", ny, { city: "Brooklyn" })).toBeGreaterThanOrEqual(5);
    expect(scoreCandidate("Cosmo (NY)", ny, { city: "New York City" })).toBeGreaterThanOrEqual(5);
    expect(scoreCandidate("Cosmo (NY)", ny, { city: "Miami" })).toBeLessThan(0);
  });

  it("does not call a bio that names both places a contradiction", () => {
    expect(contradictsOrigin(ny, { description: "NYC / Berlin" })).toBe(false);
    expect(contradictsOrigin(ny, { description: "Berlin" })).toBe(true);
  });

  it("cannot contradict an artist whose only origin is a country", () => {
    // Miami is in the US; (US) says nothing about which part.
    const us = buildArtistContext("Gianna (US)", null);
    expect(contradictsOrigin(us, { description: "Miami-based" })).toBe(false);
  });

  it("rewards an exact permalink and a real-looking account", () => {
    const exact = scoreCandidate("Cosmo", EMPTY_CONTEXT, { permalink: "cosmo" });
    const decorated = scoreCandidate("Cosmo", EMPTY_CONTEXT, { permalink: "cosmo_nyc" });
    expect(exact - decorated).toBe(3);

    const big = scoreCandidate("Cosmo", EMPTY_CONTEXT, { followers: 10_000, verified: true });
    expect(big).toBeGreaterThan(4.9);
    expect(scoreCandidate("Cosmo", EMPTY_CONTEXT, { followers: 1_000_000 })).toBe(3);
  });

  it("marks down an account with no uploads and no audience", () => {
    expect(scoreCandidate("Cosmo", EMPTY_CONTEXT, { trackCount: 0, followers: 2 })).toBeLessThan(-6);
    // Both fields must be present for it to apply.
    expect(scoreCandidate("Cosmo", EMPTY_CONTEXT, { trackCount: 0 })).toBe(0);
  });

  it("prefers cosmo_nyc to cosmobandz for Cosmo (NY)", () => {
    const nyc = scoreCandidate("Cosmo (NY)", ny, {
      permalink: "cosmo_nyc",
      description: "Brooklyn. Public Records.",
    });
    const bandz = scoreCandidate("Cosmo (NY)", ny, {
      permalink: "cosmobandz",
      description: "Southwest Florida-based",
    });
    expect(nyc).toBeGreaterThan(bandz);
  });
});

describe("isContradicted (B6)", () => {
  const ny = buildArtistContext("Cosmo (NY)", null);

  it("flags an account that names somewhere else and nothing corroborates it", () => {
    expect(isContradicted(ny, { description: "Southwest Florida-based DJ" })).toBe(true);
  });

  it("does not flag one that says nothing", () => {
    expect(isContradicted(ny, {})).toBe(false);
    expect(isContradicted(ny, { description: "Techno and house." })).toBe(false);
  });

  it("is overruled by a matching country", () => {
    const ctx = buildArtistContext("Cosmo (NY)", null, { origin: { iso2: "US", countryName: "United States" } });
    expect(isContradicted(ctx, { description: "Miami", countryCode: "US" })).toBe(false);
  });
});
