import { useEffect, useRef } from "react";
import { addDays, format, isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import { currentNight } from "@/lib/night";
import { usePrefetchEvents } from "@/hooks/useEvents";

interface DatePickerProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

/**
 * How far the strip runs either side of tonight.
 *
 * It used to be eight chips wide and it moved its own window when you used the
 * calendar to jump outside it — which meant the strip you scrolled back to was
 * never the strip you left. A long scrollable rail has no window to shift, so
 * position is just position, and the past is reachable by dragging rather than
 * by knowing that the calendar exists.
 */
const DAYS_BACK = 14;
const DAYS_FORWARD = 45;

export function DatePicker({ selectedDate, onDateChange }: DatePickerProps) {
  const prefetchEvents = usePrefetchEvents();
  const railRef = useRef<HTMLDivElement>(null);

  // The night, not the calendar date — before 3:30am these differ, and the
  // strip has to agree with the day the app opened on.
  const tonight = currentNight();
  const start = addDays(tonight, -DAYS_BACK);
  const dates = Array.from({ length: DAYS_BACK + DAYS_FORWARD + 1 }, (_, i) =>
    addDays(start, i),
  );

  /**
   * Park the selected day in the *second* slot, so the night before it stays
   * visible on its left and everything ahead fills the rest of the rail.
   *
   * Centring was the first attempt and it wasted half the strip: a listings app
   * is read forwards, and putting the current night in the middle means half of
   * what you can see is already over. One day of history is the amount anyone
   * actually wants — "what did I miss last night" — and the rest of the width
   * goes to nights you can still get to.
   */
  useEffect(() => {
    const rail = railRef.current;
    const chip = rail?.querySelector<HTMLElement>("[data-selected='true']");
    if (!rail || !chip) return;
    const first = (chip.previousElementSibling as HTMLElement | null) ?? chip;

    // `scrollIntoView`, not arithmetic on `offsetLeft` — that is measured from
    // the nearest *positioned* ancestor rather than from the scroll container,
    // so it reads from the wrong origin and lands the rail a few pixels past
    // the chip, shaving its left edge. The browser also honours the rail's
    // `scroll-pl-2`, which is what leaves a gutter instead of pinning the chip
    // flush to the screen edge.
    first.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }, [selectedDate]);

  // Warm the day before it's tapped. On touch, `touchstart` fires well before
  // the click, so the fetch is usually already in flight by the time it lands.
  const handlePrefetch = (date: Date) => {
    prefetchEvents(format(date, "yyyy-MM-dd"));
  };

  return (
    <div
      ref={railRef}
      // `snap-x` so a flick settles on a chip rather than mid-gap, and
      // `overscroll-x-contain` so dragging past the end does not hand the
      // gesture to Safari's back-swipe.
      className="flex gap-1.5 overflow-x-auto overscroll-x-contain scroll-smooth snap-x scroll-pl-2 px-2 pb-1 no-scrollbar"
    >
      {dates.map((date) => {
        const isSelected = isSameDay(date, selectedDate);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isPast = date < tonight && !isSameDay(date, tonight);

        return (
          <button
            key={date.toISOString()}
            data-selected={isSelected}
            onClick={() => onDateChange(date)}
            onTouchStart={() => handlePrefetch(date)}
            onMouseEnter={() => handlePrefetch(date)}
            aria-pressed={isSelected}
            aria-label={format(date, "EEEE d MMMM")}
            className={cn(
              // 2.28rem is 3.25 less thirty percent. Still rem, so it tracks
              // the text-size preference — the chips get narrower, not
              // permanently 36px regardless of how big the type inside them is.
              // Type sizes are untouched; only the box around them moved.
              "flex w-[2.28rem] flex-shrink-0 snap-start flex-col items-center rounded-md border py-1.5 transition-all duration-200 active:scale-95",
              isSelected
                // Filled, ringed and slightly raised. On a rail where every
                // chip looks alike, one of those three alone reads as a hover
                // state rather than as the current day.
                ? "border-primary bg-primary text-primary-foreground ring-2 ring-primary/40 glow-primary-sm"
                : isWeekend
                  ? "border-border/30 bg-accent/50 hover:bg-accent active:bg-accent"
                  : "border-border/30 bg-card hover:bg-accent active:bg-accent",
              // Days already gone are still reachable — "what did I miss" is a
              // real question — but they should not compete with the ones you
              // can still go to.
              !isSelected && isPast && "opacity-45",
            )}
          >
            <span
              className={cn(
                "text-[0.5rem] font-medium uppercase tracking-wide",
                isSelected ? "text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {format(date, "EEE")}
            </span>
            <span
              className={cn(
                "text-xs font-semibold",
                isSelected ? "text-primary-foreground" : "text-foreground",
              )}
            >
              {format(date, "d")}
            </span>
            <span className="text-[0.4375rem] uppercase tracking-wider opacity-60">
              {format(date, "MMM")}
            </span>
          </button>
        );
      })}
    </div>
  );
}
