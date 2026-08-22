import { describe, expect, it } from "vitest";
import { isoDay } from "../../api/_lib/eventCache";

/**
 * The date a cached event comes back with.
 *
 * This is a four-line function and it was the most damaging bug in the app.
 * Every date comparison here is a *string* comparison on ten characters —
 * upcoming versus past, which night a listing belongs to, whether the backfill
 * has covered a day — so a malformed day does not throw, it silently answers
 * the wrong question everywhere at once.
 */
describe("isoDay", () => {
  it("handles the case that was actually broken: a JS Date from the driver", () => {
    // Postgres `date` columns come back from the Neon driver as Date objects.
    // `String(...).slice(0, 10)` turned this into "Sun May 24".
    expect(isoDay(new Date("2026-05-24T00:00:00.000Z"))).toBe("2026-05-24");
  });

  it("leaves a bare day alone", () => {
    expect(isoDay("2026-05-24")).toBe("2026-05-24");
  });

  it("truncates an ISO timestamp to its day", () => {
    expect(isoDay("2026-05-24T22:00:00.000Z")).toBe("2026-05-24");
  });

  it("recovers a day even from the format that caused the bug", () => {
    // Belt and braces: if some future driver hands back this shape as a string
    // rather than a Date, parsing it is still better than slicing it.
    expect(isoDay("Sun May 24 2026 00:00:00 GMT+0000")).toBe("2026-05-24");
  });

  it("answers empty rather than nonsense for junk", () => {
    // "" fails the `^\d{4}-\d{2}-\d{2}$` guard everywhere downstream, so an
    // unparseable row is skipped. A half-formed date would be *used*.
    expect(isoDay(null)).toBe("");
    expect(isoDay(undefined)).toBe("");
    expect(isoDay("not a date")).toBe("");
    expect(isoDay(new Date("nonsense"))).toBe("");
  });

  /**
   * The property that actually broke, stated directly.
   *
   * Every letter sorts above every digit, so any weekday-first format compares
   * as later than any ISO date — which classified four months of indexed
   * history as "upcoming" and left search's past list holding only the few days
   * fetched live from RA.
   */
  it("produces a day that sorts correctly against another day", () => {
    const may = isoDay(new Date("2026-05-24T00:00:00.000Z"));
    const august = "2026-08-22";

    expect(may < august).toBe(true);
    // The bug, preserved so the reason this test exists stays legible.
    expect("Sun May 24" < august).toBe(false);
  });
});
