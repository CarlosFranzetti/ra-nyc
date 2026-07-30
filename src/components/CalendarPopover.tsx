import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker } from "react-day-picker";
import { CalendarDays } from "lucide-react";

interface CalendarPopoverProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  align?: "center" | "end";
}

/**
 * Jump to any date, beyond the eight days the strip shows.
 *
 * Styled through `classNames` against the theme tokens rather than
 * react-day-picker's stylesheet, so it recolours with the rest of the app.
 */
export function CalendarPopover({
  selectedDate,
  onDateChange,
  align = "end",
}: CalendarPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          aria-label="Pick a date"
          className="p-2 rounded-md text-muted-foreground hover:text-foreground active:text-foreground active:scale-95 transition-all"
        >
          <CalendarDays className="w-5 h-5" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={8}
          className="z-50 rounded-lg border border-border bg-popover p-3 shadow-xl"
        >
          <DayPicker
            mode="single"
            selected={selectedDate}
            defaultMonth={selectedDate}
            onSelect={(date) => {
              if (date) {
                onDateChange(date);
                setOpen(false);
              }
            }}
            classNames={{
              months: "text-popover-foreground",
              month_caption: "flex justify-center py-1 text-sm font-semibold",
              nav: "flex items-center justify-between absolute inset-x-1 top-1",
              button_previous:
                "p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent",
              button_next:
                "p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent",
              month_grid: "w-full border-collapse mt-1",
              weekdays: "flex",
              weekday:
                "w-8 text-[10px] font-medium uppercase text-muted-foreground",
              week: "flex w-full mt-0.5",
              day: "w-8 h-8 text-center text-xs",
              day_button:
                "w-8 h-8 rounded-md hover:bg-accent active:bg-accent transition-colors",
              selected:
                "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:font-semibold",
              today: "[&>button]:text-primary [&>button]:font-semibold",
              outside: "opacity-30",
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
