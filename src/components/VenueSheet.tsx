import { useQuery } from "@tanstack/react-query";
import { ExternalLink, MapPin } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";

interface VenueResponse {
  name: string;
  lat: number | null;
  lon: number | null;
  label: string | null;
  mapsUrl: string;
}

interface VenueSheetProps {
  venue: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** A tight box around the point — close enough to recognise the block. */
const SPAN = 0.004;

async function fetchVenue(name: string, signal?: AbortSignal): Promise<VenueResponse> {
  const res = await fetch(`/api/venue?name=${encodeURIComponent(name)}`, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Couldn't locate this venue");
  }
  return (await res.json()) as VenueResponse;
}

/**
 * Where a venue is, as a sheet over the event.
 *
 * The map is an OpenStreetMap embed rather than a mapping library: it is one
 * iframe with no API key, no SDK and nothing in the bundle, which is the right
 * weight for something most sessions never open.
 *
 * OSM only renders light tiles, which would be a white slab in a dark app at
 * 2am. Inverting and rotating the hue turns it dark while leaving the map
 * legible — a filter is doing the work a paid dark tile server would otherwise
 * charge for.
 */
export function VenueSheet({ venue, open, onOpenChange }: VenueSheetProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["venue", venue],
    queryFn: ({ signal }) => fetchVenue(venue!, signal),
    enabled: open && Boolean(venue),
    staleTime: Infinity,
    retry: 1,
  });

  const located = data?.lat != null && data?.lon != null;
  const bbox = located
    ? [data!.lon! - SPAN, data!.lat! - SPAN / 2, data!.lon! + SPAN, data!.lat! + SPAN / 2].join(",")
    : null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent layer="over" className="max-h-[calc(80vh_-_var(--player-h))]">
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/50 px-4 pb-3 pt-1">
          <MapPin className="h-4 w-4 flex-shrink-0 text-venue" />
          <DrawerTitle className="min-w-0 flex-1 truncate text-base font-semibold text-venue">
            {venue ?? "Venue"}
          </DrawerTitle>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
          <div className="relative h-52 overflow-hidden rounded-lg border border-border/50 bg-secondary">
            {isLoading && <div className="skeleton-glow h-full w-full" />}

            {!isLoading && located && (
              <iframe
                title={`Map of ${venue}`}
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${data!.lat},${data!.lon}`}
                className="map-dark h-full w-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            )}

            {!isLoading && !located && (
              <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
                <MapPin className="h-5 w-5 text-muted-foreground/50" />
                <p className="text-sm text-foreground">No map for this one</p>
                <p className="text-xs text-muted-foreground">
                  {error
                    ? error.message
                    : "The venue isn't on the map yet — often the case for one-off and TBA locations."}
                </p>
              </div>
            )}
          </div>

          {data?.label && (
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">
              {data.label}
            </p>
          )}

          <a
            href={data?.mapsUrl ?? `https://maps.apple.com/?q=${encodeURIComponent(venue ?? "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg border border-primary/50 bg-card py-3 text-sm font-medium text-foreground transition-smooth active:scale-[0.99] active:bg-accent"
          >
            Open in Maps
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          </a>

          <p className="pb-safe px-1 text-center text-[0.6875rem] text-muted-foreground/60">
            Map data © OpenStreetMap contributors
          </p>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
