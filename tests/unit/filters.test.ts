import { describe, expect, it } from "vitest";
import { applyFilters, filterCounts } from "../../src/lib/filters";
import type { Event } from "../../src/types/event";

const ev = (id: string, attending: number, isPick = false): Event => ({
  id,
  title: `Event ${id}`,
  date: "2026-08-09T00:00:00.000",
  startTime: "2026-08-09T22:00:00.000",
  endTime: "2026-08-10T04:00:00.000",
  url: "https://ra.co/events/1",
  imageUrl: null,
  venue: { name: "Nowadays", area: "New York" },
  artists: [],
  attending,
  isPick,
  pickBlurb: null,
});

/** Nine events, head counts 900 down to 100 — three clean thirds. */
const night = [900, 800, 700, 600, 500, 400, 300, 200, 100].map((n, i) =>
  ev(String(i), n, i === 4),
);

describe("applyFilters", () => {
  it("returns everything when nothing is selected", () => {
    expect(applyFilters(night, [])).toHaveLength(9);
  });

  it("takes the busiest third", () => {
    expect(applyFilters(night, ["busy"]).map((e) => e.attending)).toEqual([900, 800, 700]);
  });

  it("and the quietest third", () => {
    expect(applyFilters(night, ["lowkey"]).map((e) => e.attending)).toEqual([300, 200, 100]);
  });

  it("leaves the middle third to neither", () => {
    const tiered = [...applyFilters(night, ["busy"]), ...applyFilters(night, ["lowkey"])];
    expect(tiered.map((e) => e.attending)).not.toContain(500);
  });

  it("narrows rather than widens when several are selected", () => {
    // The one RA Pick sits at 500, in the middle third — so Pick + Busy is
    // empty, which is the honest answer rather than a union of the two.
    expect(applyFilters(night, ["pick"])).toHaveLength(1);
    expect(applyFilters(night, ["pick", "busy"])).toHaveLength(0);
  });
});

describe("tiers are relative to the night, not absolute", () => {
  // The whole reason a fixed head count was rejected: a Tuesday's biggest room
  // draws fewer people than a Saturday's quietest, and either chip would be
  // dead on half the days of the week.
  const tuesday = [30, 24, 18, 12, 6, 3].map((n, i) => ev(String(i), n));

  it("still finds a busiest third on a quiet night", () => {
    expect(applyFilters(tuesday, ["busy"]).map((e) => e.attending)).toEqual([30, 24]);
  });

  it("and a quietest third", () => {
    expect(applyFilters(tuesday, ["lowkey"]).map((e) => e.attending)).toEqual([6, 3]);
  });
});

describe("degenerate nights", () => {
  it("leaves both crowd chips empty when nothing has a head count", () => {
    const unknown = [ev("a", 0), ev("b", 0), ev("c", 0, true)];
    expect(applyFilters(unknown, ["busy"])).toHaveLength(0);
    expect(applyFilters(unknown, ["lowkey"])).toHaveLength(0);
    // The editorial signal still works without any numbers.
    expect(applyFilters(unknown, ["pick"])).toHaveLength(1);
  });

  it("does not call a lone event both busy and low-key", () => {
    const single = [ev("a", 40)];
    const both = [
      ...applyFilters(single, ["busy"]),
      ...applyFilters(single, ["lowkey"]),
    ];
    // One event is a third of itself either way; what must not happen is the
    // two chips disagreeing about it while both claiming it.
    expect(both.length).toBeGreaterThan(0);
    expect(applyFilters(single, ["busy", "lowkey"]).length).toBeLessThanOrEqual(1);
  });

  it("ignores events with no head count when ranking", () => {
    const mixed = [ev("a", 900), ev("b", 0), ev("c", 100)];
    expect(applyFilters(mixed, ["lowkey"]).map((e) => e.id)).toEqual(["c"]);
  });
});

describe("filterCounts", () => {
  it("counts each chip against the filters already on", () => {
    // With Pick active, Busy must report what Pick+Busy leaves — 0 — not what
    // Busy alone would leave. Otherwise a chip promises more than tapping it
    // delivers.
    expect(filterCounts(night, ["pick"])).toEqual({ pick: 1, busy: 0, lowkey: 0 });
    expect(filterCounts(night, [])).toEqual({ pick: 1, busy: 3, lowkey: 3 });
  });
});
