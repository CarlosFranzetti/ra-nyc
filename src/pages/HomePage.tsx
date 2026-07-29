import { useState } from "react";
import DateSelector from "@/components/DateSelector";
import EventCard from "@/components/EventCard";
import { useRAEvents } from "@/hooks/useRAEvents";
import { cn } from "@/lib/utils";

export default function HomePage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const {
    data: events,
    isLoading,
    isPlaceholderData,
    error,
    refetch,
    isFetching,
  } = useRAEvents(selectedDate);

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
      <header className="px-3 pt-4 pb-1">
        <h1 className="text-lg font-bold text-foreground">RA NYC Events</h1>
      </header>

      <DateSelector selectedDate={selectedDate} onSelect={setSelectedDate} />

      <main
        className={cn(
          "px-3 pb-8 space-y-3 transition-opacity duration-150",
          // Showing the previous day dimmed reads as "loading" without the
          // jarring blank-then-spinner cycle.
          isPlaceholderData && "opacity-50",
        )}
      >
        {isLoading && (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-muted-foreground border-t-foreground rounded-full animate-spin" />
          </div>
        )}
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
              className="text-xs font-medium bg-secondary text-foreground border border-border px-3 py-1.5 rounded-md hover:bg-accent disabled:opacity-50 transition-colors"
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
          <EventCard key={event.id} event={event} />
        ))}
      </main>
    </div>
  );
}
