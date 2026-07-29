import { useState } from "react";
import { format, parseISO } from "date-fns";
import type { RAEvent } from "@/types/event";
import { resolveRAImageUrl } from "@/lib/raImage";

interface EventCardProps {
  event: RAEvent;
}

export default function EventCard({ event }: EventCardProps) {
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
    <a
      href={`https://ra.co${event.contentUrl}`}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-card rounded-lg overflow-hidden border border-border hover:border-muted-foreground/30 transition-colors"
    >
      {imageUrl && !imageFailed && (
        <img
          src={imageUrl}
          alt={event.title}
          className="w-full h-44 object-cover bg-secondary"
          loading="lazy"
          decoding="async"
          // Drop the element rather than leaving a broken-image icon; plenty of
          // RA listings have no usable flyer.
          onError={() => setImageFailed(true)}
        />
      )}
      <div className="p-3 space-y-1.5">
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
    </a>
  );
}
