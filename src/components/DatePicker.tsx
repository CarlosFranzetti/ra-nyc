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

  // Keep the selected chip on screen when the date changes from somewhere else
  // — the calendar, a search result. Without this, picking a date three weeks
  // out silently highlights a chip nobody can see.
  useEffect(() => {
    const rail = railRef.current;
    const chip = rail?.querySelector<HTMLElement>("[data-selected='true']");
    if (!rail || !chip) return;
    const target = chip.offsetLeft - rail.clientWidth / 2 + chip.clientWidth / 2;
    rail.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
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
      className="flex gap-1.5 overflow-x-auto overscroll-x-contain scroll-smooth snap-x px-2 pb-1 no-scrollbar"
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
              "flex w-[3.25rem] flex-shrink-0 snap-start flex-col items-center rounded-md border py-1.5 transition-all duration-200 active:scale-95",
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
