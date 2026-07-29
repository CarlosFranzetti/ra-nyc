import { useState } from "react";
import { format, parseISO } from "date-fns";
import type { RAEvent } from "@/types/event";
import { resolveRAImageUrl } from "@/lib/raImage";

interface EventCardProps {
  event: RAEvent;
  onOpen: (event: RAEvent) => void;
}

export default function EventCard({ event, onOpen }: EventCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = resolveRAImageUrl(event.images?.[0]?.filename);

  const formatTime = (t: string) => {
    try {
      return format(parseISO(t), "h:mm a");
    } catch {
      return t;
    }
  };

  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      className="block w-full text-left bg-card rounded-lg overflow-hidden border border-border hover:border-muted-foreground/30 active:border-muted-foreground/50 active:scale-[0.99] transition-all duration-150"
    >
      {imageUrl && !imageFailed && (
        <img
          src={imageUrl}
          alt={event.title}
          className="w-full object-cover bg-secondary"
          style={{ height: "var(--card-image-h)" }}
          loading="lazy"
          decoding="async"
          // Drop the element rather than leaving a broken-image icon; plenty of
          // RA listings have no usable flyer.
          onError={() => setImageFailed(true)}
        />
      )}
      <div className="p-[var(--card-pad)] space-y-1.5">
        <h3 className="font-semibold text-sm text-foreground leading-tight">
          {event.title}
        </h3>
        {event.venue && (
          <p className="text-xs text-muted-foreground">{event.venue.name}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {formatTime(event.startTime)} – {formatTime(event.endTime)}
        </p>
        {event.artists.length > 0 && (
          <p className="text-xs text-muted-foreground truncate">
            {event.artists.map((a) => a.name).join(", ")}
          </p>
        )}
        {event.pick && (
          <span className="inline-block text-[10px] font-medium bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
            RA Pick
          </span>
        )}
      </div>
    </button>
  );
}
