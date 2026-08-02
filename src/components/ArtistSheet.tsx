import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ExternalLink,
  Headphones,
  Library,
  MonitorPlay,
  Music,
} from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import { SetPlayer } from "@/components/SetPlayer";
import { useArtist } from "@/hooks/useArtist";
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
  youtube: MonitorPlay,
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
 * server-side rather than linked out to RA, and sets play in an embedded widget.
 * The only outbound links are the explicit "Elsewhere" rows at the bottom.
 */
export function ArtistSheet({ artist, open, onOpenChange }: ArtistSheetProps) {
  const { data, isLoading, error } = useArtist(artist?.id, artist?.name ?? "");
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [bioExpanded, setBioExpanded] = useState(false);

  // Reset per artist, or the next one opens showing the previous artist's
  // selected set and expanded bio.
  useEffect(() => {
    setActiveSetId(null);
    setBioExpanded(false);
  }, [artist?.id]);

  const sets = data?.sets ?? [];
  const activeSet = sets.find((s) => s.id === activeSetId) ?? sets[0] ?? null;
  const links = data?.links ?? [];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent layer="over" className="max-h-[92vh]">
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
              {/* Sets — selectable in place, player swaps without leaving. */}
              {activeSet ? (
                <section className="space-y-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <SectionLabel>
                      {sets.length > 1 ? `${sets.length} sets` : "Set"}
                    </SectionLabel>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      {PROVIDER_LABELS[activeSet.provider]}
                    </span>
                  </div>

                  <p className="text-sm font-medium leading-snug text-foreground">
                    {activeSet.title}
                  </p>
                  <SetPlayer key={activeSet.id} set={activeSet} />

                  {sets.length > 1 && (
                    <div className="space-y-1.5 pt-1">
                      {sets.map((set) => {
                        const isActive = set.id === activeSet.id;
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
                            onClick={() => setActiveSetId(set.id)}
                            aria-pressed={isActive}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-smooth active:scale-[0.99]",
                              isActive
                                ? "border-primary/50 bg-secondary"
                                : "border-border/50 bg-card hover:bg-accent active:bg-accent",
                            )}
                          >
                            <Icon
                              className={cn(
                                "h-3.5 w-3.5 flex-shrink-0",
                                isActive ? "text-primary" : "text-muted-foreground",
                              )}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] text-foreground">
                                {set.title}
                              </span>
                              <span className="block text-[11px] text-muted-foreground">
                                {meta}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
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
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
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
                          className="flex items-center gap-3 px-3 py-2.5 transition-smooth hover:bg-accent active:bg-accent"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] text-foreground">
                              {link.label}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
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

              <p className="pb-safe px-1 text-[11px] leading-relaxed text-muted-foreground/60">
                Swipe down or tap Back to return to the event.
              </p>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
