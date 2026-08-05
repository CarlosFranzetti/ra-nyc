import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Car, MapPin, Navigation } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { lyftLink, uberLink } from "@/lib/rideLinks";
import { TILE_SIZE, tileMosaic } from "@/lib/tiles";

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

/**
 * Close enough to recognise the block and the cross streets, far enough out to
 * see which way the avenue runs.
 */
const ZOOM = 16;

async function fetchVenue(name: string, signal?: AbortSignal): Promise<VenueResponse> {
  const res = await fetch(`/api/venue?name=${encodeURIComponent(name)}`, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Couldn't locate this venue");
  }
  return (await res.json()) as VenueResponse;
}

/**
 * Container size, measured — the mosaic can't be laid out without it.
 *
 * A **callback ref**, not `useRef`. The obvious version reads `ref.current`
 * inside a `useEffect(..., [])`, and that silently never works here: the drawer
 * does not mount its children until it opens, so on the first render the node
 * is null, the effect bails, and with an empty dependency array it never runs
 * again once the node does appear. The result is a map frame that measures
 * correctly, sizes correctly, draws its pin — and renders no tiles at all.
 *
 * Putting the node in state means the effect re-runs the moment React attaches
 * it, whenever that turns out to be.
 */
function useMeasuredSize<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!node) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((current) =>
        // Sub-pixel jitter from the sheet's own transform would otherwise
        // re-render the whole mosaic on every frame of the open animation.
        Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
          ? current
          : { width, height },
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [setNode, size] as const;
}

/**
 * Where a venue is, as a sheet over the event.
 *
 * The map is a grid of tile images rather than a mapping library — still no API
 * key and nothing in the bundle beyond the arithmetic in `lib/tiles.ts`, which
 * is the right weight for something most sessions never open. See that file for
 * why this stopped being an OpenStreetMap iframe.
 */
export function VenueSheet({ venue, open, onOpenChange }: VenueSheetProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["venue", venue],
    queryFn: ({ signal }) => fetchVenue(venue!, signal),
    enabled: open && Boolean(venue),
    staleTime: Infinity,
    retry: 1,
  });

  const [measureMap, mapSize] = useMeasuredSize<HTMLDivElement>();

  const located = data?.lat != null && data?.lon != null;
  const destination = located
    ? { name: data!.name, lat: data!.lat!, lon: data!.lon!, address: data!.label }
    : null;

  const tiles =
    located && mapSize.width > 0
      ? tileMosaic(
          data!.lat!,
          data!.lon!,
          ZOOM,
          mapSize.width,
          mapSize.height,
          typeof window !== "undefined" && window.devicePixelRatio > 1,
        )
      : [];

  const rideClass =
    "flex flex-col items-center justify-center gap-1 rounded-lg border border-border/50 bg-card py-2.5 text-[0.6875rem] font-medium text-foreground transition-smooth active:scale-[0.98] active:bg-accent";

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
          <div
            ref={measureMap}
            aria-label={located ? `Map of ${venue}` : undefined}
            role={located ? "img" : undefined}
            className="relative h-52 overflow-hidden rounded-lg border border-border/50 bg-secondary"
          >
            {isLoading && <div className="skeleton-glow h-full w-full" />}

            {!isLoading && located && (
              <>
                {tiles.map((tile) => (
                  <img
                    key={tile.key}
                    src={tile.url}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    width={TILE_SIZE}
                    height={TILE_SIZE}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="pointer-events-none absolute max-w-none select-none"
                    // Sized inline rather than with `h-64 w-64`: this app's
                    // spacing scale is multiplied by the density preference, so
                    // a Tailwind size class would draw a 266px tile and place it
                    // on a 256px grid — every tile overlapping its neighbour,
                    // the whole map quietly stretched by four percent.
                    style={{
                      left: tile.left,
                      top: tile.top,
                      width: TILE_SIZE,
                      height: TILE_SIZE,
                    }}
                  />
                ))}

                {/* The pin's point, not its centre, marks the spot. */}
                <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
                  <MapPin
                    className="h-7 w-7 fill-venue text-background drop-shadow-[0_2px_3px_rgba(0,0,0,0.55)]"
                    strokeWidth={1.5}
                  />
                </div>
              </>
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
            <p
              data-selectable
              className="px-1 text-xs font-semibold leading-relaxed text-foreground"
            >
              {data.label}
            </p>
          )}

          {/* Getting there is the next thing you do after finding out where it
              is, so the three ways to do it sit together rather than one being
              a button and the others an afterthought. */}
          <div className="grid grid-cols-3 gap-2">
            <a
              href={data?.mapsUrl ?? `https://maps.apple.com/?q=${encodeURIComponent(venue ?? "")}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in Maps"
              className={rideClass}
            >
              <Navigation className="h-4 w-4 text-primary" />
              Open in Maps
            </a>

            <a
              href={
                destination
                  ? uberLink(destination)
                  : `https://m.uber.com/ul/?action=setPickup&pickup=my_location`
              }
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Get an Uber to ${venue ?? "this venue"}`}
              className={rideClass}
            >
              <Car className="h-4 w-4 text-primary" />
              Get an Uber
            </a>

            <a
              href={destination ? lyftLink(destination) : "https://lyft.com/ride?id=lyft"}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Get a Lyft to ${venue ?? "this venue"}`}
              className={rideClass}
            >
              <Car className="h-4 w-4 text-primary" />
              Get a Lyft
            </a>
          </div>

          <p className="pb-safe px-1 text-center text-[0.6875rem] text-muted-foreground/60">
            Map data © OpenStreetMap contributors, © CARTO
          </p>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
