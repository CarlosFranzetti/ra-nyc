import { lazy, Suspense } from "react";
import { CalendarDays, Search } from "lucide-react";

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
  onSearchClick: () => void;
}

export function Header({ selectedDate, onDateChange, onSearchClick }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border/50 pt-safe">
      <div className="shell px-4 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">RA NYC Events</h1>
        <div className="flex items-center gap-1">
          {/* Left of the calendar. A button rather than an inline field: at this
              width a real input would crowd out the title, and the search needs
              a full sheet to show results in anyway. */}
          <button
            onClick={onSearchClick}
            aria-label="Search events"
            className="p-2 rounded-md text-muted-foreground hover:text-foreground active:text-foreground active:scale-95 transition-all"
          >
            <Search className="w-5 h-5" />
          </button>
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
