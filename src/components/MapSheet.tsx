import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, LocateFixed, MapPin, Navigation, Store } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { LyftMark, UberMark } from "@/components/RideMarks";
import { lyftLink, uberLink } from "@/lib/rideLinks";
import { outbound } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { Event } from "@/types/event";
import type { MapPlace } from "@/components/MapCanvas";

// Leaflet and its CSS arrive only when the sheet is opened.
const MapCanvas = lazy(() => import("@/components/MapCanvas"));

interface PlacesResponse {
  venues: { id: string; name: string; lat: number; lng: number; address: string | null }[];
  shops: { id: string; name: string; lat: number; lng: number; address: string | null; hours: string | null }[];
}

type Kind = MapPlace["kind"];
const LEGEND_KEY = "ra-map-layers";
const DEFAULT_VISIBLE: Record<Kind, boolean> = { tonight: true, venue: true, shop: true };

function loadVisible(): Record<Kind, boolean> {
  try {
    return { ...DEFAULT_VISIBLE, ...JSON.parse(localStorage.getItem(LEGEND_KEY) ?? "{}") };
  } catch {
    return DEFAULT_VISIBLE;
  }
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tonight's listings, already in memory — no second fetch to know who is open. */
  tonight: Event[];
  /** Jump back to the listings, with this event opened. */
  onShowEvent: (event: Event) => void;
}

