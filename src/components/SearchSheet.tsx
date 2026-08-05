import { useEffect, useRef, useState } from "react";
import { Loader, Search, X } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
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

  // Focus on open. The delay lets the sheet finish sliding first — focusing
  // mid-animation makes iOS raise the keyboard into a moving panel, and the
  // layout visibly jumps.
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 380);
    return () => clearTimeout(timer);
  }, [open]);

  const busy = isFetching || pending;
  const upcoming = data?.upcoming ?? [];
  const past = data?.past ?? [];
  const nothing = enabled && !busy && !error && upcoming.length === 0 && past.length === 0;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {/* A fixed height, not a max-height. Two reasons, and the second is the
          bug: content-hugging made the sheet only as tall as its results, so a
          single hit left it ~340px tall with the dimmed listings page showing
          through the overlay below it — which reads as a blank block rather
          than as "the sheet ends here". It would also have resized on every
          keystroke as results came and went.

          dvh, not vh: the dynamic viewport shrinks when the keyboard opens, so
          the sheet sits above it instead of extending behind it. */}
      <DrawerContent className="h-[calc(88dvh_-_var(--player-h))] max-h-[calc(88dvh_-_var(--player-h))]">
        <DrawerTitle className="sr-only">Search events</DrawerTitle>

        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/50 px-3 pb-3 pt-1">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/50 bg-card px-3 py-2">
            {busy ? (
              <Loader className="h-4 w-4 flex-shrink-0 animate-spin text-primary" />
            ) : (
              <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              type="search"
              inputMode="search"
              enterKeyHint="search"
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
                Nothing matching “{query.trim()}” in the last or next two months.
              </p>
            </div>
          )}

          <Section title="Upcoming" events={upcoming} onSelect={onSelect} />
          <Section title="Past" events={past} onSelect={onSelect} />

          {/* Only shown when the answer really is partial. Once the index
              covers the window there is nothing to disclaim, and a permanent
              "this may be incomplete" teaches people to ignore it. */}
          {data?.truncated && (upcoming.length > 0 || past.length > 0) && (
            <p className="px-1 pb-2 text-center text-[0.6875rem] text-muted-foreground/60">
              Searching the next month and the last two.
            </p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
