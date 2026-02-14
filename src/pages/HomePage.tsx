import { useState } from "react";
import DateSelector from "@/components/DateSelector";
import EventCard from "@/components/EventCard";
import { useRAEvents } from "@/hooks/useRAEvents";

export default function HomePage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const { data: events, isLoading, error } = useRAEvents(selectedDate);

  return (
    <div className="min-h-screen max-w-md mx-auto">
      <header className="px-3 pt-4 pb-1">
        <h1 className="text-lg font-bold text-foreground">RA NYC Events</h1>
      </header>

      <DateSelector selectedDate={selectedDate} onSelect={setSelectedDate} />

      <main className="px-3 pb-8 space-y-3">
        {isLoading && (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-muted-foreground border-t-foreground rounded-full animate-spin" />
          </div>
        )}
        {error && (
          <p className="text-center text-sm text-muted-foreground py-8">
            Failed to load events. Try again later.
          </p>
        )}
        {events?.length === 0 && !isLoading && (
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
