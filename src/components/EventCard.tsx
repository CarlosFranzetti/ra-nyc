import { Users, MapPin, Clock } from "lucide-react";
import { EventThumb } from "@/components/EventThumb";
import { formatTime } from "@/lib/formatTime";
import type { Event } from "@/types/event";

interface EventCardProps {
  event: Event;
  onSelect: (event: Event) => void;
}

/**
 * Compact horizontal row: square thumbnail, then title / venue / time / lineup.
 *
 * The dense layout is the point — you can scan a whole night without scrolling
 * much, which a full-width flyer card can't do.
 */
export function EventCard({ event, onSelect }: EventCardProps) {
  return (
    <button onClick={() => onSelect(event)} className="block w-full text-left group">
      <article className="flex gap-3 bg-card rounded-lg overflow-hidden transition-all duration-200 hover:bg-accent active:bg-accent border border-border/50 p-2 glow-primary-hover">
        <div className="relative w-24 h-24 flex-shrink-0 rounded-md overflow-hidden bg-muted">
          <EventThumb
            imageUrl={event.imageUrl}
            alt={event.title}
            fallbackLabel={event.venue.name}
          />

          {event.isPick && (
            <div className="absolute top-1 left-1 bg-primary text-primary-foreground text-[9px] font-semibold px-1.5 py-0.5 rounded glow-primary-sm text-glow">
              PICK
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 py-0.5">
          <h3 className="text-sm font-semibold text-foreground leading-tight line-clamp-2 group-hover:text-primary transition-colors">
            {event.title}
          </h3>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-0.5 min-w-0">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{event.venue.name}</span>
            </span>
            {event.startTime && (
              <span className="flex items-center gap-0.5">
                <Clock className="w-3 h-3" />
                {formatTime(event.startTime)}
              </span>
            )}
          </div>

          {event.artists.length > 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground line-clamp-1">
              {event.artists.slice(0, 3).join(" · ")}
              {event.artists.length > 3 && ` +${event.artists.length - 3}`}
            </p>
          )}

          {event.attending > 0 && (
            <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="w-3 h-3" />
              <span>{event.attending.toLocaleString()} going</span>
            </div>
          )}
        </div>
      </article>
    </button>
  );
}
