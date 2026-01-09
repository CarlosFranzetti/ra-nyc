import { format, addDays, isSameDay, isToday, isTomorrow } from "date-fns";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useEffect } from "react";

interface DatePickerProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

export function DatePicker({ selectedDate, onDateChange }: DatePickerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = new Date();
  
  // Generate 14 days starting from today
  const dates = Array.from({ length: 14 }, (_, i) => addDays(today, i));

  const getDateLabel = (date: Date) => {
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    return format(date, "EEE");
  };

  // Scroll to selected date on mount
  useEffect(() => {
    const selectedIndex = dates.findIndex(d => isSameDay(d, selectedDate));
    if (scrollRef.current && selectedIndex > 0) {
      const itemWidth = 64; // Approximate width of each date item
      scrollRef.current.scrollLeft = selectedIndex * itemWidth - 32;
    }
  }, []);

  return (
    <div className="relative">
      <div 
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide px-4"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {dates.map((date) => {
          const isSelected = isSameDay(date, selectedDate);
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          
          return (
            <button
              key={date.toISOString()}
              onClick={() => onDateChange(date)}
              className={cn(
                "flex flex-col items-center min-w-[56px] py-2 px-3 rounded-lg transition-smooth",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : "bg-card hover:bg-accent",
                isWeekend && !isSelected && "text-muted-foreground"
              )}
            >
              <span className="text-xs font-medium uppercase tracking-wide">
                {getDateLabel(date)}
              </span>
              <span className={cn(
                "text-lg font-semibold mt-0.5",
                isSelected ? "text-primary-foreground" : "text-foreground"
              )}>
                {format(date, "d")}
              </span>
              <span className="text-[10px] uppercase tracking-wider opacity-60">
                {format(date, "MMM")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
