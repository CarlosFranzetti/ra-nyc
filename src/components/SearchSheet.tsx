import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader, Search, X } from "lucide-react";
import { EventCard } from "@/components/EventCard";
import { MIN_QUERY, useSearch } from "@/hooks/useSearch";
import type { Event } from "@/types/event";

interface SearchSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (event: Event) => void;
}

function Section({
  title,
  events,
  onSelect,
}: {
  title: string;
  events: Event[];
  onSelect: (event: Event) => void;
}) {
  if (events.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {title} · {events.length}
      </h3>
      <div className="space-y-2">
        {events.map((event) => (
          <EventCard key={event.id} event={event} onSelect={onSelect} showDate />
        ))}
      </div>
    </section>
  );
}

/**
 * Event search.
 *
 * Events only, by deliberate choice — the app is a listings app, so a result
 * that isn't something you can go to would be a dead end. Searching a DJ, a
 * promoter or a venue therefore answers with *their events* rather than a
 * profile page.
 *
 * Upcoming first, then past. A past result is still worth showing: "when did
 * they last play here" is a real question, and an empty upcoming list with
 * nothing under it looks like the search is broken rather than the artist
 * having nothing booked.
 */
export function SearchSheet({ open, onOpenChange, onSelect }: SearchSheetProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { data, isFetching, error, pending, enabled } = useSearch(query);

  /**
   * Focus the moment the field exists, not 380ms later.
   *
   * The old version waited for the slide-in to finish, on the theory that
   * focusing mid-animation makes iOS raise the keyboard into a moving panel.
   * The cost was worse than the cure: for a third of a second the sheet is open
   * and typing goes nowhere, so you tap the box out of habit and the delayed
   * focus then fires into a field you have already focused.
   *
   * A callback ref runs during the commit that mounts the input, which is as
   * early as it can possibly happen. `preventScroll` stops Safari yanking the
   * still-animating panel to put the field in view — that was the actual
   * source of the jump the delay was working around.
   */
  const focusInput = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    node?.focus({ preventScroll: true });
  }, []);

  /**
   * Escape closes, and the body stops scrolling underneath.
   *
   * Both came free with vaul and have to be done by hand now. The body lock is
   * the one that shows: without it, scrolling the results to their end hands
   * the gesture to the listings behind, and the page you cannot see moves.
   */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  const busy = isFetching || pending;
  const upcoming = data?.upcoming ?? [];
  const past = data?.past ?? [];
  const nothing = enabled && !busy && !error && upcoming.length === 0 && past.length === 0;
  // "Thin" rather than "empty": a search over a window the index only half
  // holds is a partial answer whether or not it found something.
  const thin = Boolean(
    data?.coverage && data.coverage.indexed < data.coverage.window * 0.9,
  );

  // No mount when closed, which also means the field is freshly focused every
  // time it opens rather than restored from wherever it was left.
  if (!open) return null;

  return (
    createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search events"
        /* Anchored to the TOP of the visual viewport, and that is the whole
           fix rather than a refinement of the last one.

           This was a bottom sheet, and a bottom sheet is the wrong shape for
           anything containing a text field on a phone. The keyboard comes up
           from the bottom, so a panel that grows from the bottom is racing it —
           and every attempt to win that race is arithmetic about how tall the
           keyboard is, which is a number the browser tells you late, changes
           mid-animation, and reports differently on iOS and Android.

           A field pinned to the top of what you can see cannot be covered by
           something that rises from the bottom. There is no race to win. It is
           also what every native mobile search does, for the same reason.

           `top: var(--vv-top)` rather than 0: `position: fixed` is measured
           against the *layout* viewport, and iOS scrolls the visual viewport
           inside it when the keyboard opens. Without that offset the overlay
           stays pinned to a top the user can no longer see. */
        style={{
          top: "var(--vv-top, 0px)",
          height: "var(--vvh, 100dvh)",
        }}
        className="fixed inset-x-0 z-[80] flex flex-col bg-background"
      >
        {/* The safe-area inset *plus* 8px, not `pt-safe` alone. This is now the
            literal top of the screen rather than the top of a panel floating
            above it, so it needs the notch inset — but that inset is 0px on
            most devices, which would leave the field flush against the top
            edge. Both terms are needed and neither is enough. */}
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/50 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+8px)]">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/50 bg-card px-3 py-2">
            {busy ? (
              <Loader className="h-4 w-4 flex-shrink-0 animate-spin text-primary" />
            ) : (
              <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            )}
            <input
              ref={focusInput}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="DJs, parties, promoters, venues"
              aria-label="Search events"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="flex-shrink-0 text-muted-foreground active:scale-90"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="flex-shrink-0 rounded-md px-1 py-1 text-sm text-muted-foreground transition-smooth active:scale-95 active:text-foreground"
          >
            Cancel
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 py-4">
          {!enabled && (
            <p className="px-1 pt-6 text-center text-sm text-muted-foreground">
              Type at least {MIN_QUERY} characters to search NYC listings.
            </p>
          )}

          {error && (
            <p className="px-1 pt-6 text-center text-sm text-destructive">
              {error.message}
            </p>
          )}

          {nothing && (
            <div className="px-1 pt-6 text-center">
              <p className="text-sm text-foreground">No events found</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Nothing matching “{query.trim()}” in the last four months or the next six weeks.
              </p>
              {/* The difference between "this DJ has no gigs" and "we have not
                  looked at those days yet" is the whole answer, and only one of
                  them is about the DJ. A cold index looks exactly like an empty
                  result from the outside, which is how a working search gets
                  reported as broken. */}
              {thin && (
                <p className="mt-2 text-[0.6875rem] leading-snug text-muted-foreground/70">
                  The saved index currently holds {data!.coverage!.indexed} of{" "}
                  {data!.coverage!.window} days, so older nights may not be
                  searchable yet. It fills as the app is used.
                </p>
              )}
            </div>
          )}

          <Section title="Upcoming" events={upcoming} onSelect={onSelect} />
          <Section title="Past" events={past} onSelect={onSelect} />

          {/* Only shown when the answer really is partial. Once the index
              covers the window there is nothing to disclaim, and a permanent
              "this may be incomplete" teaches people to ignore it. */}
          {data?.truncated && (upcoming.length > 0 || past.length > 0) && (
            <p className="px-1 pb-2 text-center text-[0.6875rem] text-muted-foreground/60">
              Searching the next six weeks and the last four months.
            </p>
          )}
        </div>
      </div>,
      document.body,
    )
  );
}
