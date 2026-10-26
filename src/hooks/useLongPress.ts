import { useCallback, useEffect, useRef } from "react";

/**
 * How long a finger has to stay down before it counts as a hold.
 *
 * 350ms. The owner said "a few ms", and the honest answer is that a few
 * milliseconds is a tap — every tap is a pointer held down for 60–120ms, so a
 * threshold inside that range would turn ordinary taps into holds. 350 is just
 * under iOS's own long-press (about 500) so it feels faster than the system
 * gesture it is standing in for, and far enough above a tap that nobody
 * triggers it by accident.
 */
export const HOLD_MS = 350;

/** Movement past this cancels the hold: the finger is scrolling, not holding. */
const SLOP_PX = 8;

/**
 * A press-and-hold, separated cleanly from a tap on the same element.
 *
 * The element already does something on tap (the flyer closes the sheet), so
 * the hold cannot be "a tap that took longer" — the two have to be told apart
 * before the tap handler runs. The order of events on a hold is pointerdown →
 * (timer fires: `onHold`) → pointerup → **click**. That trailing click is the
 * problem: left alone it would close the sheet the moment the viewer opened.
 * `consumeClick` is the guard — the element's click handler calls it first and
 * returns if it says so.
 *
 * Cancelled by movement (scrolling), by the pointer leaving, and by
 * pointercancel (the browser took the gesture — vaul starting a drag, iOS
 * starting a scroll). Only a finger that stays put for the full `HOLD_MS`
 * counts.
 *
 * Pointer events rather than touch events: one code path for a finger, a
 * mouse and a pen, and Playwright's mouse drives it for the suite.
 */
export function useLongPress(onHold: () => void) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      // A second finger, or a right button, is not a hold.
      if (!event.isPrimary || event.button !== 0) return;
      held.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        held.current = true;
        // A tick of haptic where the platform offers one; a silent no-op on
        // iOS Safari, which does not expose vibrate.
        navigator.vibrate?.(10);
        onHold();
      }, HOLD_MS);
    },
    [onHold],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const start = origin.current;
      if (!start) return;
      if (
        Math.abs(event.clientX - start.x) > SLOP_PX ||
        Math.abs(event.clientY - start.y) > SLOP_PX
      ) {
        clear();
      }
    },
    [clear],
  );

  /**
   * True exactly once after a hold, so the click that follows the release is
   * swallowed instead of firing the element's tap action.
   */
  const consumeClick = useCallback(() => {
    if (!held.current) return false;
    held.current = false;
    return true;
  }, []);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
    },
    consumeClick,
  };
}
