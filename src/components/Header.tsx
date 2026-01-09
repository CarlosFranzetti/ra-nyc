import { CalendarDays } from "lucide-react";

export function Header() {
  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border/50">
      <div className="px-4 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">NYC Events</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Powered by Resident Advisor
          </p>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <CalendarDays className="w-5 h-5" />
        </div>
      </div>
    </header>
  );
}
