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
  
  const { data, isLoading, isError, refetch, isFetching } = useEvents(dateString);

  // Show skeletons only on first load, not when switching dates
  const showSkeletons = isLoading && !data;
  const showEvents = data?.events && data.events.length > 0;

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
        <div className={`transition-opacity duration-200 ${isFetching && !showSkeletons ? 'opacity-50' : 'opacity-100'}`}>
          {showSkeletons ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <EventSkeleton key={i} />
              ))}
            </div>
          ) : isError ? (
            <ErrorState onRetry={() => refetch()} />
          ) : !showEvents ? (
            <EmptyState date={dateString} />
          ) : (
            <div className="space-y-2">
              {data?.events.map((event) => (
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
