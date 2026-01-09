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
  
  const { data, isError, refetch, isFetching } = useEvents(dateString);

  const hasEvents = data?.events && data.events.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <Header selectedDate={selectedDate} onDateChange={setSelectedDate} />
      
      {/* Date Picker */}
      <div className="py-2 border-b border-border/50">
        <DatePicker 
          selectedDate={selectedDate} 
          onDateChange={setSelectedDate} 
        />
      </div>

      {/* Event Count */}
      <div className="px-3 py-2">
        {data && data.count > 0 && (
          <p className="text-xs text-muted-foreground">
            {data.count} event{data.count !== 1 ? 's' : ''} · {format(selectedDate, "EEE, MMM d")}
          </p>
        )}
      </div>

      {/* Events List */}
      <main className="px-3 pb-6">
        <div className={`transition-opacity duration-150 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
          {isError ? (
            <ErrorState onRetry={() => refetch()} />
          ) : !hasEvents ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <EventSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {data.events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Index;
