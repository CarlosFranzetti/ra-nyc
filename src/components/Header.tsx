import { CalendarPopover } from "@/components/CalendarPopover";
import { SettingsSheet } from "@/components/SettingsSheet";
import { useTheme } from "@/context/ThemeContext";

interface HeaderProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

export function Header({ selectedDate, onDateChange }: HeaderProps) {
  const { navStyle } = useTheme();
  // In tabs mode the calendar lives in the bottom bar instead, so showing it
  // here too would be two ways to do the same thing.
  const showCalendar = navStyle !== "tabs";

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border/50 pt-safe">
      <div className="px-4 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">RA NYC Events</h1>
        <div className="flex items-center gap-1">
          {showCalendar && (
            <CalendarPopover
              selectedDate={selectedDate}
              onDateChange={onDateChange}
            />
          )}
          <SettingsSheet />
        </div>
      </div>
    </header>
  );
}
