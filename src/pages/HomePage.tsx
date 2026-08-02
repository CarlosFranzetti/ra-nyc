import { useCallback, useEffect, useState } from "react";
import { addDays, format, subDays } from "date-fns";
import { DatePicker } from "@/components/DatePicker";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { EventCard } from "@/components/EventCard";
import { ArtistSheet } from "@/components/ArtistSheet";
import { EventDetailsSheet } from "@/components/EventDetailsSheet";
import { EventSkeleton } from "@/components/EventSkeleton";
import { Header } from "@/components/Header";
import { PlayerBar } from "@/components/PlayerBar";
import { SplashScreen } from "@/components/SplashScreen";
import { useTheme } from "@/context/ThemeContext";
import { useEvents } from "@/hooks/useEvents";
import { useSwipe } from "@/hooks/useSwipe";
import { cn } from "@/lib/utils";
import type { Artist, Event } from "@/types/event";

export default function HomePage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const [artistOpen, setArtistOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  const { layoutDensity } = useTheme();
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

  // Stable, or memoising EventCard achieves nothing — a fresh function
  // reference each render invalidates every card.
  const handleEventSelect = useCallback((event: Event) => {
    setSelectedEvent(event);
    setSheetOpen(true);
  }, []);

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

      {/* pb-[var(--player-h)]: the transport is fixed, so without this the last
          card sits underneath it. The variable is 0px when nothing is playing. */}
      <div
        className="min-h-screen bg-background pb-[var(--player-h)]"
        {...swipe}
      >
        <Header selectedDate={selectedDate} onDateChange={setSelectedDate} />

        <div className="py-2 border-b border-border/50">
          <DatePicker selectedDate={selectedDate} onDateChange={setSelectedDate} />
        </div>

        <div className={cn("py-2 flex items-center justify-between gap-2", padX)}>
          <p className="text-xs text-muted-foreground">
            {hasEvents
              ? `${data!.count} event${data!.count !== 1 ? "s" : ""} · ${format(selectedDate, "EEE, MMM d")}`
              : format(selectedDate, "EEE, MMM d")}
          </p>
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
          onSelectArtist={(artist) => {
            setSelectedArtist(artist);
            setArtistOpen(true);
          }}
        />

        {/* Stacked above the event sheet, which stays open underneath so
            dismissing returns to it with its scroll position intact. */}
        <ArtistSheet
          artist={selectedArtist}
          open={artistOpen}
          onOpenChange={setArtistOpen}
        />

        {/* Docked to the bottom, over everything. Renders nothing until
            something is playing. */}
        <PlayerBar />
      </div>
    </>
  );
}
