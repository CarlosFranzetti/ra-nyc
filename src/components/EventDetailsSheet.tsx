import { useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Headphones,
  Loader,
  MapPin,
  Play,
  Users,
  X,
} from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import { EventThumb } from "@/components/EventThumb";
import { usePrefetchArtist } from "@/hooks/useArtist";
import { useEventPreview } from "@/hooks/useEventPreview";
import { formatTime } from "@/lib/formatTime";
import { cn } from "@/lib/utils";
import type { Artist, Event } from "@/types/event";

/**
 * How many of the bill to warm on open. Matches the preview's own cap, so the
 * requests made are exactly the ones the preview will use — warming a name the
 * preview will never reach is a request spent on nothing.
 */
const LINEUP_WARM_LIMIT = 6;

interface EventDetailsSheetProps {
  event: Event | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the artist sheet over this one, keeping the event underneath. */
  onSelectArtist: (artist: Artist) => void;
  onSelectVenue: (venue: string) => void;
}

/** Chips shown before the lineup collapses behind a "+N more". */
const LINEUP_PREVIEW = 8;

function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "EEEE, MMMM d");
  } catch {
    return dateStr;
  }
}

export function EventDetailsSheet({
  event,
  open,
  onOpenChange,
  onSelectArtist,
  onSelectVenue,
}: EventDetailsSheetProps) {
  const prefetchArtist = usePrefetchArtist();
  const preview = useEventPreview();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [blurbExpanded, setBlurbExpanded] = useState(false);
  const [lineupExpanded, setLineupExpanded] = useState(false);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);

  // Reset per event, or the next event opens mid-scroll with the previous
  // event's toggles applied.
  useEffect(() => {
    setExpanded(false);
    setBlurbExpanded(false);
    setLineupExpanded(false);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [event?.id]);

  // Track whether content continues past the fold, so the "more" affordance only
  // appears when there is actually something to see.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !open) return;

    const update = () => {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      setHasMoreBelow(remaining > 24);
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [open, event?.id, expanded, blurbExpanded, lineupExpanded]);

  // Warm every DJ on the bill the moment the sheet opens, so tapping any of
  // them — or the preview button — has nothing left to wait for. These are
  // edge-cached and mostly cache hits; the cost is a handful of requests during
  // the time it takes to read a lineup.
  //
  // Above the `if (!event) return null` below, and it has to stay there: hooks
  // run in a fixed order, so one placed after an early return is skipped
  // whenever that return fires and React throws "rendered more hooks than
  // during the previous render" the moment an event arrives.
  useEffect(() => {
    if (!open || !event) return;
    for (const artist of event.artists.slice(0, LINEUP_WARM_LIMIT)) {
      prefetchArtist(artist.id, artist.name);
    }
  }, [open, event, prefetchArtist]);

  if (!event) return null;

  const artists = lineupExpanded
    ? event.artists
    : event.artists.slice(0, LINEUP_PREVIEW);
  const hiddenArtists = event.artists.length - artists.length;

  /**
   * Tap-to-dismiss on dead space.
   *
   * The sheet is mostly text, so most of it isn't a control — tapping the
   * flyer, the venue line or the padding did nothing, which reads as stuck.
   * Anything that isn't a control now slides it away. `closest` means a tap on
   * an icon inside a button still counts as the button.
   */
  const closeUnlessInteractive = (clickEvent: React.MouseEvent<HTMLDivElement>) => {
    const target = clickEvent.target as HTMLElement;
    if (!target.closest("button, a, input, [role='button']")) {
      onOpenChange(false);
    }
  };

  const scrollToMore = () => {
    const el = scrollRef.current;
    if (!el) return;
    // Page down rather than jump to the end — the user asked for "more", not
    // "the bottom".
    el.scrollBy({ top: el.clientHeight * 0.8, behavior: "smooth" });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className={
          expanded
            ? "max-h-[calc(100dvh_-_var(--player-h))] h-[calc(100dvh_-_var(--player-h))]"
            : undefined
        }
      >
        <DrawerClose asChild>
          <button
            aria-label="Close"
            className="absolute right-3 top-4 z-20 rounded-full bg-background/80 p-2 text-foreground backdrop-blur-sm transition-transform active:scale-95"
          >
            <X className="h-5 w-5" />
          </button>
        </DrawerClose>

        {/* The scroller, not the drawer, owns overflow — min-h-0 is what lets a
            flex child actually shrink and scroll instead of pushing the drawer
            past its max height. */}
        <div
          ref={scrollRef}
          onClick={closeUnlessInteractive}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div
            className={cn(
              "w-full overflow-hidden bg-muted transition-all duration-200",
              // Expanding trades flyer for text — the reason you expand is to
              // read the rest, not to see a bigger picture.
              expanded ? "aspect-auto h-24" : "aspect-square max-h-[40vh]",
            )}
          >
            <EventThumb
              imageUrl={event.imageUrl}
              alt={event.title}
              fallbackLabel={event.venue.name}
              fallbackTextClass={expanded ? "text-3xl" : "text-6xl"}
              eager
            />
          </div>

          <div className="space-y-4 px-4 py-5">
            {event.isPick && (
              <div className="glow-primary-sm inline-block rounded bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">
                RA PICK
              </div>
            )}

            <DrawerTitle className="text-left text-xl font-bold leading-tight text-foreground">
              {event.title}
            </DrawerTitle>

            {event.pickBlurb && (
              <div>
                <p
                  className={cn(
                    "text-sm italic text-muted-foreground",
                    !blurbExpanded && "line-clamp-3",
                  )}
                >
                  &ldquo;{event.pickBlurb}&rdquo;
                </p>
                {event.pickBlurb.length > 180 && (
                  <button
                    onClick={() => setBlurbExpanded((v) => !v)}
                    className="mt-1 text-xs font-medium text-primary active:opacity-70"
                  >
                    {blurbExpanded ? "Show less" : "Show more"}
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 text-sm text-foreground">
              <Clock className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <span>
                {formatDate(event.date)}
                {event.startTime && ` · ${formatTime(event.startTime)}`}
                {event.endTime && ` – ${formatTime(event.endTime)}`}
              </span>
            </div>

            {/* Same treatment as the card, so the venue reads the same way
                whichever screen you're on — and here it is also the way to a
                map, which is the question a venue name actually raises. */}
            <button
              onClick={() => onSelectVenue(event.venue.name)}
              className="-mx-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm font-semibold text-venue transition-smooth active:scale-[0.98] active:bg-accent"
            >
              <MapPin className="h-4 w-4 flex-shrink-0" />
              <span className="underline decoration-venue/30 underline-offset-4">
                {event.venue.name}
              </span>
            </button>

            {event.attending > 0 && (
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Users className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span>{event.attending.toLocaleString()} going</span>
              </div>
            )}

            {event.artists.length > 0 && (
              <div className="border-t border-border pt-3">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Headphones className="h-3.5 w-3.5" />
                  Lineup — tap to hear a set
                </h3>

                {/* Deliberately a tap, not automatic on opening the event.
                    People open a party to read the time and the bill, and
                    sound they did not ask for is the rudest thing an app can
                    do on a phone. One obvious button is the same idea without
                    the ambush — and it keeps playback tied to a real user
                    gesture, which is also what browsers require. */}
                <button
                  onClick={() => preview.start(event)}
                  disabled={preview.preparing}
                  className="press mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-primary/50 bg-card py-2.5 text-sm font-medium text-foreground disabled:opacity-60"
                >
                  {preview.preparing ? (
                    <Loader className="h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <Play className="h-4 w-4 fill-primary text-primary" />
                  )}
                  {preview.preparing ? "Finding sets…" : "Preview the night"}
                </button>
                {preview.empty && (
                  <p className="mb-3 text-center text-xs text-muted-foreground">
                    No sets found for this lineup.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {artists.map((artist) => (
                    <button
                      key={artist.id || artist.name}
                      onClick={() => onSelectArtist(artist)}
                      onTouchStart={() => prefetchArtist(artist.id, artist.name)}
                      onMouseEnter={() => prefetchArtist(artist.id, artist.name)}
                      className="rounded-full border border-border/60 bg-secondary px-2.5 py-1 text-sm text-secondary-foreground transition-smooth hover:border-primary hover:text-primary active:scale-95"
                    >
                      {artist.name}
                    </button>
                  ))}
                  {hiddenArtists > 0 && (
                    <button
                      onClick={() => setLineupExpanded(true)}
                      className="rounded-full border border-dashed border-border px-2.5 py-1 text-sm text-muted-foreground active:scale-95"
                    >
                      +{hiddenArtists} more
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="pb-safe pt-2">
              <a
                href={event.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-smooth hover:opacity-90 active:scale-[0.99]"
              >
                View on RA
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>

        {/* "More" affordance. Only rendered when content actually continues past
            the fold, so it never lies about there being more. */}
        {hasMoreBelow && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-background via-background/80 to-transparent pb-safe pt-8">
            <div className="pointer-events-auto flex gap-2 pb-3">
              <button
                onClick={scrollToMore}
                className="glow-primary-sm flex items-center gap-1 rounded-full border border-primary/50 bg-card px-3 py-1.5 text-xs font-medium text-foreground active:scale-95"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                More
              </button>
              <button
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? "Shrink" : "Expand to full screen"}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground active:scale-95"
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronUp className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
