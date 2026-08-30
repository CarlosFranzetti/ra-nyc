import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ExternalLink,
  Headphones,
  Library,
  Music,
  Pause,
  Play,
} from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import { usePlayer } from "@/context/PlayerContext";
import { useArtist } from "@/hooks/useArtist";
import { hostOf, outbound } from "@/lib/analytics";
import { formatDuration } from "@/lib/formatDuration";
import { cn } from "@/lib/utils";
import type { Artist } from "@/types/event";
import { PROVIDER_LABELS, type SetProvider } from "@/types/artist";

interface ArtistSheetProps {
  artist: Artist | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PROVIDER_ICON: Record<SetProvider, typeof Music> = {
  soundcloud: Music,
  mixcloud: Headphones,
  archive: Library,
};

/** How many sets the list shows before it needs asking. */
const COLLAPSED_SETS = 6;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

/**
 * The artist view, as a sheet stacked over the event sheet.
 *
 * Deliberately not a route. Tapping a DJ should feel like the lineup opening up
 * in place — the event you came from is still underneath, and dismissing brings
 * it straight back with its scroll position intact. A route change threw that
 * away and read as leaving the app.
 *
 * Everything renders in-app and in the app's own styling: bio prose is fetched
 * server-side rather than linked out to RA, and sets are queued into the
 * transport bar rather than embedded here — an embed inside this sheet dies
 * with the sheet, which is exactly what stopped playback on dismiss.
 * The only outbound links are the explicit "Elsewhere" rows at the bottom.
 */
export function ArtistSheet({ artist, open, onOpenChange }: ArtistSheetProps) {
  const { data, isLoading, error } = useArtist(artist?.id, artist?.name ?? "");
  const { playSets, toggle, isCurrent, playing } = usePlayer();
  const [bioExpanded, setBioExpanded] = useState(false);
  const [allSetsShown, setAllSetsShown] = useState(false);

  // Reset per artist, or the next one opens with the previous one's bio already
  // expanded and its set list unrolled.
  useEffect(() => {
    setBioExpanded(false);
    setAllSetsShown(false);
  }, [artist?.id]);

  const sets = data?.sets ?? [];
  const links = data?.links ?? [];

  /**
   * Tapping a DJ starts them playing. No second tap on a set.
   *
   * Opening an artist is not an ambiguous action — there is one reason to do
   * it, and making someone then hunt for a play button was a tax on the app's
   * whole point. The sheet still lists the catalogue, so picking a *different*
   * set is one tap; this just removes the tap that only ever had one answer.
   *
   * Guarded on `startedFor` rather than on `playing`, so it fires once per
   * artist: re-rendering while paused must not yank playback back on under
   * someone who deliberately paused it.
   */
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      startedFor.current = null;
      return;
    }
    const id = artist?.id;
    const resolved = data?.sets;
    if (!id || startedFor.current === id || !resolved?.length) return;
    startedFor.current = id;
    playSets(resolved, 0, artist?.name ?? null);
    // `data?.sets` rather than the `?? []` fallback above: that fallback is a
    // fresh array on every render, so depending on it re-runs this effect
    // constantly. React Query hands back a stable reference until the data
    // actually changes.
  }, [open, artist?.id, artist?.name, data?.sets, playSets]);
  // The list is a short read by default; the *queue* is always the full
  // catalogue, so `next` keeps going past whatever is on screen.
  const shownSets = allSetsShown ? sets : sets.slice(0, COLLAPSED_SETS);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent layer="over" className="max-h-[calc(92vh_-_var(--player-h))]">
        {/* Sticky header so "back" is always reachable without scrolling up. */}
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/50 px-3 pb-3 pt-1">
          <button
            onClick={() => onOpenChange(false)}
            aria-label="Back to event"
            className="-ml-1 flex items-center gap-1 rounded-md py-1 pl-1 pr-2 text-sm text-muted-foreground transition-smooth active:scale-95 active:text-foreground"
          >
            <ChevronLeft className="h-5 w-5" />
            Back
          </button>
          <DrawerTitle className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
            {artist?.name ?? "Artist"}
          </DrawerTitle>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
          {isLoading && (
            <div className="space-y-3">
              <div className="skeleton-glow h-16 rounded-lg" />
              <div className="skeleton-glow h-24 rounded-lg" />
              <div className="skeleton-glow h-12 rounded-lg" />
            </div>
          )}

          {error && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {error.message}
            </p>
          )}

          {data && (
            <>
              {/* Sets are queue entries, not embeds. Tapping one hands the
                  whole list to the player so next/previous walk this artist's
                  sets, and playback carries on after this sheet closes. */}
              {sets.length > 0 ? (
                <section className="space-y-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <SectionLabel>
                      {sets.length > 1 ? `${sets.length} sets` : "Set"}
                    </SectionLabel>
                    <span className="text-[0.625rem] uppercase tracking-wide text-muted-foreground/70">
                      Plays below
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {shownSets.map((set, position) => {
                      const live = isCurrent(set.id);
                      const Icon = PROVIDER_ICON[set.provider];
                      const meta = [
                        PROVIDER_LABELS[set.provider],
                        formatDuration(set.duration),
                        set.plays ? `${set.plays.toLocaleString()} plays` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <button
                          key={set.id}
                          onClick={() =>
                            live
                              ? toggle()
                              : playSets(sets, position, artist?.name ?? null)
                          }
                          aria-pressed={live}
                          aria-label={
                            live && playing ? `Pause ${set.title}` : `Play ${set.title}`
                          }
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-smooth active:scale-[0.99]",
                            live
                              ? "border-primary/50 bg-secondary"
                              : "border-border/50 bg-card hover:bg-accent active:bg-accent",
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
                              live
                                ? "bg-primary text-primary-foreground"
                                : "bg-secondary text-foreground",
                            )}
                          >
                            {live && playing ? (
                              <Pause className="h-3.5 w-3.5" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[0.8125rem] text-foreground">
                              {set.title}
                            </span>
                            <span className="block truncate text-[0.6875rem] text-muted-foreground">
                              {meta}
                            </span>
                          </span>
                          <Icon
                            className={cn(
                              "h-3.5 w-3.5 flex-shrink-0",
                              live ? "text-primary" : "text-muted-foreground/70",
                            )}
                          />
                        </button>
                      );
                    })}
                  </div>

                  {sets.length > COLLAPSED_SETS && (
                    <button
                      onClick={() => setAllSetsShown((shown) => !shown)}
                      className="px-1 text-xs font-medium text-primary active:opacity-70"
                    >
                      {allSetsShown
                        ? "Show fewer"
                        : `Show all ${sets.length} sets`}
                    </button>
                  )}
                </section>
              ) : (
                <section className="rounded-lg border border-border/50 bg-card p-4 text-center">
                  <Music className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
                  <p className="text-sm text-foreground">No sets found</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Nothing matched this name closely enough to be sure it&apos;s
                    them.
                  </p>
                </section>
              )}

              {/* Bio — the RA prose, rendered here rather than linked out. */}
              {data.bio && (
                <section className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <SectionLabel>Bio</SectionLabel>
                    <span className="text-[0.625rem] uppercase tracking-wide text-muted-foreground/70">
                      {data.bio.source}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "whitespace-pre-line text-sm leading-relaxed text-muted-foreground",
                      !bioExpanded && "line-clamp-6",
                    )}
                  >
                    {data.bio.text}
                  </p>
                  {data.bio.text.length > 300 && (
                    <button
                      onClick={() => setBioExpanded((v) => !v)}
                      className="text-xs font-medium text-primary active:opacity-70"
                    >
                      {bioExpanded ? "Show less" : "Show more"}
                    </button>
                  )}
                </section>
              )}

              {links.length > 0 && (
                <section className="space-y-2">
                  <SectionLabel>Elsewhere</SectionLabel>
                  <ul className="divide-y divide-border/50 overflow-hidden rounded-lg border border-border/50 bg-card">
                    {links.map((link) => (
                      <li key={link.label}>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() =>
                            outbound("artist-link", {
                              host: hostOf(link.url),
                              from: "artist-sheet",
                            })
                          }
                          className="flex items-center gap-3 px-3 py-2.5 transition-smooth hover:bg-accent active:bg-accent"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-[0.8125rem] text-foreground">
                              {link.label}
                            </span>
                            <span className="block text-[0.6875rem] text-muted-foreground">
                              {link.detail}
                            </span>
                          </span>
                          <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <p className="pb-safe px-1 text-[0.6875rem] leading-relaxed text-muted-foreground/60">
                Swipe down or tap Back to return to the event.
              </p>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
