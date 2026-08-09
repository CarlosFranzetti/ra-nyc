import { describe, expect, it } from "vitest";
import {
  applyFilters,
  filterCounts,
  isFree,
  startsBeforeMidnight,
} from "../../src/lib/filters";
import type { Event } from "../../src/types/event";

const ev = (over: Partial<Event> = {}): Event => ({
  id: "e1",
  title: "Untitled Night",
  date: "2026-08-09T00:00:00.000",
  startTime: "2026-08-09T22:00:00.000",
  endTime: "2026-08-10T04:00:00.000",
  url: "https://ra.co/events/1",
  imageUrl: null,
  venue: { name: "Nowadays", area: "New York" },
  artists: [],
  attending: 0,
  isPick: false,
  pickBlurb: null,
  ...over,
});

describe("isFree", () => {
  it("accepts the phrasings that actually quote a price", () => {
    for (const title of [
      "Warehouse — Free Entry",
      "Rooftop / free admission",
      "Basement (No Cover)",
      "Loft · FREE",
      "Backyard — $0",
      "Sunset Sessions: free before 10pm",
      "Block Party free w/ RSVP",
    ]) {
      expect(isFree(ev({ title })), title).toBe(true);
    }
  });

  it("does not read a party's name as a price", () => {
    // The whole reason the naive /\bfree\b/ was rejected: these are titles, not
    // door policies, and a wrong "Free" chip gets someone turned away.
    for (const title of [
      "Free Your Mind",
      "Freedom Party",
      "Sugar Free",
      "Free Jazz Ensemble",
      "Freeform w/ Objekt",
    ]) {
      expect(isFree(ev({ title })), title).toBe(false);
    }
  });

  it("reads the RA Pick blurb too", () => {
    expect(isFree(ev({ pickBlurb: "A rare free entry from the crew." }))).toBe(true);
  });
});

describe("startsBeforeMidnight", () => {
  it("counts an evening start", () => {
    expect(startsBeforeMidnight(ev({ startTime: "2026-08-09T22:00:00.000" }))).toBe(true);
    expect(startsBeforeMidnight(ev({ startTime: "2026-08-09T23:59:00.000" }))).toBe(true);
  });

  it("rejects a start that has already rolled past midnight", () => {
    // Filed under the 9th, starts at 2am on the 10th — the case the hour alone
    // cannot distinguish, because every hour is "before 24".
    expect(startsBeforeMidnight(ev({ startTime: "2026-08-10T02:00:00.000" }))).toBe(false);
    expect(startsBeforeMidnight(ev({ startTime: "2026-08-09T03:00:00.000" }))).toBe(false);
  });

  it("falls back to the listing date when there is no start time", () => {
    expect(startsBeforeMidnight(ev({ startTime: "" }))).toBe(false);
  });
});

describe("applyFilters", () => {
  const events = [
    ev({ id: "pick-early", isPick: true }),
    ev({ id: "free-late", title: "Loft — Free Entry", startTime: "2026-08-10T01:00:00.000" }),
    ev({ id: "plain" }),
  ];

  it("returns everything when nothing is selected", () => {
    expect(applyFilters(events, [])).toHaveLength(3);
  });

  it("narrows rather than widens when several are selected", () => {
    expect(applyFilters(events, ["free"]).map((e) => e.id)).toEqual(["free-late"]);
    expect(applyFilters(events, ["free", "early"])).toHaveLength(0);
  });
});

describe("filterCounts", () => {
  const events = [
    ev({ id: "a", isPick: true, title: "Warehouse — Free Entry" }),
    ev({ id: "b", isPick: true, startTime: "2026-08-10T02:00:00.000" }),
    ev({ id: "c" }),
  ];

  it("counts each chip against the filters already on", () => {
    // With "pick" active, "early" must report 1 (of the two picks), not 2 (of
    // the whole day) — otherwise a chip promises more than tapping it delivers.
    expect(filterCounts(events, ["pick"])).toEqual({ pick: 2, free: 1, early: 1 });
    expect(filterCounts(events, [])).toEqual({ pick: 2, free: 1, early: 2 });
  });
});
