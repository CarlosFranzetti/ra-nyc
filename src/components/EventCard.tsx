import { memo } from "react";
import { Users, MapPin, Clock } from "lucide-react";
import { EventThumb } from "@/components/EventThumb";
import { formatEventDay } from "@/lib/formatEventDay";
import { formatTime } from "@/lib/formatTime";
import type { Event } from "@/types/event";

interface EventCardProps {
  event: Event;
  onSelect: (event: Event) => void;
  /** Search results span months, so they need the date the listings never do. */
  showDate?: boolean;
}

/**
 * Compact horizontal row: square thumbnail, then title / venue / time / lineup.
 *
 * The dense layout is the point — you can scan a whole night without scrolling
 * much, which a full-width flyer card can't do.
 *
 * Memoised, because a busy Saturday renders ~50 of these and every one of them
 * was reconciling whenever any HomePage state changed — opening settings, the
 * calendar, dismissing a sheet — which are exactly the moments you are also
 * likely to be mid-scroll. Only worth it because `onSelect` is stable; an
 * inline handler would defeat it silently.
 */
function EventCardRow({ event, onSelect, showDate = false }: EventCardProps) {
  return (
    <button onClick={() => onSelect(event)} className="block w-full text-left group">
      {/* items-center is what puts equal air above and below the thumbnail.
          The column beside it is almost never exactly 96px tall — a one-line
          title with no head count is short, a two-line title with a full
          lineup is tall — and top-aligned, every pixel of that difference
          collected underneath the image as a single lopsided gap. Centred, the
          leftover splits in two, and it does so at every density and text size
          because the rule is alignment rather than a padding value that would
          have to be re-tuned for each. */}
      <article className="press flex items-center gap-3 bg-card rounded-lg overflow-hidden hover:bg-accent active:bg-accent border border-border/50 p-2 glow-primary-hover">
        <div className="relative w-24 h-24 flex-shrink-0 rounded-md overflow-hidden bg-muted">
          <EventThumb
            imageUrl={event.imageUrl}
            alt={event.title}
            fallbackLabel={event.venue.name}
          />

          {event.isPick && (
            <div className="absolute top-1 left-1 bg-primary text-primary-foreground text-[0.5625rem] font-semibold px-1.5 py-0.5 rounded glow-primary-sm text-glow">
              PICK
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center">
          {/* Two lines reserved, always: `min-h` as well as `line-clamp-2`.
              Clamping alone caps a long title but lets a short one collapse to
              one line, so a list mixing the two had cards of two heights and
              the gaps between them looked arbitrary.

              Sizing the *container* to the thumbnail was tried first and does
              not work: `min-h-24` is density-scaled (96 × 0.86 ≈ 83px at
              Default) while the text inside it is not, so a two-line title
              overflows and the cards go uneven again — measured 98 vs 107. The
              reserved line is the only thing that holds at every density.

              2.5em is exactly two lines at `leading-tight` (1.25 × 2), in em so
              it keeps matching the text when the text-size preference moves.
              2.25em was the first guess and left 4px between one- and two-line
              cards — close enough to read as a bug rather than as a choice. */}
          <h3 className="type-headline min-h-[2.5em] text-sm font-semibold text-foreground leading-tight line-clamp-2 group-hover:text-primary transition-colors">
            {event.title}
          </h3>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {/* Where it is, is the thing you scan for after what it is — so the
                venue gets its own hue and weight rather than sitting in the
                same muted grey as the time and the head count. */}
            <span className="flex items-center gap-0.5 min-w-0 font-semibold text-venue">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{event.venue.name}</span>
            </span>
            {event.startTime && (
              <span className="flex items-center gap-0.5">
                <Clock className="w-3 h-3" />
                {showDate && `${formatEventDay(event.date)}, `}
                {formatTime(event.startTime)}
              </span>
            )}
          </div>

          {/* A size down from the venue line, and closer to it. The lineup and
              the head count are the two things you read last — they should sit
              under the venue as a block rather than as two more full-size rows
              competing with it. */}
          {event.artists.length > 0 && (
            <p className="mt-1 text-[0.6875rem] text-muted-foreground line-clamp-1">
              {event.artists.slice(0, 3).map((a) => a.name).join(" · ")}
              {event.artists.length > 3 && ` +${event.artists.length - 3}`}
            </p>
          )}

          {event.attending > 0 && (
            <div className="mt-0.5 flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
              <Users className="h-2.5 w-2.5" />
              <span>{event.attending.toLocaleString()} going</span>
            </div>
          )}
        </div>
      </article>
    </button>
  );
}

export const EventCard = memo(EventCardRow);
