/**
 * The unlock sequence for the hidden screen.
 *
 * Open Customize, close it, then tap the logo seventeen times in a row.
 *
 * Pure and separate from the component so the counting can be tested without a
 * browser — the interesting cases are all about *time*, and driving seventeen
 * taps through a real DOM to find out what happens when you pause in the middle
 * is a slow way to test arithmetic.
 */

/** Taps required. Chosen by the owner; no significance beyond being a lot. */
export const TAPS_REQUIRED = 17;

/**
 * How long a run survives between taps.
 *
 * "In a row" has to mean something, or the counter is a lifetime tally and the
 * screen eventually opens by accident — seventeen taps on the app's title
 * across six months of use is not a secret, it is a trap. A second and a half
 * is far longer than the gap between deliberate repeated taps and far shorter
 * than the gap between two unrelated ones.
 */
export const MAX_GAP_MS = 1_500;

export interface TapState {
  /** Taps so far in the current run. */
  count: number;
  /** When the last one landed, as a timestamp. */
  at: number;
}

export const NO_TAPS: TapState = { count: 0, at: 0 };

/**
 * Advances the run, and says whether this tap completed it.
 *
 * `armed` is the first half of the sequence: it is set by Customize closing
 * and is what makes this a two-part gesture rather than "tap the logo a lot".
 * A tap while disarmed does not merely fail to count — it clears whatever had
 * accumulated, so a run started before the panel was opened cannot be finished
 * after it.
 */
export function tap(
  state: TapState,
  armed: boolean,
  now: number,
): { state: TapState; unlocked: boolean } {
  if (!armed) return { state: NO_TAPS, unlocked: false };

  // A gap longer than the window starts a new run *at one* rather than at zero:
  // the tap that broke the old run is itself the first tap of the next one,
  // which is what it feels like from the other side of the screen.
  const count = now - state.at > MAX_GAP_MS ? 1 : state.count + 1;

  if (count >= TAPS_REQUIRED) return { state: NO_TAPS, unlocked: true };
  return { state: { count, at: now }, unlocked: false };
}
