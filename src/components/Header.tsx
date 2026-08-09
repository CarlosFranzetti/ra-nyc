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
        {/* A logo, not a heading — so it is deliberately outside every
            preference axis. It used to inherit the `type-*` class from <html>,
            which meant the app's own name was rendered in whichever typeface
            you last picked and the one fixed point on the screen moved with the
            settings. `.logo` pins the family, the weight and the colour in
            plain CSS (see index.css), and the colour is a literal near-white
            rather than --foreground, which is tinted per theme.

            The mark echoes the home-screen icon exactly: RA in a filled block,
            same typeface, same weight. */}
        <h1 className="logo flex items-center gap-2">
          <span className="logo-mark">RA</span>
          <span className="logo-word">NYC Events</span>
        </h1>
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
