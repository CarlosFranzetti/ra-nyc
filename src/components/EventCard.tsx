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
      // `.scroll-card` lets the browser skip a card that is off screen — see
      // index.css. On the outer button rather than the <article>, so the
      // skipped box is the whole row including its share of the list gap.
      className="scroll-card block w-full text-left group"
    >
      {/* `items-center`, not `items-start` — and this has been both, so the
          reasoning is worth keeping straight.

          Top-aligning is right when the text column is about as tall as the
          flyer: the title and the image start together and any leftover is a
          pixel or two nobody sees. That stopped being true when the column went
          from four rows to three. Measured: the flyer is 80px and the text
          beside it is 53–74px depending on whether the title wraps, so
          top-aligned it left **27px of nothing under a short title and 6px
          under a long one** — a different amount of empty on every row in the
          list. That is the kind of fault you feel before you can name it; the
          flyer reads as a full-height block and the text as something that
          stopped early.

          Centred, the slack is split above and below, which is what padding is.
          The cost is that the title's top edge shifts about 9px between a one-
          and a two-line card. That is the cheaper of the two, because the
          columns the eye actually tracks down this list are the left edge and
          the flyer grid, and both are dead stable. A hole is not.

          Card height is unchanged either way: the flyer sets it.

          Separately — the flyer and the glyphs are sized in literal px while
          everything else uses the density-scaled spacing scale. Tailwind points
          width/height at that scale, so `w-24` on a thumbnail and `w-3` on a
          pin were both multiplied by the Density preference, and at Tight the
          flyer came out 40px and the pin a five-pixel smudge. See `FIXED` in
          tailwind.config.ts, which is where that is cut now. */}
      <article className="press flex items-center gap-3 bg-card rounded-lg overflow-hidden hover:bg-accent active:bg-accent border border-border/50 p-2 glow-primary-hover">
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

        {/* One gap, in rem, for all three rows.

            ## Inside a block, space belongs to the type

            The rows were spaced with `mt-0.5` and `mt-1` — the spacing scale,
            which this project multiplies by the Density preference. Measured at
            Tight that came out **0.9px** between the title and the venue and
            **1.8px** between the venue and the lineup. Nine tenths of a pixel
            is not tight spacing, it is a collision: three lines of type with
            nothing between them read as one block of noise. And the two gaps
            were in a 1:2 ratio for no reason anybody could state — the three
            rows are a plain descending hierarchy, so the intervals between them
            should be equal.

            Worse, the gap *between* cards at Tight is 4.5px. So the inside of a
            card was five times tighter than the space separating one card from
            the next, and Density was pulling the two further apart every step.
            A block whose parts crowd each other harder than the blocks crowd
            each other is a grouping error, not a dense layout.

            So: `gap-[0.25rem]`, a single even interval, in rem. It is tied to
            the root type size — so it grows when you ask for larger text, which
            is right, because it is the space between lines of that text — and
            it is immune to Density, which is also right, because Density is
            about how much room the *listings* have.

            That is the rule this card now follows and the rest of the app is
            being moved onto: **space inside a block is measured in the type;
            space between blocks is measured in the layout.** Density owns the
            card's padding and the gaps between cards. It does not reach inside
            a paragraph. */}
        <div className="flex min-w-0 flex-1 flex-col gap-[0.25rem]">
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
          <div className="flex items-center gap-x-2 text-xs text-muted-foreground">
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
              <span className="flex flex-shrink-0 items-center gap-[0.3em]">
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
            <p className="text-[0.6875rem] text-muted-foreground line-clamp-1">
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
