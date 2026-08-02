import { lazy, Suspense } from "react";
import { CalendarDays } from "lucide-react";

// react-day-picker is the heaviest dependency in the app and the calendar is
// opened rarely, so it loads on demand.
const CalendarPopover = lazy(() =>
  import("@/components/CalendarPopover").then((m) => ({
    default: m.CalendarPopover,
  })),
);
import { SettingsSheet } from "@/components/SettingsSheet";

interface HeaderProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

export function Header({ selectedDate, onDateChange }: HeaderProps) {
  return (
    /* Sticks below the transport bar rather than at the viewport top, and hands
       the safe-area inset over to it while it's there — --player-h is 0px
       whenever nothing is playing, so both are flush by default. */
    <header className="sticky top-[var(--player-h)] z-40 bg-background/80 backdrop-blur-lg border-b border-border/50 pt-header-safe">
      <div className="px-4 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">RA NYC Events</h1>
        <div className="flex items-center gap-1">
          <Suspense
            fallback={
              <span className="p-2 text-muted-foreground">
                <CalendarDays className="h-5 w-5" />
              </span>
            }
          >
            <CalendarPopover
              selectedDate={selectedDate}
              onDateChange={onDateChange}
            />
          </Suspense>
          <SettingsSheet />
        </div>
      </div>
    </header>
  );
}
