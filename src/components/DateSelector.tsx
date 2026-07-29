import { format, addDays, subDays, isToday, isWeekend } from "date-fns";
import { cn } from "@/lib/utils";
import type { NavMode } from "@/types/preferences";

interface DateSelectorProps {
  selectedDate: Date;
  onSelect: (date: Date) => void;
  navMode: NavMode;
}

const DAY_COUNT = 8;

export default function DateSelector({
  selectedDate,
  onSelect,
  navMode,
}: DateSelectorProps) {
  const yesterday = subDays(new Date(), 1);
  const dates = Array.from({ length: DAY_COUNT }, (_, i) => addDays(yesterday, i));
  const selectedKey = format(selectedDate, "yyyy-MM-dd");

  // Minimal mode hides the picker entirely; the swipe handler on the list is
  // the only way to change day, and HomePage shows the current date instead.
  if (navMode === "minimal") return null;

  // Tabs mode fits the whole week on screen as equal columns — no scrolling,
  // no clipping, at the cost of smaller targets.
  if (navMode === "tabs") {
    return (
      <div className="grid grid-cols-8 gap-1 px-3 py-3">
        {dates.map((date) => {
          const isSelected = format(date, "yyyy-MM-dd") === selectedKey;
          return (
            <button
              key={date.toISOString()}
              onClick={() => onSelect(date)}
              aria-pressed={isSelected}
              className={cn(
                "flex flex-col items-center justify-center py-1.5 rounded-md text-[10px] transition-all duration-150 border active:scale-95",
                isSelected
                  ? "bg-primary text-primary-foreground border-primary font-medium"
                  : isWeekend(date)
                    ? "bg-accent/50 text-foreground border-border active:bg-accent"
                    : "bg-secondary text-foreground border-border active:bg-accent",
              )}
            >
              <span>{isToday(date) ? "Now" : format(date, "EEEEE")}</span>
              <span className="opacity-70">{format(date, "d")}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    // overflow-hidden clipped the last dates out of reach on narrow phones —
    // they were rendered but unscrollable. Scroll horizontally instead, with
    // snap points so it settles on a date rather than mid-card.
    <div className="flex gap-1.5 px-3 py-3 overflow-x-auto snap-x snap-mandatory no-scrollbar">
      {dates.map((date) => {
        const isSelected = format(date, "yyyy-MM-dd") === selectedKey;
        return (
          <button
            key={date.toISOString()}
            onClick={() => onSelect(date)}
            aria-pressed={isSelected}
            className={cn(
              "flex flex-col items-center shrink-0 snap-start px-2.5 py-1.5 rounded-md text-xs transition-all duration-150 border min-w-[42px]",
              // Touch devices have no hover, so without an active: state a tap
              // gives no feedback at all until the data arrives.
              "active:scale-95",
              isSelected
                ? "bg-primary text-primary-foreground border-primary"
                : isWeekend(date)
                  ? "bg-accent/50 text-foreground border-border hover:bg-accent active:bg-accent"
                  : "bg-secondary text-foreground border-border hover:bg-accent active:bg-accent",
            )}
          >
            <span className="font-medium">
              {isToday(date) ? "Today" : format(date, "EEE")}
            </span>
            <span className="text-[10px] opacity-70">{format(date, "d MMM")}</span>
          </button>
        );
      })}
    </div>
  );
}
