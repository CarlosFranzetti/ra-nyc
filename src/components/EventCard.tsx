import { format, parseISO } from "date-fns";
import { Users, MapPin, Clock } from "lucide-react";
import type { Event } from "@/types/event";

interface EventCardProps {
  event: Event;
  onSelect: (event: Event) => void;
}

export function EventCard({ event, onSelect }: EventCardProps) {
  const formatTime = (time: string) => {
    if (!time) return "";

    if (time.includes("T")) {
      const d = parseISO(time);
      if (Number.isNaN(d.getTime())) return "";
      return format(d, "h:mma").toLowerCase().replace(":00", "");
    }

    const [hours, minutes = "00"] = time.split(":");
    const h = Number.parseInt(hours, 10);
    if (Number.isNaN(h)) return "";

    const suffix = h >= 12 ? "pm" : "am";
    const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    const mins = minutes === "00" ? "" : `:${minutes}`;
    return `${hour12}${mins}${suffix}`;
  };

  return (
    <button
      onClick={() => onSelect(event)}
      className="block w-full text-left group"
    >
      <article className="flex gap-3 bg-card rounded-lg overflow-hidden transition-all duration-200 hover:bg-accent border border-border/50 p-2 glow-primary-hover">
        {/* Thumbnail */}
        <div className="relative w-24 h-24 flex-shrink-0 rounded-md overflow-hidden bg-muted">
          {event.imageUrl ? (
            <img
              src={event.imageUrl}
              alt={event.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-background">
              <span className="text-xl font-bold text-muted-foreground/30">
                {event.venue.name.charAt(0)}
              </span>
            </div>
          )}
          
          {/* RA Pick Badge */}
          {event.isPick && (
            <div className="absolute top-1 left-1 bg-primary text-primary-foreground text-[9px] font-semibold px-1.5 py-0.5 rounded glow-primary-sm text-glow">
              PICK
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 py-0.5">
          {/* Title */}
          <h3 className="text-sm font-semibold text-foreground leading-tight line-clamp-2 group-hover:text-primary transition-colors">
            {event.title}
          </h3>

          {/* Venue & Time */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-0.5">
              <MapPin className="w-3 h-3" />
              {event.venue.name}
            </span>
            <span className="flex items-center gap-0.5">
              <Clock className="w-3 h-3" />
              {formatTime(event.startTime)}
            </span>
          </div>

          {/* Artists */}
          {event.artists.length > 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground line-clamp-1">
              {event.artists.slice(0, 3).join(" · ")}
              {event.artists.length > 3 && ` +${event.artists.length - 3}`}
            </p>
          )}

          {/* Attending */}
          <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="w-3 h-3" />
            <span>{event.attending.toLocaleString()} going</span>
          </div>
        </div>
      </article>
    </button>
  );
}
