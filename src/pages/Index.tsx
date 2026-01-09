import { useState } from "react";
import { format } from "date-fns";
import { Header } from "@/components/Header";
import { DatePicker } from "@/components/DatePicker";
import { EventCard } from "@/components/EventCard";
import { EventSkeleton } from "@/components/EventSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { useEvents } from "@/hooks/useEvents";

const Index = () => {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const dateString = format(selectedDate, "yyyy-MM-dd");
  
  const { data, isLoading, isError, refetch } = useEvents(dateString);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      {/* Date Picker */}
      <div className="py-4 border-b border-border/50">
        <DatePicker 
          selectedDate={selectedDate} 
          onDateChange={setSelectedDate} 
        />
      </div>

      {/* Event Count */}
      {data && data.count > 0 && (
        <div className="px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {data.count} event{data.count !== 1 ? 's' : ''} on {format(selectedDate, "EEEE, MMMM d")}
          </p>
        </div>
      )}

      {/* Events List */}
      <main className="px-4 pb-8">
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <EventSkeleton key={i} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data?.events.length === 0 ? (
          <EmptyState date={dateString} />
        ) : (
          <div className="space-y-4">
            {data?.events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;
