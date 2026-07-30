import { useEffect, useState } from "react";
import { addDays, format, subDays } from "date-fns";
import { BottomNav } from "@/components/BottomNav";
import { CalendarPopover } from "@/components/CalendarPopover";
import { DatePicker } from "@/components/DatePicker";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { EventCard } from "@/components/EventCard";
import { EventDetailsSheet } from "@/components/EventDetailsSheet";
import { EventSkeleton } from "@/components/EventSkeleton";
import { Header } from "@/components/Header";
import { SplashScreen } from "@/components/SplashScreen";
import { useTheme } from "@/context/ThemeContext";
import { useEvents } from "@/hooks/useEvents";
import { useSwipe } from "@/hooks/useSwipe";
import { cn } from "@/lib/utils";
import type { Event } from "@/types/event";

export default function HomePage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const { navStyle, layoutDensity } = useTheme();
  const dateString = format(selectedDate, "yyyy-MM-dd");
  const { data, isLoading, isFetching, error, refetch } = useEvents(dateString);

  // Re-keying the list on date change restarts the stagger animation, so a new
  // day animates in rather than swapping silently.
  const listKey = dateString;

  useEffect(() => {
    if (!isLoading && data) {
      const timer = setTimeout(() => setShowSplash(false), 500);
      return () => clearTimeout(timer);
    }
    // Never strand the user behind the splash if the first fetch fails.
    if (error) setShowSplash(false);
    return undefined;
  }, [isLoading, data, error]);

  const swipe = useSwipe({
    onSwipeLeft: () => setSelectedDate((d) => addDays(d, 1)),
    onSwipeRight: () => setSelectedDate((d) => subDays(d, 1)),
  });

  const handleEventSelect = (event: Event) => {
    setSelectedEvent(event);
    setSheetOpen(true);
  };

  const spacingClass = cn(
    layoutDensity === "tight" && "space-y-1",
    layoutDensity === "default" && "space-y-2",
    layoutDensity === "airy" && "space-y-3",
  );

  const padX = cn(
    layoutDensity === "tight" && "px-2",
    layoutDensity === "default" && "px-3",
    layoutDensity === "airy" && "px-4",
  );

  const mainPadding = cn(
    layoutDensity === "tight" && "px-2 pb-4",
    layoutDensity === "default" && "px-3 pb-6",
    layoutDensity === "airy" && "px-4 pb-8",
  );

  const hasEvents = Boolean(data?.events?.length);
  const isEmpty = Boolean(data && data.events.length === 0);

  return (
    <>
      <SplashScreen isVisible={showSplash} />

      <div
        className={cn(
          "min-h-screen bg-background",
          navStyle === "tabs" && "has-bottom-nav",
          navStyle === "minimal" && "swipe-active",
        )}
        {...swipe}
      >
        <Header selectedDate={selectedDate} onDateChange={setSelectedDate} />

        {navStyle !== "minimal" && (
          <div className="py-2 border-b border-border/50">
            <DatePicker selectedDate={selectedDate} onDateChange={setSelectedDate} />
          </div>
        )}

        <div className={cn("py-2 flex items-center justify-between gap-2", padX)}>
          <p className="text-xs text-muted-foreground">
            {hasEvents
              ? `${data!.count} event${data!.count !== 1 ? "s" : ""} · ${format(selectedDate, "EEE, MMM d")}`
              : format(selectedDate, "EEE, MMM d")}
          </p>
          {/* Minimal mode hides the strip, so the swipe hint has to live here. */}
          {navStyle === "minimal" && (
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              Swipe to change day
            </span>
          )}
        </div>

        <main className={mainPadding}>
          <div
            className={cn(
              "transition-opacity duration-150",
              isFetching && !isLoading ? "opacity-60" : "opacity-100",
            )}
          >
            {error ? (
              <ErrorState
                onRetry={() => void refetch()}
                detail={error.message}
                retrying={isFetching}
              />
            ) : isEmpty ? (
              <EmptyState />
            ) : hasEvents ? (
              <div key={listKey} className={cn(spacingClass, "stagger-animation")}>
                {data!.events.map((event) => (
                  <EventCard key={event.id} event={event} onSelect={handleEventSelect} />
                ))}
              </div>
            ) : (
              <div className={cn(spacingClass, "stagger-animation")}>
                {Array.from({ length: 6 }, (_, i) => (
                  <EventSkeleton key={i} />
                ))}
              </div>
            )}
          </div>
        </main>

        <EventDetailsSheet
          event={selectedEvent}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
        />

        {navStyle === "tabs" && (
          <>
            <BottomNav onCalendarClick={() => setCalendarOpen((v) => !v)} />
            {calendarOpen && (
              <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50">
                <CalendarPopover
                  selectedDate={selectedDate}
                  onDateChange={(date) => {
                    setSelectedDate(date);
                    setCalendarOpen(false);
                  }}
                  align="center"
                />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
