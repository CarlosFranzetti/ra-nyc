import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CloudOff } from "lucide-react";
import { DatePicker } from "@/components/DatePicker";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { EventCard } from "@/components/EventCard";
import { ArtistSheet } from "@/components/ArtistSheet";
import { EventDetailsSheet } from "@/components/EventDetailsSheet";
import { EventSkeleton } from "@/components/EventSkeleton";
import { FilterChips } from "@/components/FilterChips";
import { Header } from "@/components/Header";
import { PlayerBar } from "@/components/PlayerBar";
import { SearchSheet } from "@/components/SearchSheet";
import { VenueSheet } from "@/components/VenueSheet";
import { SplashScreen } from "@/components/SplashScreen";
import { useTheme } from "@/context/ThemeContext";
import { useEvents } from "@/hooks/useEvents";
import { applyFilters, filterCounts, type FilterKey } from "@/lib/filters";
import { currentNight } from "@/lib/night";
import { cn } from "@/lib/utils";
import type { Artist, Event } from "@/types/event";

export default function HomePage() {
  // The night the app opened on, which before 3:30am is yesterday's date — see
  // `lib/night.ts`. Passed as an initialiser rather than a call so it is
  // evaluated once, on mount, and not on every render.
  const [selectedDate, setSelectedDate] = useState(currentNight);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const [artistOpen, setArtistOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState<string | null>(null);
  const [venueOpen, setVenueOpen] = useState(false);
  const [filters, setFilters] = useState<FilterKey[]>([]);

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

  const allEvents = useMemo(() => data?.events ?? [], [data?.events]);
  const visibleEvents = useMemo(
    () => applyFilters(allEvents, filters),
    [allEvents, filters],
  );
  const counts = useMemo(
    () => filterCounts(allEvents, filters),
    [allEvents, filters],
  );

  const toggleFilter = useCallback((key: FilterKey) => {
    setFilters((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  }, []);

  const hasEvents = allEvents.length > 0;
  const isEmpty = Boolean(data && allEvents.length === 0);
  // A filtered-to-nothing night is not an empty night, and saying "no events"
  // there would be a lie the user can't undo without guessing why.
  const filteredOut = hasEvents && visibleEvents.length === 0;

  return (
    <>
      <SplashScreen isVisible={showSplash} />

      {/* pb-[var(--player-h)]: the transport is fixed, so without this the last
          card sits underneath it. The variable is 0px when nothing is playing. */}
      {/* No swipe-to-change-day. It competed with scrolling the listings and
          with dragging the date rail, and losing a day under your thumb
          mid-scroll is a worse failure than an extra tap. The rail is the way
          to move between days now, and it is draggable. */}
      <div className="min-h-screen bg-background pb-[var(--player-h)]">
        <Header
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          onSearchClick={() => setSearchOpen(true)}
        />

        {/* The caption and the rail are one block, not two.
            They used to be separate sections, each with its own border and its
            own vertical padding, which spent about twenty pixels drawing a line
            between two halves of a single statement: which day you are looking
            at, and which days there are. A caption belongs to the thing it
            captions. One border now, at the bottom of both. */}
        <div className="border-b border-border/50 pb-1.5 pt-1.5">
          <p className="shell flex items-center justify-center gap-2.5 pb-1 text-xs">
            {/* The date leads, because it is what you are looking at; the count
                answers a question you only ask once you know the night. A rule
                between them rather than a middot — two facts, not a phrase. */}
            <span className="font-semibold text-foreground">
              {format(selectedDate, "EEE, MMM d")}
            </span>
            {hasEvents && (
              <>
                <span aria-hidden className="h-3 w-px bg-border" />
                <span className="text-muted-foreground">
                  {visibleEvents.length} event{visibleEvents.length !== 1 ? "s" : ""}
                </span>
              </>
            )}
          </p>

          <div className="shell">
            <DatePicker selectedDate={selectedDate} onDateChange={setSelectedDate} />
          </div>
        </div>

        {(hasEvents || data?.stale) && (
          <div className={cn("shell flex items-center justify-between gap-2 py-1.5", padX)}>
            {hasEvents ? (
              <FilterChips active={filters} counts={counts} onToggle={toggleFilter} />
            ) : (
              <span />
            )}

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
        )}

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
            ) : filteredOut ? (
              <div className="py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  Nothing tonight matches those filters.
                </p>
                <button
                  type="button"
                  onClick={() => setFilters([])}
                  className="mt-2 text-xs text-primary underline underline-offset-4"
                >
                  Clear filters
                </button>
              </div>
            ) : hasEvents ? (
              <div key={listKey} className={cn(listClass, "stagger-animation")}>
                {visibleEvents.map((event) => (
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
          // Taken from the event rather than threaded through onSelectVenue:
          // this sheet is only ever opened from the venue line of the event
          // that is already selected, so the two cannot disagree. Null for
          // anything that came from the saved index, which has no venue ids.
          venueId={selectedEvent?.venue.id ?? null}
          ticketsUrl={selectedEvent?.url ?? null}
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
