import { format, addDays, isSameDay, isToday, isTomorrow, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import { usePrefetchEvents } from "@/hooks/useEvents";

interface DatePickerProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

export function DatePicker({ selectedDate, onDateChange }: DatePickerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prefetchEvents = usePrefetchEvents();
  const today = new Date();
  
  // Calculate days from today to selected date
  const daysToSelected = differenceInDays(selectedDate, today);
  
  // Generate dates: always include today through at least 14 days, 
  // but extend if selected date is further out
  const daysToShow = Math.max(14, daysToSelected + 1);
  const dates = Array.from({ length: daysToShow }, (_, i) => addDays(today, i));

  const getDateLabel = (date: Date) => {
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tmrw";
    return format(date, "EEE");
  };

  // Scroll to selected date on mount
  useEffect(() => {
    const selectedIndex = dates.findIndex(d => isSameDay(d, selectedDate));
    if (scrollRef.current && selectedIndex > 0) {
      const itemWidth = 44;
      scrollRef.current.scrollLeft = selectedIndex * itemWidth - 20;
    }
  }, []);
  const handlePrefetch = (date: Date) => {
    prefetchEvents(format(date, "yyyy-MM-dd"));
  };

  return (
    <div className="relative">
      <div 
        ref={scrollRef}
        className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide px-3"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
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
                "flex flex-col items-center min-w-[40px] py-1.5 px-2 rounded-md transition-smooth",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : "bg-card hover:bg-accent",
                isWeekend && !isSelected && "text-muted-foreground"
              )}
            >
              <span className="text-[9px] font-medium uppercase tracking-wide">
                {getDateLabel(date)}
              </span>
              <span className={cn(
                "text-sm font-semibold",
                isSelected ? "text-primary-foreground" : "text-foreground"
              )}>
                {format(date, "d")}
              </span>
              <span className="text-[8px] uppercase tracking-wider opacity-60">
                {format(date, "MMM")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
