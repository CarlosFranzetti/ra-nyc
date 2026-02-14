import { format, addDays, subDays, isToday, isWeekend } from "date-fns";
import { cn } from "@/lib/utils";

interface DateSelectorProps {
  selectedDate: Date;
  onSelect: (date: Date) => void;
}

export default function DateSelector({ selectedDate, onSelect }: DateSelectorProps) {
  const yesterday = subDays(new Date(), 1);
  const dates = Array.from({ length: 8 }, (_, i) => addDays(yesterday, i));

  return (
    <div className="flex gap-1.5 px-3 py-3 overflow-hidden">
      {dates.map((date) => {
        const isSelected = format(date, "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd");
        return (
          <button
            key={date.toISOString()}
            onClick={() => onSelect(date)}
            className={cn(
              "flex flex-col items-center px-2.5 py-1.5 rounded-md text-xs transition-all duration-150 border min-w-[42px]",
              isSelected
                ? "bg-primary text-primary-foreground border-primary"
                : isWeekend(date)
                  ? "bg-accent/50 text-foreground border-border hover:bg-accent"
                  : "bg-secondary text-foreground border-border hover:bg-accent"
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
