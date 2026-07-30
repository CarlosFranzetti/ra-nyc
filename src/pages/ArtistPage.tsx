import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Disc3,
  ExternalLink,
  Headphones,
  Music,
  Search,
} from "lucide-react";
import { SetPlayer } from "@/components/SetPlayer";
import { SettingsSheet } from "@/components/SettingsSheet";
import { useArtist } from "@/hooks/useArtist";
import { formatDuration } from "@/lib/formatDuration";
import { cn } from "@/lib/utils";

function OutboundLink({
  href,
  label,
  detail,
  icon: Icon,
}: {
  href: string;
  label: string;
  detail: string;
  icon: typeof Disc3;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3 transition-smooth hover:bg-accent active:bg-accent active:scale-[0.99]"
    >
      <Icon className="h-4 w-4 flex-shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
      <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
    </a>
  );
}

export default function ArtistPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  // The name rides along in the query string: RA's GraphQL needs it for the
  // Mixcloud lookup, and it lets the header render before the fetch resolves.
  const name = searchParams.get("name") ?? "";

  const { data, isLoading, error } = useArtist(id, name);
  const [activeSetKey, setActiveSetKey] = useState<string | null>(null);

  const sets = data?.sets ?? [];
  const activeSet = sets.find((s) => s.key === activeSetKey) ?? sets[0] ?? null;

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

      <main className="space-y-5 px-4 pb-10 pt-4">
        {isLoading && (
          <div className="space-y-3">
            <div className="skeleton-glow h-20 rounded-lg" />
            <div className="skeleton-glow h-14 rounded-lg" />
            <div className="skeleton-glow h-14 rounded-lg" />
          </div>
        )}

        {error && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {error.message}
          </p>
        )}

        {data && (
          <>
            {/* Player */}
            {activeSet ? (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Headphones className="h-4 w-4 text-primary" />
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Now playing
                  </h2>
                </div>
                <p className="text-sm font-medium leading-tight text-foreground">
                  {activeSet.title}
                </p>
                <SetPlayer key={activeSet.key} set={activeSet} />
              </section>
            ) : (
              // Honest empty state. Matching is deliberately strict — a
              // confidently wrong player is worse than none — so "not found"
              // happens and should point somewhere useful.
              <section className="rounded-lg border border-border/50 bg-card p-4 text-center">
                <Music className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">No sets found</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Nothing on Mixcloud matched this name closely enough to be sure
                  it&apos;s them. The links below search by name.
                </p>
              </section>
            )}

            {/* Other sets */}
            {sets.length > 1 && (
              <section className="space-y-2">
                <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {sets.length} sets
                </h2>
                <div className="space-y-1.5">
                  {sets.map((set) => {
                    const isActive = set.key === activeSet?.key;
                    const duration = formatDuration(set.duration);
                    return (
                      <button
                        key={set.key}
                        onClick={() => setActiveSetKey(set.key)}
                        aria-pressed={isActive}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-smooth active:scale-[0.99]",
                          isActive
                            ? "border-primary bg-primary/10"
                            : "border-border/50 bg-card hover:bg-accent active:bg-accent",
                        )}
                      >
                        <Music
                          className={cn(
                            "h-4 w-4 flex-shrink-0",
                            isActive ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-foreground">
                            {set.title}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {[
                              duration,
                              set.plays ? `${set.plays.toLocaleString()} plays` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "Mixcloud"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Profiles */}
            <section className="space-y-2">
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Profiles
              </h2>
              <div className="space-y-1.5">
                {data.raUrl && (
                  <OutboundLink
                    href={data.raUrl}
                    icon={Disc3}
                    label="Resident Advisor"
                    detail={
                      data.raUrl.includes("/search")
                        ? "Search RA for this artist"
                        : "Bio, upcoming events and past gigs"
                    }
                  />
                )}
                {data.mixcloudUrl && (
                  <OutboundLink
                    href={data.mixcloudUrl}
                    icon={Headphones}
                    label="Mixcloud"
                    detail={`@${data.mixcloudUser}`}
                  />
                )}
                {data.discogsUrl && (
                  <OutboundLink
                    href={data.discogsUrl}
                    icon={Disc3}
                    label="Discogs"
                    detail={
                      data.discogsUrl.includes("/search")
                        ? "Search Discogs for releases"
                        : "Discography"
                    }
                  />
                )}
                {data.soundcloudUrl && (
                  <OutboundLink
                    href={data.soundcloudUrl}
                    icon={Search}
                    label="SoundCloud"
                    detail="Search — their API is closed to new apps"
                  />
                )}
              </div>
            </section>

            <p className="px-1 text-[11px] leading-relaxed text-muted-foreground/70">
              Sets come from Mixcloud, matched by name. Matching is strict on
              purpose, so a missing player means &ldquo;not sure&rdquo; rather than
              &ldquo;nothing exists&rdquo;.
              {!data.persisted && " Results are cached at the edge."}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
