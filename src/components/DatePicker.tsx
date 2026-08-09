import { format, addDays, isSameDay, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import { currentNight, isNextNight, isTonight } from "@/lib/night";
import { usePrefetchEvents } from "@/hooks/useEvents";

interface DatePickerProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

export function DatePicker({ selectedDate, onDateChange }: DatePickerProps) {
  const prefetchEvents = usePrefetchEvents();
  // The night, not the calendar date — before 3:30am these are different, and
  // the strip has to agree with the day the app opened on or the highlighted
  // chip sits one place left of "Tonight".
  const tonight = currentNight();
  const yesterday = addDays(tonight, -1);

  // Eight days starting yesterday, but shift the window if the calendar was
  // used to jump somewhere outside it — otherwise the selected day would have
  // no visible chip.
  const daysFromYesterday = differenceInDays(selectedDate, yesterday);
  const startDate =
    daysFromYesterday >= 8 || daysFromYesterday < 0
      ? addDays(selectedDate, -4)
      : yesterday;

  const dates = Array.from({ length: 8 }, (_, i) => addDays(startDate, i));

  // "Tonight", not "Today": at 2am the highlighted chip is yesterday's date,
  // and "Today" sitting on yesterday would read as a bug rather than as the
  // point.
  const getDateLabel = (date: Date) => {
    if (isTonight(date)) return "Tonight";
    if (isNextNight(date)) return "Tmrw";
    return format(date, "EEE");
  };

  // Warm the day before it's tapped. On touch, `touchstart` fires well before
  // the click, so the fetch is usually already in flight by the time it lands.
  const handlePrefetch = (date: Date) => {
    prefetchEvents(format(date, "yyyy-MM-dd"));
  };

  return (
    // The strip fills a phone because eight chips is exactly what a phone
    // holds. Left to fill a laptop it becomes eight 160px slabs of empty card
    // around a two-digit number, so on desktop it stops growing and centres —
    // a date chip has a natural size and it is close to the phone's.
    <div className="flex gap-1 justify-between px-2 lg:mx-auto lg:max-w-xl">
      {dates.map((date) => {
        const isSelected = isSameDay(date, selectedDate);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;

        return (
          <button
            key={date.toISOString()}
            onClick={() => onDateChange(date)}
            onTouchStart={() => handlePrefetch(date)}
            onMouseEnter={() => handlePrefetch(date)}
            aria-pressed={isSelected}
            className={cn(
              "flex flex-col items-center flex-1 py-1 rounded-md transition-all duration-200 border border-border/30 active:scale-95",
              isSelected
                ? "bg-primary text-primary-foreground border-primary glow-primary-sm"
                : isWeekend
                  ? "bg-accent/50 hover:bg-accent active:bg-accent text-muted-foreground"
                  : "bg-card hover:bg-accent active:bg-accent",
            )}
          >
            <span className="text-[0.5rem] font-medium uppercase tracking-wide">
              {getDateLabel(date)}
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
