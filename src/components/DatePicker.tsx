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
  
  // Calculate the start date based on selected date
  const daysFromYesterday = differenceInDays(selectedDate, yesterday);
  
  // Always show 8 dates, centered around today when possible
  let startDate = yesterday;
  if (daysFromYesterday >= 8) {
    // Selected date is beyond default range, shift window
    startDate = addDays(selectedDate, -4);
  }
  
  const dates = Array.from({ length: 8 }, (_, i) => addDays(startDate, i));

  const getDateLabel = (date: Date) => {
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tmrw";
    return format(date, "EEE");
  };

  const handlePrefetch = (date: Date) => {
    prefetchEvents(format(date, "yyyy-MM-dd"));
  };

  return (
    <div className="flex gap-1 justify-between">
      {dates.map((date) => {
        const isSelected = isSameDay(date, selectedDate);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        
        return (
          <button
            key={date.toISOString()}
            onClick={() => onDateChange(date)}
            onTouchStart={() => handlePrefetch(date)}
            onMouseEnter={() => handlePrefetch(date)}
            className={cn(
              "flex flex-col items-center flex-1 py-1 rounded-md transition-all duration-200 border border-border/30",
              isSelected
                ? "bg-primary text-primary-foreground border-primary glow-primary-sm"
                : isWeekend
                  ? "bg-accent/50 hover:bg-accent"
                  : "bg-card hover:bg-accent",
              isWeekend && !isSelected && "text-muted-foreground"
            )}
          >
            <span className="text-[8px] font-medium uppercase tracking-wide">
              {getDateLabel(date)}
            </span>
            <span className={cn(
              "text-xs font-semibold",
              isSelected ? "text-primary-foreground" : "text-foreground"
            )}>
              {format(date, "d")}
            </span>
            <span className="text-[7px] uppercase tracking-wider opacity-60">
              {format(date, "MMM")}
            </span>
          </button>
        );
      })}
    </div>
  );
}
