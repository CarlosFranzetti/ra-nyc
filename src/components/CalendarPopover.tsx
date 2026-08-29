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
 *
 * ## Why every size in here is a literal px
 *
 * The calendar holds still at one size whatever the Text size preference is
 * set to, and that is deliberate rather than an oversight.
 *
 * Everything else in the app is sized in rem, so it grows with the root font
 * size and the whole layout scales together. A month grid cannot: it is seven
 * columns by six rows of two-digit numbers in a popover anchored to an icon at
 * the top of the screen. At the top of the ladder the rem version was ~34%
 * wider than the phone it was on and the last column left the screen; at the
 * bottom the hit targets fell under 30px.
 *
 * The sizes below are the middle of the ladder — the base values times ~1.157,
 * which is between steps 2 and 3 of six — so this is the size the calendar has
 * at a middling preference, and it is the size it has at every preference. It
 * is a control, not text you read, and 32px is a thumb whatever type size you
 * prefer to read listings at.
 */

/**
 * Middle of the six-step text ladder (1 → 1.338), applied once here.
 *
 * Named rather than inlined into nine numbers, so that if the ladder changes
 * shape the one thing to reconcile is this constant and the comment above it.
 */
const FIXED_SCALE = 1.157;
const px = (base: number) => `${Math.round(base * FIXED_SCALE)}px`;
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
          className="p-[5px] rounded-md text-muted-foreground hover:text-foreground active:text-foreground active:scale-95 transition-all"
        >
          <CalendarDays className="h-[20px] w-[20px]" />
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
            // Sizes in `style` rather than in Tailwind classes: `w-8` is
            // `2rem`, and rem is exactly what this component is opting out of.
            styles={{
              month_caption: { fontSize: px(14) },
              weekday: { width: px(32), fontSize: px(10) },
              day: { width: px(32), height: px(32), fontSize: px(12) },
              day_button: { width: px(32), height: px(32) },
            }}
            classNames={{
              months: "text-popover-foreground",
              month_caption: "flex justify-center py-1 font-semibold",
              nav: "flex items-center justify-between absolute inset-x-1 top-1",
              button_previous:
                "p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent",
              button_next:
                "p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent",
              month_grid: "w-full border-collapse mt-1",
              weekdays: "flex",
              weekday: "font-medium uppercase text-muted-foreground",
              week: "flex w-full mt-0.5",
              day: "text-center",
              day_button:
                "rounded-md hover:bg-accent active:bg-accent transition-colors",
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
