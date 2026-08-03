import { afterEach, describe, expect, it, vi } from "vitest";
import { formatClock } from "../../src/lib/formatClock";
import { formatEventDay } from "../../src/lib/formatEventDay";
import { formatDuration } from "../../src/lib/formatDuration";
import { clientIp, rateLimit } from "../../api/_lib/rateLimit.js";

describe("formatClock", () => {
  it("formats under an hour without an hours field", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(9)).toBe("0:09");
    expect(formatClock(252)).toBe("4:12");
  });

  it("adds hours only once there are hours", () => {
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3661)).toBe("1:01:01");
  });

  it("returns a placeholder rather than NaN for unusable input", () => {
    expect(formatClock(null)).toBe("--:--");
    expect(formatClock(Number.NaN)).toBe("--:--");
    expect(formatClock(-5)).toBe("--:--");
  });
});

describe("formatEventDay", () => {
  // RA sends naive timestamps. Parsing one directly reads it in the *viewer's*
  // zone, which puts a late-night event on the wrong day west of UTC.
  it("reads the date prefix, not the local interpretation of the timestamp", () => {
    expect(formatEventDay("2026-08-09T22:00:00.000")).toBe("Sun, Aug 9");
    expect(formatEventDay("2026-08-09T00:30:00.000")).toBe("Sun, Aug 9");
  });

  it("returns empty for unusable input rather than 'Invalid Date'", () => {
    expect(formatEventDay("nonsense")).toBe("");
    expect(formatEventDay("")).toBe("");
  });
});

describe("formatDuration", () => {
  it("renders minutes and hours the way a set list reads", () => {
    expect(formatDuration(600)).toBe("10m");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(5400)).toBe("1h 30m");
  });

  it("returns null for missing or zero length", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
  });
});

describe("rateLimit", () => {
  afterEach(() => vi.useRealTimers());

  it("allows up to the limit then refuses", () => {
    const key = `test-${Math.random()}`;
    const budget = { limit: 3, windowMs: 60_000 };
    expect(rateLimit(key, budget).ok).toBe(true);
    expect(rateLimit(key, budget).ok).toBe(true);
    expect(rateLimit(key, budget).ok).toBe(true);
    expect(rateLimit(key, budget).ok).toBe(false);
  });

  it("keeps separate budgets per key, so one caller cannot lock out another", () => {
    const budget = { limit: 1, windowMs: 60_000 };
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    expect(rateLimit(a, budget).ok).toBe(true);
    expect(rateLimit(a, budget).ok).toBe(false);
    expect(rateLimit(b, budget).ok).toBe(true);
  });

  it("reports a positive retry-after when it refuses", () => {
    const key = `retry-${Math.random()}`;
    const budget = { limit: 1, windowMs: 60_000 };
    rateLimit(key, budget);
    const refused = rateLimit(key, budget);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("rolls the window over once it expires", () => {
    vi.useFakeTimers();
    const key = `roll-${Math.random()}`;
    const budget = { limit: 1, windowMs: 1_000 };
    expect(rateLimit(key, budget).ok).toBe(true);
    expect(rateLimit(key, budget).ok).toBe(false);
    vi.advanceTimersByTime(1_500);
    expect(rateLimit(key, budget).ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("takes the first hop of x-forwarded-for, which is the real client", () => {
    expect(
      clientIp({ headers: { "x-forwarded-for": "203.0.113.5, 70.41.3.18" } } as never),
    ).toBe("203.0.113.5");
  });

  it("falls back to something stable when no header is present", () => {
    expect(typeof clientIp({ headers: {} } as never)).toBe("string");
  });
});
