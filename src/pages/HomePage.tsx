import { useCallback, useEffect, useState } from "react";
import { addDays, format, subDays } from "date-fns";
import { CloudOff } from "lucide-react";
import { DatePicker } from "@/components/DatePicker";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { EventCard } from "@/components/EventCard";
import { ArtistSheet } from "@/components/ArtistSheet";
import { EventDetailsSheet } from "@/components/EventDetailsSheet";
import { EventSkeleton } from "@/components/EventSkeleton";
import { Header } from "@/components/Header";
import { PlayerBar } from "@/components/PlayerBar";
import { SearchSheet } from "@/components/SearchSheet";
import { VenueSheet } from "@/components/VenueSheet";
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState<string | null>(null);
  const [venueOpen, setVenueOpen] = useState(false);

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

  // A grid rather than `space-y`, because on a wide screen the same list has to
  // become two and then three columns — and `space-y` only knows about the
  // vertical gaps between siblings in one flow.
  const listClass = cn(
    "grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3",
    layoutDensity === "tight" && "gap-1",
    layoutDensity === "default" && "gap-2",
    layoutDensity === "airy" && "gap-3",
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
        <Header
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          onSearchClick={() => setSearchOpen(true)}
        />

        <div className="py-2 border-b border-border/50">
          <div className="shell">
            <DatePicker selectedDate={selectedDate} onDateChange={setSelectedDate} />
          </div>
        </div>

        <div className={cn("shell py-2 flex items-center justify-between gap-2", padX)}>
          <p className="text-xs text-muted-foreground">
            {hasEvents
              ? `${data!.count} event${data!.count !== 1 ? "s" : ""} · ${format(selectedDate, "EEE, MMM d")}`
              : format(selectedDate, "EEE, MMM d")}
          </p>

          {/* Saying so matters more than it looks: without it, listings that
              are hours old are indistinguishable from listings that are
              current, and the app would be confidently wrong about tonight. */}
          {data?.stale && (
            <span className="flex flex-shrink-0 items-center gap-1 text-[0.6875rem] text-muted-foreground/70">
              <CloudOff className="h-3 w-3" />
              Saved listings
            </span>
          )}
        </div>

        <main className={cn("shell", mainPadding)}>
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
              <div key={listKey} className={cn(listClass, "stagger-animation")}>
                {data!.events.map((event) => (
                  <EventCard key={event.id} event={event} onSelect={handleEventSelect} />
                ))}
              </div>
            ) : (
              <div className={cn(listClass, "stagger-animation")}>
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
          onSelectVenue={(venue) => {
            setSelectedVenue(venue);
            setVenueOpen(true);
          }}
        />

        {/* Stacked over the event, like the artist sheet — dismissing returns
            to the event rather than to the listings. */}
        <VenueSheet
          venue={selectedVenue}
          open={venueOpen}
          onOpenChange={setVenueOpen}
        />

        {/* Stacked above the event sheet, which stays open underneath so
            dismissing returns to it with its scroll position intact. */}
        <ArtistSheet
          artist={selectedArtist}
          open={artistOpen}
          onOpenChange={setArtistOpen}
        />

        {/* Picking a result jumps the listings to that night and opens it,
            rather than opening a third stacked sheet — so you land back in the
            normal flow with the day around it for context. */}
        <SearchSheet
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onSelect={(event) => {
            setSearchOpen(false);
            const day = event.date.slice(0, 10);
            if (day) setSelectedDate(new Date(`${day}T12:00:00`));
            setSelectedEvent(event);
            setSheetOpen(true);
          }}
        />

        {/* Docked to the bottom, over everything. Renders nothing until
            something is playing. */}
        <PlayerBar />
      </div>
    </>
  );
}
