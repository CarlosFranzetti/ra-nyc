import { describe, expect, it } from "vitest";
import {
  buildArtistContext,
  contextScore,
  pickByContext,
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
