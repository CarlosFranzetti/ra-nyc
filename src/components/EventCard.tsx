import { format } from "date-fns";
import { Users, ExternalLink, MapPin, Clock } from "lucide-react";
import type { Event } from "@/types/event";
import { cn } from "@/lib/utils";

interface EventCardProps {
  event: Event;
}

export function EventCard({ event }: EventCardProps) {
  const formatTime = (time: string) => {
    if (!time) return "";
    const [hours, minutes] = time.split(":");
    const h = parseInt(hours);
    return `${h > 12 ? h - 12 : h}${minutes !== "00" ? `:${minutes}` : ""}${h >= 12 ? "pm" : "am"}`;
  };

  return (
    <a
      href={event.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block group"
    >
      <article className="bg-card rounded-xl overflow-hidden transition-smooth hover:bg-accent border border-border/50">
        {/* Image */}
        <div className="relative aspect-[16/9] bg-muted overflow-hidden">
          {event.imageUrl ? (
            <img
              src={event.imageUrl}
              alt={event.title}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-background">
              <span className="text-4xl font-bold text-muted-foreground/20">
                {event.venue.name.charAt(0)}
              </span>
            </div>
          )}
          
          {/* RA Pick Badge */}
          {event.isPick && (
            <div className="absolute top-3 left-3 bg-primary text-primary-foreground text-xs font-semibold px-2 py-1 rounded">
              RA PICK
            </div>
          )}

          {/* Attending count */}
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-background/80 backdrop-blur-sm text-foreground text-xs font-medium px-2 py-1 rounded-full">
            <Users className="w-3 h-3" />
            <span>{event.attending.toLocaleString()}</span>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Title */}
          <h3 className="font-semibold text-foreground leading-tight line-clamp-2 group-hover:text-primary transition-colors">
            {event.title}
          </h3>

          {/* Venue & Time */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              {event.venue.name}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {formatTime(event.startTime)}
              {event.endTime && ` – ${formatTime(event.endTime)}`}
            </span>
          </div>

          {/* Artists */}
          {event.artists.length > 0 && (
            <div className="mt-3">
              <p className="text-sm text-muted-foreground line-clamp-2">
                {event.artists.slice(0, 5).join(" · ")}
                {event.artists.length > 5 && ` +${event.artists.length - 5} more`}
              </p>
            </div>
          )}

          {/* External link indicator */}
          <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
            <ExternalLink className="w-3 h-3" />
            <span>Open on RA</span>
          </div>
        </div>
      </article>
    </a>
  );
}
