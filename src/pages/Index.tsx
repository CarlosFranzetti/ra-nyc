import { useState, useEffect, useRef } from "react";
import { format, addDays, subDays } from "date-fns";
import { Header } from "@/components/Header";
import { DatePicker } from "@/components/DatePicker";
import { EventCard } from "@/components/EventCard";
import { EventSkeleton } from "@/components/EventSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { EventDetailsSheet } from "@/components/EventDetailsSheet";
import { SplashScreen } from "@/components/SplashScreen";
import { BottomNav } from "@/components/BottomNav";
import { FloatingActionButton } from "@/components/FloatingActionButton";
import { useEvents } from "@/hooks/useEvents";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Event } from "@/types/event";

const Index = () => {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const { navStyle, layoutDensity } = useTheme();
  const dateString = format(selectedDate, "yyyy-MM-dd");
  const touchStartX = useRef<number | null>(null);
  
  const { data, isLoading, isError, refetch, isFetching } = useEvents(dateString);

  // Hide splash once initial data loads
  useEffect(() => {
    if (!isLoading && data) {
      const timer = setTimeout(() => setShowSplash(false), 500);
      return () => clearTimeout(timer);
    }
  }, [isLoading, data]);

  // Swipe handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (navStyle === "swipe") {
      touchStartX.current = e.touches[0].clientX;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (navStyle === "swipe" && touchStartX.current !== null) {
      const diff = e.changedTouches[0].clientX - touchStartX.current;
      if (Math.abs(diff) > 80) {
        if (diff > 0) {
          setSelectedDate(subDays(selectedDate, 1));
        } else {
          setSelectedDate(addDays(selectedDate, 1));
        }
      }
      touchStartX.current = null;
    }
  };

  const hasEvents = data?.events && data.events.length > 0;
  const showEmptyState = data && data.events && data.events.length === 0;

  const handleEventSelect = (event: Event) => {
    setSelectedEvent(event);
    setSheetOpen(true);
  };

  const spacingClass = cn(
    layoutDensity === "ultra-compact" && "space-y-1",
    layoutDensity === "compact" && "space-y-2",
    layoutDensity === "relaxed" && "space-y-3"
  );

  const paddingClass = cn(
    layoutDensity === "ultra-compact" && "px-2 pb-4",
    layoutDensity === "compact" && "px-3 pb-6",
    layoutDensity === "relaxed" && "px-4 pb-8"
  );

  return (
    <>
      <SplashScreen isVisible={showSplash} />
      <div 
        className={cn(
          "min-h-screen bg-background",
          navStyle === "bottom-nav" && "has-bottom-nav",
          navStyle === "swipe" && "swipe-hint"
        )}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <Header selectedDate={selectedDate} onDateChange={setSelectedDate} />
        
        {/* Date Picker */}
        <div className="py-2 border-b border-border/50">
          <DatePicker 
            selectedDate={selectedDate} 
            onDateChange={setSelectedDate} 
          />
        </div>

        {/* Event Count */}
        <div className={cn(
          "py-2",
          layoutDensity === "ultra-compact" ? "px-2" : layoutDensity === "relaxed" ? "px-4" : "px-3"
        )}>
          {data && data.count > 0 && (
            <p className="text-xs text-muted-foreground">
              {data.count} event{data.count !== 1 ? 's' : ''} · {format(selectedDate, "EEE, MMM d")}
            </p>
          )}
        </div>

        {/* Events List */}
        <main className={paddingClass}>
          <div className={`transition-opacity duration-150 ${isFetching && !isLoading ? 'opacity-60' : 'opacity-100'}`}>
            {isError ? (
              <ErrorState onRetry={() => refetch()} />
            ) : showEmptyState ? (
              <EmptyState date={dateString} />
            ) : hasEvents ? (
              <div className={spacingClass}>
                {data.events.map((event) => (
                  <EventCard key={event.id} event={event} onSelect={handleEventSelect} />
                ))}
              </div>
            ) : (
              <div className={spacingClass}>
                {[...Array(6)].map((_, i) => (
                  <EventSkeleton key={i} />
                ))}
              </div>
            )}
          </div>
        </main>

        {/* Event Details Sheet */}
        <EventDetailsSheet
          event={selectedEvent}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
        />

        {/* Navigation variants */}
        {navStyle === "bottom-nav" && (
          <BottomNav onCalendarClick={() => setCalendarOpen(true)} />
        )}

        {navStyle === "fab" && (
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <div>
                <FloatingActionButton onClick={() => setCalendarOpen(true)} />
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end" side="top">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  if (date) {
                    setSelectedDate(date);
                    setCalendarOpen(false);
                  }
                }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        )}

        {/* Calendar popover for bottom nav */}
        {navStyle === "bottom-nav" && (
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <span className="hidden" />
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 fixed bottom-20 left-1/2 -translate-x-1/2" align="center">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  if (date) {
                    setSelectedDate(date);
                    setCalendarOpen(false);
                  }
                }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
    </>
  );
};

export default Index;
