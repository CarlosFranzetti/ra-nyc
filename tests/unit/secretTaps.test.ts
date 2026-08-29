import { describe, expect, it } from "vitest";
import { MAX_GAP_MS, NO_TAPS, TAPS_REQUIRED, tap } from "../../src/lib/secretTaps";

/**
 * The unlock sequence's counting, without a browser.
 *
 * All the interesting cases are about time — pausing mid-run, arming halfway
 * through, finishing a run that started before the panel was opened — and
 * driving seventeen real taps through a DOM to find out what a gap of 1600ms
 * does is a slow way to test arithmetic.
 */

/** Runs `n` taps at `step` apart, starting at t=1000. */
function run(n: number, { armed = true, step = 100, from = NO_TAPS } = {}) {
  let state = from;
  let unlocked = false;
  let now = 1000;
  for (let i = 0; i < n; i++) {
    const result = tap(state, armed, now);
    state = result.state;
    unlocked = result.unlocked;
    now += step;
  }
  return { state, unlocked, now };
}

describe("the logo unlock", () => {
  it("takes seventeen taps", () => {
    // Pinned, not derived: every other test here reads TAPS_REQUIRED, so they
    // would all keep passing if the constant silently changed. The number is
    // the feature.
    expect(TAPS_REQUIRED).toBe(17);
  });

  it("opens on the last tap and not the one before it", () => {
    expect(run(TAPS_REQUIRED - 1).unlocked).toBe(false);
    expect(run(TAPS_REQUIRED).unlocked).toBe(true);
  });

  it("counts nothing at all until Customize has been closed", () => {
    // The whole point of the two-part gesture: hammering the logo on a fresh
    // load must never get there, however long you keep going.
    const { state, unlocked } = run(TAPS_REQUIRED * 2, { armed: false });
    expect(unlocked).toBe(false);
    expect(state).toEqual(NO_TAPS);
  });

  it("throws away a run that was in progress when the sequence was disarmed", () => {
    // A full run less one tap banked, then one tap while disarmed. That tap must not
    // merely fail to count — it must clear the bank, or the run could be
    // finished later without going back through the panel.
    const nearly = run(TAPS_REQUIRED - 1).state;
    expect(nearly.count).toBe(TAPS_REQUIRED - 1);

    const cleared = tap(nearly, false, 5000).state;
    expect(cleared).toEqual(NO_TAPS);
    expect(tap(cleared, true, 5100).unlocked).toBe(false);
  });

  it("restarts when you pause too long, rather than carrying on", () => {
    const nearly = run(TAPS_REQUIRED - 1, { step: 100 });
    // One tap, a fraction past the window.
    const late = tap(nearly.state, true, nearly.now + MAX_GAP_MS + 1);
    expect(late.unlocked).toBe(false);
    // Counted as the first of a new run, not the zeroth — the tap that broke
    // the old run is itself the start of the next one.
    expect(late.state.count).toBe(1);
  });

  it("tolerates a pause right up to the limit", () => {
    let state = NO_TAPS;
    let now = 1000;
    let unlocked = false;
    for (let i = 0; i < TAPS_REQUIRED; i++) {
      const result = tap(state, true, now);
      state = result.state;
      unlocked = result.unlocked;
      // Exactly at the boundary every single time. `>` not `>=` in the
      // implementation is what makes this a complete run rather than
      // seventeen separate first taps.
      now += MAX_GAP_MS;
    }
    expect(unlocked).toBe(true);
  });

  it("resets after opening, so a second visit needs the whole sequence again", () => {
    const first = run(TAPS_REQUIRED);
    expect(first.unlocked).toBe(true);
    expect(first.state).toEqual(NO_TAPS);
    // One more tap on the far side must not immediately re-open it.
    expect(tap(first.state, true, first.now).unlocked).toBe(false);
  });
});
