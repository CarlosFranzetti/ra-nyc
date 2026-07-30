import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  Headphones,
  Library,
  MonitorPlay,
  Music,
} from "lucide-react";
import { SetPlayer } from "@/components/SetPlayer";
import { SettingsSheet } from "@/components/SettingsSheet";
import { useArtist } from "@/hooks/useArtist";
import { formatDuration } from "@/lib/formatDuration";
import { cn } from "@/lib/utils";
import { PROVIDER_LABELS, type SetProvider } from "@/types/artist";

const PROVIDER_ICON: Record<SetProvider, typeof Music> = {
  soundcloud: Music,
  mixcloud: Headphones,
  archive: Library,
  youtube: MonitorPlay,
};

/**
 * Section heading.
 *
 * The listings screen is the loud one — glows, stagger, neon accents. This page
 * is a read, so it stays deliberately quiet: muted labels, plain borders, accent
 * colour reserved for the one thing that is actually interactive.
 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

export default function ArtistPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  // The name rides along in the query string: the provider lookups are keyed on
  // it, and it lets the header render before the fetch resolves.
  const name = searchParams.get("name") ?? "";

  const { data, isLoading, error } = useArtist(id, name);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [bioExpanded, setBioExpanded] = useState(false);

  const sets = data?.sets ?? [];
  const activeSet = sets.find((s) => s.id === activeSetId) ?? sets[0] ?? null;
  const links = data?.links ?? [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 pt-safe backdrop-blur-lg">
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              to="/"
              aria-label="Back to events"
              className="-ml-2 rounded-md p-2 text-muted-foreground transition-all hover:text-foreground active:scale-95 active:text-foreground"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="truncate text-lg font-bold tracking-tight">
              {name || "Artist"}
            </h1>
          </div>
          <SettingsSheet />
        </div>
      </header>

      <main className="space-y-6 px-4 pb-10 pt-4">
        {isLoading && (
          <div className="space-y-3">
            <div className="skeleton-glow h-16 rounded-lg" />
            <div className="skeleton-glow h-28 rounded-lg" />
            <div className="skeleton-glow h-12 rounded-lg" />
          </div>
        )}

        {error && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {error.message}
          </p>
        )}

        {data && (
          <>
            {/* ── Sets ─────────────────────────────────────────────────── */}
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
                {/* Keyed so switching sets remounts rather than swapping src on a
                    live third-party player. */}
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
              // Honest empty state. Matching is deliberately strict — a
              // confidently wrong player is worse than none — so "not found"
              // happens and should point somewhere useful.
              <section className="rounded-lg border border-border/50 bg-card p-4 text-center">
                <Music className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
                <p className="text-sm text-foreground">No sets found</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Nothing matched this name closely enough to be sure it&apos;s
                  them. The links below search by name.
                </p>
              </section>
            )}

            {/* ── Bio ──────────────────────────────────────────────────── */}
            {data.bio ? (
              <section className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <SectionLabel>Bio</SectionLabel>
                  {data.bio.url ? (
                    <a
                      href={data.bio.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] uppercase tracking-wide text-muted-foreground/70 underline underline-offset-2"
                    >
                      {data.bio.source}
                    </a>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      {data.bio.source}
                    </span>
                  )}
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
            ) : (
              data.raUrl && (
                <section className="space-y-2">
                  <SectionLabel>Bio</SectionLabel>
                  <p className="text-sm text-muted-foreground">
                    No bio found.{" "}
                    <a
                      href={data.raUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2"
                    >
                      Look them up on RA
                    </a>
                    .
                  </p>
                </section>
              )
            )}

            {/* ── Links, under the bio, capped at 5 ────────────────────── */}
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

            <p className="px-1 text-[11px] leading-relaxed text-muted-foreground/60">
              Sets are matched by name across SoundCloud, Mixcloud and the
              Internet Archive, preferred in that order. Matching is strict, so a
              missing player means &ldquo;not sure&rdquo; rather than
              &ldquo;nothing exists&rdquo;.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
