import { describe, expect, it } from "vitest";
import { OUTBOUND_KINDS, hostOf, outboundProps } from "../../src/lib/analytics";

/**
 * The shaping of an outbound event, without a browser.
 *
 * `outbound` itself is one `track` call and a try/catch; what is worth pinning
 * is what ends up in the payload — because the failure mode of an analytics
 * call is not a crash, it is quietly sending something it should not, or
 * sending a property whose cardinality turns one chart series into thousands.
 */

describe("hostOf", () => {
  it("reduces a URL to its host", () => {
    expect(hostOf("https://ra.co/events/2457574")).toBe("ra.co");
    expect(hostOf("https://soundcloud.com/someone/a-set")).toBe("soundcloud.com");
  });

  it("drops the www, so one host is one series", () => {
    expect(hostOf("https://www.lyft.com/ride?id=lyft")).toBe("lyft.com");
  });

  it("keeps nothing but the host", () => {
    // The whole point. The Uber and Lyft links carry the venue's coordinates
    // in their query string, and a full URL is unique per event — either would
    // send somewhere it should not, or explode the cardinality, or both.
    const uber =
      "https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff%5Blatitude%5D=40.7108";
    expect(hostOf(uber)).toBe("m.uber.com");
    expect(hostOf(uber)).not.toContain("40.7108");
  });

  it("returns nothing rather than throwing on junk", () => {
    expect(hostOf("not a url")).toBeUndefined();
    expect(hostOf("")).toBeUndefined();
    expect(hostOf(null)).toBeUndefined();
    expect(hostOf(undefined)).toBeUndefined();
  });
});

describe("outboundProps", () => {
  it("passes through the facts it is given", () => {
    expect(outboundProps({ venue: "Nowadays", host: "ra.co" })).toEqual({
      venue: "Nowadays",
      host: "ra.co",
    });
  });

  it("drops absent values rather than sending the string null", () => {
    // An absent property and the string "null" chart differently, and only one
    // of them is true.
    expect(outboundProps({ venue: null, eventId: undefined, host: "ra.co" })).toEqual({
      host: "ra.co",
    });
  });

  it("drops blanks", () => {
    expect(outboundProps({ venue: "   ", host: "" })).toEqual({});
  });

  it("trims", () => {
    expect(outboundProps({ venue: "  Bossa Nova Civic Club  " })).toEqual({
      venue: "Bossa Nova Civic Club",
    });
  });

  it("caps a long value rather than letting it be truncated silently", () => {
    const long = "x".repeat(500);
    const props = outboundProps({ venue: long });
    expect(props.venue!.length).toBe(80);
  });

  it("sends nothing at all when given nothing", () => {
    expect(outboundProps({})).toEqual({});
  });
});

describe("the set of exits", () => {
  it("is closed, so a typo cannot become a duplicate series", () => {
    expect([...OUTBOUND_KINDS]).toEqual([
      "tickets",
      "uber",
      "lyft",
      "maps",
      "artist-link",
      "donate",
    ]);
  });
});
