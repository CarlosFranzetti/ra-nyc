import { format, addDays, isSameDay, isToday, isTomorrow, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import { usePrefetchEvents } from "@/hooks/useEvents";

interface DatePickerProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

export function DatePicker({ selectedDate, onDateChange }: DatePickerProps) {
  const prefetchEvents = usePrefetchEvents();
  const today = new Date();
  const yesterday = addDays(today, -1);

  // Eight days starting yesterday, but shift the window if the calendar was
  // used to jump somewhere outside it — otherwise the selected day would have
  // no visible chip.
  const daysFromYesterday = differenceInDays(selectedDate, yesterday);
  const startDate =
    daysFromYesterday >= 8 || daysFromYesterday < 0
      ? addDays(selectedDate, -4)
      : yesterday;

  const dates = Array.from({ length: 8 }, (_, i) => addDays(startDate, i));

  const getDateLabel = (date: Date) => {
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tmrw";
    return format(date, "EEE");
  };

  // Warm the day before it's tapped. On touch, `touchstart` fires well before
  // the click, so the fetch is usually already in flight by the time it lands.
  const handlePrefetch = (date: Date) => {
    prefetchEvents(format(date, "yyyy-MM-dd"));
  };

  return (
    <div className="flex gap-1 justify-between px-2">
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
