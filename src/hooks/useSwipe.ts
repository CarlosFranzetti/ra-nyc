import { useRef, type TouchEvent } from "react";

interface UseSwipeOptions {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  /** Minimum horizontal travel, in px, before a gesture counts. */
  threshold?: number;
}

/**
 * Horizontal swipe detection for stepping between days.
 *
 * Uses touch events rather than a gesture library, and deliberately ignores
 * gestures that are mostly vertical — otherwise a normal scroll down the list
 * registers as a swipe and the day changes under the user's thumb, which is
 * the single most annoying way to get this wrong.
 */
export function useSwipe({
  onSwipeLeft,
  onSwipeRight,
  threshold = 60,
}: UseSwipeOptions) {
  const start = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!touch) return;
    start.current = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (event: TouchEvent) => {
    const origin = start.current;
    const touch = event.changedTouches[0];
    start.current = null;
    if (!origin || !touch) return;

    const dx = touch.clientX - origin.x;
    const dy = touch.clientY - origin.y;

    if (Math.abs(dx) < threshold) return;
    // Require the gesture to be more horizontal than vertical.
    if (Math.abs(dx) <= Math.abs(dy)) return;

    if (dx < 0) onSwipeLeft();
    else onSwipeRight();
  };

  return { onTouchStart, onTouchEnd };
}
