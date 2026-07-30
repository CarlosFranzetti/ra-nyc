import { CalendarDays, Music } from "lucide-react";

interface BottomNavProps {
  onCalendarClick: () => void;
}

/**
 * Bottom bar for the "tabs" navigation style.
 *
 * The original also had a Favorites tab. It's omitted here rather than shipped
 * as a dead button — favourites need somewhere to persist, which is the first
 * thing that would genuinely require a database (see DATABASE.md).
 */
export function BottomNav({ onCalendarClick }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-t border-border/50 pb-safe">
      <div className="flex items-center justify-around py-2">
        <button className="flex flex-col items-center gap-0.5 px-6 py-2 text-foreground">
          <Music className="w-5 h-5" />
          <span className="text-[10px] font-medium">Events</span>
        </button>
        <button
          onClick={onCalendarClick}
          className="flex flex-col items-center gap-0.5 px-6 py-2 text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
        >
          <CalendarDays className="w-5 h-5" />
          <span className="text-[10px] font-medium">Calendar</span>
        </button>
      </div>
    </nav>
  );
}
