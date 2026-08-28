import { memo } from "react";
import { Clock } from "lucide-react";
import { EventThumb } from "@/components/EventThumb";
import { usePrefetchEventImage } from "@/hooks/useEvents";
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
  const warmImage = usePrefetchEventImage();

  return (
    <button
      onClick={() => onSelect(event)}
      // Same trigger as the date rail's data prefetch (`DatePicker`) and the
      // lineup's artist prefetch — warm the flyer the detail sheet is about to
      // show eagerly, before the tap that opens it lands.
      onMouseEnter={() => warmImage(event.imageUrl)}
      onTouchStart={() => warmImage(event.imageUrl)}
      className="block w-full text-left group"
    >
      {/* items-start: the title starts level with the top of the flyer, and
          whatever room is left over collects under the lineup.

          This was `items-center`, which split the leftover in two and put half
          of it above the title. That was the right call when the text column
          was four rows and roughly as tall as the flyer, because the halves
          were a pixel or two each. It is the wrong one now that the column is
          three rows: the slack is ~14px, and centred it pushed the title down
          the card while the flyer stayed put, so the two things that should
          start together did not. Slack below the last line is invisible; slack
          above the first line is a misalignment. */}
      {/* Icons and the flyer are sized in literal px, everything else in the
          density-scaled scale. Tailwind shares one scale between padding and
          width/height, so `w-24` on the thumbnail and `w-3` on a pin were both
          being multiplied by the Density preference — which is right for air
          and wrong for objects. At Tight the flyer had become 40px and the map
          pin a five-pixel smudge. Density changes how much room things have,
          not how big they are. */}
      <article className="press flex items-start gap-3 bg-card rounded-lg overflow-hidden hover:bg-accent active:bg-accent border border-border/50 p-2 glow-primary-hover">
        <div className="relative h-[80px] w-[80px] flex-shrink-0 overflow-hidden rounded-md bg-muted">
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

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Clamped at two lines, but no longer *reserving* two.
              A `min-h-[2.5em]` used to hold a second line open under every
              short title, because the card's height was set by its text and a
              list mixing one- and two-line titles otherwise had cards of two
              heights with arbitrary-looking gaps between them.

              Moving the head count up beside the time removed a row, and with
              three rows instead of four the text column no longer reaches the
              flyer's 80px at any density or text size — so the *flyer* sets the
              height and every card is the same height without help. Measured
              across both density extremes and the full text-size range: spread
              0px everywhere except the largest text at Airy, which is 2px.

              What the reserved line cost was visible: an empty line under
              "Body Hack" and "Rival Consoles", separating each title from its
              own venue by more than the gap to the next card. */}
          <h3 className="type-headline text-sm font-semibold text-foreground leading-tight line-clamp-2 group-hover:text-primary transition-colors">
            {event.title}
          </h3>

          {/* Venue and time on the left, head count hard right.
              The head count used to be a fourth row of its own under the
              lineup, which cost every card in the list ~18px to carry two
              words. This row was half empty, so it costs nothing here — and
              held to the right edge it forms a column you can read straight
              down the list rather than a number that starts somewhere
              different on every card. */}
          <div className="mt-0.5 flex items-center gap-x-2 text-xs text-muted-foreground">
            {/* Where it is, is the thing you scan for after what it is — so the
                venue gets its own hue and weight rather than sitting in the
                same muted grey as the time and the head count.

                No pin icon any more. The icon indented the venue by about
                fourteen pixels, so the two things you actually read down the
                list — the title and the room — started at two different left
                edges and the column had a kink in it. Colour and weight already
                say this is the venue; the pin was saying it a second time and
                charging alignment for it. */}
            <span className="min-w-0 truncate font-semibold text-venue">
              {event.venue.name}
            </span>

            {/* The time sits with the venue, where it has always been: those
                two are one thought — where, and when. It is the head count
                that is the separate fact, so that is the one held against the
                right edge by `ml-auto`, in the same column down the whole
                list. */}
            {event.startTime && (
              <span className="flex flex-shrink-0 items-center gap-0.5">
                <Clock className="h-[12px] w-[12px] flex-shrink-0" />
                {showDate && `${formatEventDay(event.date)}, `}
                {formatTime(event.startTime)}
              </span>
            )}

            {event.attending > 0 && (
              <span className="ml-auto flex-shrink-0 whitespace-nowrap">
                {event.attending.toLocaleString()} going
              </span>
            )}
          </div>

          {/* A size down from the venue line, and closer to it. The lineup is
              the thing you read last, so it sits under the venue as a footnote
              rather than as another full-size row competing with it. */}
          {event.artists.length > 0 && (
            <p className="mt-1 text-[0.6875rem] text-muted-foreground line-clamp-1">
              {event.artists.slice(0, 3).map((a) => a.name).join(" · ")}
              {event.artists.length > 3 && ` +${event.artists.length - 3}`}
            </p>
          )}
        </div>
      </article>
    </button>
  );
}

export const EventCard = memo(EventCardRow);
