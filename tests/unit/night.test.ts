import { describe, expect, it } from "vitest";
import { currentNight, isNextNight, isTonight } from "../../src/lib/night";

/** Local wall-clock construction — the whole point is local time, not UTC. */
const at = (iso: string) => new Date(iso);
const day = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("currentNight", () => {
  it("returns today during normal waking hours", () => {
    expect(day(currentNight(at("2026-08-09T19:30:00")))).toBe("2026-08-09");
    expect(day(currentNight(at("2026-08-09T23:59:00")))).toBe("2026-08-09");
  });

  it("still returns the night you started, after midnight", () => {
    // The case the whole file exists for: at 1am the calendar has moved on and
    // the person holding the phone has not.
    expect(day(currentNight(at("2026-08-10T00:01:00")))).toBe("2026-08-09");
    expect(day(currentNight(at("2026-08-10T02:45:00")))).toBe("2026-08-09");
  });

  it("rolls over at 3:30am exactly", () => {
    expect(day(currentNight(at("2026-08-10T03:29:00")))).toBe("2026-08-09");
    expect(day(currentNight(at("2026-08-10T03:30:00")))).toBe("2026-08-10");
    expect(day(currentNight(at("2026-08-10T03:31:00")))).toBe("2026-08-10");
  });

  it("hands back a month and a year when it has to", () => {
    expect(day(currentNight(at("2026-09-01T01:00:00")))).toBe("2026-08-31");
    expect(day(currentNight(at("2027-01-01T02:00:00")))).toBe("2026-12-31");
  });

  it("anchors at noon, so day arithmetic cannot fall back over a DST edge", () => {
    // Midnight-anchored dates minus 24h land at 23:00 the previous day in a
    // spring-forward zone, which silently reads as the day before that.
    expect(currentNight(at("2026-08-09T19:00:00")).getHours()).toBe(12);
    expect(currentNight(at("2026-08-10T01:00:00")).getHours()).toBe(12);
  });
});

describe("isTonight / isNextNight", () => {
  const twoAm = at("2026-08-10T02:00:00");

  it("calls the night you are still out on 'tonight'", () => {
    expect(isTonight(at("2026-08-09T12:00:00"), twoAm)).toBe(true);
    expect(isTonight(at("2026-08-10T12:00:00"), twoAm)).toBe(false);
  });

  it("so the calendar's today is tomorrow, at 2am", () => {
    expect(isNextNight(at("2026-08-10T12:00:00"), twoAm)).toBe(true);
  });

  it("and agrees with the calendar the rest of the time", () => {
    const evening = at("2026-08-09T21:00:00");
    expect(isTonight(at("2026-08-09T12:00:00"), evening)).toBe(true);
    expect(isNextNight(at("2026-08-10T12:00:00"), evening)).toBe(true);
  });
});
