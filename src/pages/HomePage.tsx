import { useState } from "react";
import { addDays, format, isToday, subDays } from "date-fns";
import DateSelector from "@/components/DateSelector";
import EventCard from "@/components/EventCard";
import EventCardSkeleton from "@/components/EventCardSkeleton";
import EventDetailsSheet from "@/components/EventDetailsSheet";
import SettingsSheet from "@/components/SettingsSheet";
import { usePreferences } from "@/context/PreferencesContext";
import { useRAEvents } from "@/hooks/useRAEvents";
import { useSwipe } from "@/hooks/useSwipe";
import { cn } from "@/lib/utils";
import type { RAEvent } from "@/types/event";

export default function HomePage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeEvent, setActiveEvent] = useState<RAEvent | null>(null);

  const { preferences } = usePreferences();
  const {
    data: events,
    isLoading,
    isPlaceholderData,
    error,
    refetch,
    isFetching,
  } = useRAEvents(selectedDate);

  // Swipe works in every navigation mode; in Minimal it's the only way to move.
  const swipe = useSwipe({
    onSwipeLeft: () => setSelectedDate((date) => addDays(date, 1)),
    onSwipeRight: () => setSelectedDate((date) => subDays(date, 1)),
  });

  const dateLabel = isToday(selectedDate)
    ? "Today"
    : format(selectedDate, "EEEE d MMM");

  return (
    <div
      className="min-h-screen max-w-md mx-auto"
      // Respect the notch and home indicator now that the viewport paints
      // edge to edge.
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <header className="flex items-baseline justify-between gap-3 px-3 pt-4 pb-1">
        <div>
          <h1 className="text-lg font-bold text-foreground">RA NYC Events</h1>
          {/* Minimal mode drops the date picker, so the header has to say which
              day you're looking at. */}
          {preferences.navMode === "minimal" && (
            <p className="text-xs text-muted-foreground">{dateLabel}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Preferences"
          className="text-xs text-muted-foreground hover:text-foreground active:text-foreground border border-border rounded-md px-2 py-1 active:scale-95 transition-all"
        >
          Settings
        </button>
      </header>

      <DateSelector
        selectedDate={selectedDate}
        onSelect={setSelectedDate}
        navMode={preferences.navMode}
      />

      <main
        {...swipe}
        className={cn(
          "px-3 pb-8 transition-opacity duration-150",
          // Showing the previous day dimmed reads as "loading" without the
          // jarring blank-then-spinner cycle.
          isPlaceholderData && "opacity-50",
        )}
        style={{ display: "grid", gap: "var(--card-gap)" }}
      >
        {isLoading &&
          Array.from({ length: 4 }, (_, i) => <EventCardSkeleton key={i} />)}

        {error && (
          <div className="text-center py-8 space-y-3">
            <p className="text-sm text-foreground">Couldn&apos;t load events.</p>
            {/* Surface the real reason — the API returns a useful message
                (e.g. "Resident Advisor responded with 403") and hiding it
                behind "try again later" makes failures undiagnosable. */}
            <p className="text-xs text-muted-foreground px-6">{error.message}</p>
            <button
              onClick={() => void refetch()}
              disabled={isFetching}
              className="text-xs font-medium bg-secondary text-foreground border border-border px-3 py-1.5 rounded-md hover:bg-accent active:bg-accent disabled:opacity-50 transition-colors"
            >
              {isFetching ? "Retrying…" : "Try again"}
            </button>
          </div>
        )}

        {events?.length === 0 && !isLoading && !error && (
          <p className="text-center text-sm text-muted-foreground py-8">
            No events found for this date.
          </p>
        )}

        {events?.map((event) => (
          <EventCard key={event.id} event={event} onOpen={setActiveEvent} />
        ))}
      </main>

      <EventDetailsSheet event={activeEvent} onClose={() => setActiveEvent(null)} />
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
