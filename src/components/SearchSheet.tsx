import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader, Search, X } from "lucide-react";
import { EventCard } from "@/components/EventCard";
import { MIN_QUERY, useSearch } from "@/hooks/useSearch";
import { loadRecent, remember, saveRecent } from "@/lib/recentSearches";
import { cn } from "@/lib/utils";
import type { Event } from "@/types/event";

/** How long the close animation runs before the panel is actually removed. */
const EXIT_MS = 240;

interface SearchSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (event: Event) => void;
  /**
   * The night the listings are currently showing, so an empty query has
   * something to answer with. Search opened onto a wall of instruction text
   * above the keyboard — a screenful of nothing, at the exact moment the panel
   * is at its shortest. These are already fetched and already on screen behind
   * the overlay, so showing them costs one render and no request.
   */
  browsing: Event[];
  browsingLabel: string;
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
export function SearchSheet({
  open,
  onOpenChange,
  onSelect,
  browsing,
  browsingLabel,
}: SearchSheetProps) {
  /**
   * The query outlives the panel.
   *
   * This component is always rendered by HomePage and only returns null when
   * closed, so its state survives a close — which is what makes reopening
   * search land back on the last thing you looked for, results and all, rather
   * than on an empty box. Closing search is usually "let me look at that one",
   * not "I am done searching".
   */
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { data, isFetching, error, pending, enabled } = useSearch(query);

  /**
   * The last six searches, from this device.
   *
   * Read once on mount rather than on every open: this component is never
   * unmounted, so "on mount" is once per page load, and the only writer is the
   * effect below.
   */
  const [recent, setRecent] = useState<string[]>(() =>
    loadRecent(typeof window === "undefined" ? null : window.localStorage),
  );

  /**
   * A search is banked when it *returns*, not when it is typed.
   *
   * Recording on keystroke would bank "m", "ma", "mat" and "mati" on the way to
   * "matias" and fill all six slots with prefixes of one search. `data.q` is
   * the term the server actually answered, which only exists for a query that
   * survived the debounce and completed — so the history is a list of searches
   * that happened rather than of characters that were typed.
   */
  const answered = data?.q ?? "";
  useEffect(() => {
    if (!answered) return;
    setRecent((current) => {
      const next = remember(current, answered);
      // `remember` is stable for a repeat of the most recent term, so this
      // guards against an identical write on every refetch.
      if (next.length === current.length && next[0] === current[0]) return current;
      saveRecent(typeof window === "undefined" ? null : window.localStorage, next);
      return next;
    });
  }, [answered]);

  const clearRecent = () => {
    setRecent([]);
    saveRecent(typeof window === "undefined" ? null : window.localStorage, []);
  };

  /**
   * Closing plays an animation, so the panel outlives the `open` prop.
   *
   * `open` going false starts the slide; a timer removes the panel when it has
   * finished. Without this the overlay simply vanished — which, beside four
   * vaul sheets that all slide out, read as the app dropping a frame rather
   * than as a thing closing.
   */
  const [present, setPresent] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open) {
      setPresent(true);
      setLeaving(false);
      return undefined;
    }
    if (!present) return undefined;
    setLeaving(true);
    const timer = setTimeout(() => {
      setPresent(false);
      setLeaving(false);
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [open, present]);

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
    // Reopening with the last query still in the box: select it rather than
    // parking a caret at the end. The old results stay readable, and the first
    // keystroke of a new search replaces the old one instead of appending to
    // it — which is the whole reason a persisted query is usually annoying.
    // `node.value` is already the query here; React sets props before it
    // attaches refs.
    if (node?.value) node.select();
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

  // Renders nothing when closed, but this component is not unmounted — HomePage
  // keeps it in the tree — so `query` and `recent` above survive and come back
  // with the panel. Only the children go, which is what re-runs the focus ref
  // on open. `present` rather than `open`, so a close gets to animate first.
  if (!present) return null;

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
        className={cn(
          "fixed inset-x-0 z-[80] flex flex-col bg-background",
          leaving ? "overlay-out" : "overlay-in",
        )}
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

        {/* pt-2, not py-4. This is the top of the screen with a keyboard under
            it, so the first result should start immediately below the field —
            sixteen pixels of nothing there is sixteen pixels of the one or two
            rows that fit. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 pb-4 pt-2">
          {/* What you looked for last, above what is on tonight.
              Retyping a DJ's name to check whether anything new was announced
              is the most repeated action this screen has, and it is the one a
              phone keyboard is worst at.

              Chips rather than a list: six of them fit in the height of two
              result rows, and this sits above the night's listings without
              pushing them off the screen. */}
          {!enabled && recent.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-baseline justify-between gap-2 px-1">
                <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Recent
                </h3>
                {/* Text, not an icon. Clearing a history is a thing people want
                    to be sure about before they tap it, and a small X beside
                    six other tappable things is not sure about anything. */}
                <button
                  type="button"
                  onClick={clearRecent}
                  className="flex-shrink-0 text-[0.6875rem] text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors active:text-foreground"
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 px-1">
                {recent.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => {
                      setQuery(term);
                      inputRef.current?.focus();
                    }}
                    className="max-w-full flex-shrink-0 truncate rounded-full border border-border/70 px-2.5 py-1 text-[0.6875rem] leading-tight text-muted-foreground transition-colors active:border-primary active:text-primary"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Nothing typed yet: show the night being browsed rather than an
              instruction. The placeholder in the field already says what to
              type, and a list you can scroll and tap is a better answer to "I
              opened search" than a sentence about minimum query length. */}
          {!enabled && browsing.length > 0 && (
            <Section title={browsingLabel} events={browsing} onSelect={onSelect} />
          )}

          {!enabled && browsing.length === 0 && (
            <p className="px-1 pt-4 text-center text-sm text-muted-foreground">
              Type at least {MIN_QUERY} characters to search NYC listings.
            </p>
          )}

          {error && (
            <p className="px-1 pt-4 text-center text-sm text-destructive">
              {error.message}
            </p>
          )}

          {nothing && (
            <div className="px-1 pt-4 text-center">
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
