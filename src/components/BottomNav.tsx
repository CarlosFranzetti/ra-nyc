import { CalendarDays, Music, Heart } from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomNavProps {
  onCalendarClick: () => void;
}

export function BottomNav({ onCalendarClick }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-t border-border/50">
      <div className="flex items-center justify-around py-2">
        <button className="flex flex-col items-center gap-0.5 px-6 py-2 text-foreground">
          <Music className="w-5 h-5" />
          <span className="text-[10px] font-medium">Events</span>
        </button>
        <button 
          onClick={onCalendarClick}
          className="flex flex-col items-center gap-0.5 px-6 py-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <CalendarDays className="w-5 h-5" />
          <span className="text-[10px] font-medium">Calendar</span>
        </button>
        <button className="flex flex-col items-center gap-0.5 px-6 py-2 text-muted-foreground hover:text-foreground transition-colors">
          <Heart className="w-5 h-5" />
          <span className="text-[10px] font-medium">Favorites</span>
        </button>
      </div>
    </nav>
  );
}