function clock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function MapSheet({ open, onOpenChange, tonight, onShowEvent }: Props) {
  const { data } = useQuery({
    queryKey: ["places"],
    queryFn: async () => (await fetch("/api/places")).json() as Promise<PlacesResponse>,
    enabled: open,
    staleTime: 24 * 60 * 60 * 1000,
  });

  const [visible, setVisible] = useState(loadVisible);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem(LEGEND_KEY, JSON.stringify(visible)); } catch { /* private mode */ }
  }, [visible]);
  useEffect(() => { if (!open) setSelectedId(null); }, [open]);

  const eventsByVenue = useMemo(() => {
    const m = new Map<string, Event[]>();
    for (const e of tonight) {
      if (!e.venue.id) continue;
      m.set(e.venue.id, [...(m.get(e.venue.id) ?? []), e]);
    }
    return m;
  }, [tonight]);

  const places = useMemo<MapPlace[]>(() => {
    if (!data) return [];
    return [
      ...data.venues.map((v) => ({
        id: `v:${v.id}`, kind: (eventsByVenue.has(v.id) ? "tonight" : "venue") as Kind,
        lat: v.lat, lng: v.lng, label: v.name,
      })),
      ...data.shops.map((s) => ({ id: `s:${s.id}`, kind: "shop" as Kind, lat: s.lat, lng: s.lng, label: s.name })),
    ];
  }, [data, eventsByVenue]);

  const counts = useMemo(() => {
    const c = { tonight: 0, venue: 0, shop: 0 };
    for (const p of places) c[p.kind]++;
    return c;
  }, [places]);

  const selected = selectedId?.startsWith("v:")
    ? { type: "venue" as const, v: data?.venues.find((v) => `v:${v.id}` === selectedId)! }
    : selectedId?.startsWith("s:")
      ? { type: "shop" as const, s: data?.shops.find((s) => `s:${s.id}` === selectedId)! }
      : null;

  const toggle = (k: Kind) => setVisible((cur) => ({ ...cur, [k]: !cur[k] }));

  // Only ever called from a tap on the button below.
  const locate = () => {
    if (!navigator.geolocation) return setLocating("This device can't share a location.");
    setLocating("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocating(null); },
      () => setLocating("Location is off for this site."),
      { timeout: 8000, maximumAge: 60_000 },
    );
  };

  const chip = (k: Kind, label: string, swatch: string) => (
    <button
      key={k}
      type="button"
      role="switch"
      aria-checked={visible[k]}
      data-testid={`legend-${k}`}
      onClick={() => toggle(k)}
      className={cn(
        "press flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-full border px-2 text-xs font-medium",
        visible[k] ? "border-border bg-card text-foreground" : "border-border/40 text-muted-foreground/70",
      )}
    >
      <span className={cn("block h-3 w-3 border border-background", swatch, !visible[k] && "opacity-30")} />
      <span>{label}</span>
      <span className="tabular-nums text-muted-foreground">{counts[k]}</span>
    </button>
  );

  const ride = (name: string, lat: number, lng: number, address: string | null) => ({ name, lat, lon: lng, address });

  return (
    <Drawer open={open} onOpenChange={onOpenChange} scaleBackground={false}>
      {/* Bottom edge already sits above the player bar (DrawerContent uses
          --player-h), so the height only has to leave the same room. */}
      <DrawerContent layer="over" className="h-[calc(88vh_-_var(--player-h))] max-h-[calc(88vh_-_var(--player-h))]">
        <div className="gutter flex flex-shrink-0 items-center gap-2 pb-2 pt-1">
          <MapPin className="h-4 w-4 text-venue" />
          <DrawerTitle className="flex-1 text-base font-semibold text-venue">Map</DrawerTitle>
          <button type="button" data-testid="near-me" onClick={locate} className="tap flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground active:text-foreground">
            <LocateFixed className="h-4 w-4" /> Near me
          </button>
        </div>

        {/* The legend is the filter. Three independent switches, so any
            combination works and "everything off" is a valid blank map. */}
        <div role="group" aria-label="Map layers" className="gutter flex flex-shrink-0 gap-2 pb-2">
          {chip("tonight", "Tonight", "rounded-full bg-venue")}
          {chip("venue", "Venues", "rounded-full bg-venue/50")}
          {chip("shop", "Shops", "rotate-45 rounded-[2px] bg-primary")}
        </div>
        {locating && <p role="status" className="gutter pb-1 text-xs text-muted-foreground">{locating}</p>}

        <div className="relative min-h-0 flex-1 border-t border-border/50">
          <Suspense fallback={<div className="skeleton-glow h-full w-full" />}>
            <MapCanvas places={places} visible={visible} selectedId={selectedId} onSelect={setSelectedId} me={me} />
          </Suspense>

          {selected && (
            <div data-testid="place-card" className="absolute inset-x-2 bottom-2 z-[500] max-h-[55%] overflow-y-auto rounded-xl border border-border/60 bg-card/95 p-3 shadow-lg backdrop-blur">
              {selected.type === "venue" ? (() => {
                const v = selected.v; const evs = eventsByVenue.get(v.id) ?? [];
                return (
                  <>
                    <p className="truncate text-sm font-semibold text-venue">{v.name}</p>
                    {v.address && <p className="text-xs text-muted-foreground">{v.address}</p>}
                    {evs.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {evs.map((e) => (
                          <li key={e.id}>
                            <button type="button" onClick={() => { onOpenChange(false); onShowEvent(e); }}
                              className="press flex w-full items-baseline gap-2 rounded-md bg-secondary/60 px-2 py-2 text-left text-xs">
                              <span className="tabular-nums text-muted-foreground">{clock(e.startTime)}</span>
                              <span className="min-w-0 flex-1 truncate font-medium">{e.title}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="mt-1 text-xs text-muted-foreground">Nothing listed tonight.</p>}
                    <Links {...ride(v.name, v.lat, v.lng, v.address)} from="map-venue" />
                  </>
                );
              })() : (() => {
                const s = selected.s;
                return (
                  <>
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-primary"><Store className="h-3.5 w-3.5" />{s.name}</p>
                    {s.address && <p className="text-xs text-muted-foreground">{s.address}</p>}
                    {s.hours && <p className="mt-1 flex items-center gap-1 text-xs"><Clock className="h-3 w-3 text-muted-foreground" />{s.hours}</p>}
                    <Links {...ride(s.name, s.lat, s.lng, s.address)} from="map-shop" />
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function Links({ name, lat, lon, address, from }: { name: string; lat: number; lon: number; address: string | null; from: string }) {
  const dest = { name, lat, lon, address };
  const cls = "press flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-lg border border-border/50 bg-background text-[0.6875rem] font-medium";
  return (
    <div className="mt-2 flex gap-2">
      <a className={cls} target="_blank" rel="noopener noreferrer" href={uberLink(dest)} aria-label={`Uber to ${name}`} onClick={() => outbound("uber", { venue: name, from })}><UberMark className="h-3.5 w-auto" /></a>
      <a className={cls} target="_blank" rel="noopener noreferrer" href={lyftLink(dest)} aria-label={`Lyft to ${name}`} onClick={() => outbound("lyft", { venue: name, from })}><LyftMark className="h-3.5 w-auto" /></a>
      <a className={cls} target="_blank" rel="noopener noreferrer" href={`https://maps.apple.com/?q=${encodeURIComponent(name)}&ll=${lat},${lon}`} onClick={() => outbound("maps", { venue: name, from })}><Navigation className="h-3.5 w-3.5 text-primary" />Maps</a>
    </div>
  );
}
