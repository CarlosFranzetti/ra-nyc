import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, List, LocateFixed, Map as MapIcon, MapPin, Navigation, Store } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { LyftMark, UberMark } from "@/components/RideMarks";
import { lyftLink, uberLink } from "@/lib/rideLinks";
import { outbound } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { Event } from "@/types/event";
import type { MapPlace } from "@/components/MapCanvas";

// Leaflet and its CSS arrive only when the sheet is opened.
const MapCanvas = lazy(() => import("@/components/MapCanvas"));

interface VenueItem { id: string | null; name: string; lat: number; lng: number; address: string | null }
interface ShopItem { osm: string; name: string; lat: number; lng: number; address: string | null; hours: string | null; website?: string | null }
interface PlaceFile<T> { source: string; licence: string; fetched: string; items: T[] }

export interface MapFocus { id: string | null; name: string; lat: number; lng: number; address: string | null }

type Kind = MapPlace["kind"];
const LEGEND_KEY = "ra-map-layers";
const DEFAULT_VISIBLE: Record<Kind, boolean> = { tonight: true, venue: true, shop: true };
/** Most on-demand placements one open may spend: tonight's layer is complete, the geocoder is not hammered. */
const MAX_ON_DEMAND = 8;
const NYC = { minLat: 40.45, maxLat: 40.92, minLng: -74.3, maxLng: -73.65 };

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function loadVisible(): Record<Kind, boolean> {
  try { return { ...DEFAULT_VISIBLE, ...JSON.parse(localStorage.getItem(LEGEND_KEY) ?? "{}") }; } catch { return DEFAULT_VISIBLE; }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

function miles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selected night's events, already in the query cache. */
  tonight: Event[];
  /** Jump back to the listings, with this event opened. */
  onShowEvent: (event: Event) => void;
  /** Set when opened from a venue sheet: centre on, and select, that venue. */
  focus?: MapFocus | null;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

interface Row {
  id: string; kind: Kind; name: string; lat: number; lng: number; address: string | null;
  hours?: string | null; events: Event[];
}

export function MapSheet({ open, onOpenChange, tonight, onShowEvent, focus }: Props) {
  const staleTime = 24 * 60 * 60 * 1000;
  const venuesQ = useQuery({ queryKey: ["places", "venues"], queryFn: () => getJson<PlaceFile<VenueItem>>("/places/venues.json"), enabled: open, staleTime });
  const shopsQ = useQuery({ queryKey: ["places", "shops"], queryFn: () => getJson<PlaceFile<ShopItem>>("/places/shops.json"), enabled: open, staleTime });

  const [visible, setVisible] = useState(loadVisible);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "list">("map");
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState<string | null>(null);
  /** Tonight venues the file did not have, placed through /api/venue as the sheet opens. */
  const [placed, setPlaced] = useState<Record<string, VenueItem>>({});

  useEffect(() => { try { localStorage.setItem(LEGEND_KEY, JSON.stringify(visible)); } catch { /* private mode */ } }, [visible]);
  useEffect(() => { if (!open) { setSelectedId(null); setView("map"); } }, [open]);

  // Tonight's venues, grouped: by RA venue id, else by normalised name.
  const tonightVenues = useMemo(() => {
    const m = new Map<string, { id: string | null; name: string; events: Event[] }>();
    for (const e of tonight) {
      const key = e.venue.id ? `id:${e.venue.id}` : `n:${norm(e.venue.name)}`;
      const cur = m.get(key) ?? { id: e.venue.id, name: e.venue.name, events: [] };
      cur.events.push(e);
      m.set(key, cur);
    }
    return m;
  }, [tonight]);

  const fileVenues = venuesQ.data?.items;
  const byId = useMemo(() => new Map((fileVenues ?? []).filter((v) => v.id).map((v) => [v.id!, v])), [fileVenues]);
  const byName = useMemo(() => new Map((fileVenues ?? []).map((v) => [norm(v.name), v])), [fileVenues]);
  const locate_ = (id: string | null, name: string): VenueItem | undefined =>
    (id ? byId.get(id) : undefined) ?? byName.get(norm(name)) ?? placed[`${id ?? ""}|${norm(name)}`];

  // Place, one at a time and at most MAX_ON_DEMAND per open, whatever is on
  // tonight's bill that the file does not know.
  useEffect(() => {
    if (!open || !venuesQ.data) return undefined;
    const missing = [...tonightVenues.values()].filter((v) => !locate_(v.id, v.name) && !/^tba\b/i.test(v.name.trim())).slice(0, MAX_ON_DEMAND);
    if (!missing.length) return undefined;
    const ctl = new AbortController();
    (async () => {
      for (const v of missing) {
        try {
          const q = new URLSearchParams({ name: v.name });
          if (v.id) q.set("id", v.id);
          const r = (await (await fetch(`/api/venue?${q}`, { signal: ctl.signal })).json()) as { lat: number | null; lon: number | null; address: string | null };
          if (r.lat != null && r.lon != null && r.lat >= NYC.minLat && r.lat <= NYC.maxLat && r.lon >= NYC.minLng && r.lon <= NYC.maxLng) {
            setPlaced((cur) => ({ ...cur, [`${v.id ?? ""}|${norm(v.name)}`]: { id: v.id, name: v.name, lat: r.lat!, lng: r.lon!, address: r.address } }));
          }
        } catch { if (ctl.signal.aborted) return; }
      }
    })();
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, venuesQ.data, tonightVenues]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const seen = new Set<string>();
    const add = (id: string | null, name: string, v: VenueItem | { lat: number; lng: number; address: string | null }) => {
      const t = [...tonightVenues.values()].find((x) => (id && x.id === id) || norm(x.name) === norm(name));
      const key = `v:${id ?? norm(name)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id: key, kind: t ? "tonight" : "venue", name, lat: v.lat, lng: v.lng, address: v.address, events: t?.events ?? [] });
    };
    for (const v of fileVenues ?? []) add(v.id, v.name, v);
    for (const t of tonightVenues.values()) { const v = locate_(t.id, t.name); if (v) add(t.id, t.name, v); }
    if (focus) add(focus.id, focus.name, focus);
    for (const s of shopsQ.data?.items ?? []) out.push({ id: `s:${s.osm}`, kind: "shop", name: s.name, lat: s.lat, lng: s.lng, address: s.address, hours: s.hours, events: [] });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileVenues, shopsQ.data, tonightVenues, placed, focus]);

  const places = useMemo<MapPlace[]>(() => rows.map((r) => ({ id: r.id, kind: r.kind, lat: r.lat, lng: r.lng, label: r.name, count: r.events.length })), [rows]);
  const counts = useMemo(() => { const c = { tonight: 0, venue: 0, shop: 0 }; for (const r of rows) c[r.kind]++; return c; }, [rows]);

  const focusId = focus ? `v:${focus.id ?? norm(focus.name)}` : null;
  useEffect(() => { if (open && focusId) setSelectedId(focusId); }, [open, focusId]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;
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

  // The list is the same visible items as the map, as plain text.
  const listRows = useMemo(() => {
    const vis = rows.filter((r) => visible[r.kind]);
    if (me) return vis.map((r) => ({ r, d: miles(me, r) })).sort((a, b) => a.d - b.d);
    const rank = (r: Row) => (r.kind === "tonight" ? 0 : 1);
    return vis.map((r) => ({ r, d: null as number | null })).sort((a, b) => rank(a.r) - rank(b.r) || a.r.name.localeCompare(b.r.name));
  }, [rows, visible, me]);

  const glyph: Record<Kind, React.ReactNode> = {
    tonight: <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true"><circle r="6" fill="hsl(var(--primary))" /></svg>,
    venue: <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true"><circle r="4.5" fill="hsl(var(--background))" stroke="hsl(var(--venue))" strokeWidth="2" /></svg>,
    shop: <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true"><rect x="-3.8" y="-3.8" width="7.6" height="7.6" rx="1.2" transform="rotate(45)" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeOpacity="0.8" strokeWidth="1.5" /></svg>,
  };
  const chip = (k: Kind, label: string) => (
    // 44px hit box around a 30px pill.
    <button key={k} type="button" role="switch" aria-checked={visible[k]} data-testid={`legend-${k}`} onClick={() => toggle(k)}
      className="flex min-h-[44px] flex-1 items-center justify-center">
      <span className={cn("flex h-[30px] w-full items-center justify-center gap-1.5 rounded-full border border-border/50 bg-card px-2 text-xs font-medium text-foreground transition-opacity", !visible[k] && "opacity-[0.45]")}>
        {glyph[k]}<span>{label}</span><span className="tabular-nums text-muted-foreground">{counts[k]}</span>
      </span>
    </button>
  );

  const when = (r: Row) =>
    r.kind === "tonight" ? `${r.events.length} ${r.events.length === 1 ? "event" : "events"} tonight` : r.kind === "shop" ? "Record shop" : "Venue";

  return (
    <Drawer open={open} onOpenChange={onOpenChange} scaleBackground={false}>
      {/* Bottom edge already sits above the player bar (DrawerContent uses --player-h). */}
      <DrawerContent layer="over" className="h-[calc(88vh_-_var(--player-h))] max-h-[calc(88vh_-_var(--player-h))]">
        <div className="gutter flex flex-shrink-0 items-center gap-3 pb-0 pt-1">
          <MapPin className="h-4 w-4 text-venue" />
          <DrawerTitle className="flex-1 text-base font-semibold text-venue">Map</DrawerTitle>
          <button type="button" data-testid="view-toggle" onClick={() => setView(view === "map" ? "list" : "map")} className="tap flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground active:text-foreground">
            {view === "map" ? <><List className="h-4 w-4" />List</> : <><MapIcon className="h-4 w-4" />Map</>}
          </button>
          <button type="button" data-testid="near-me" onClick={locate} className="tap flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground active:text-foreground">
            <LocateFixed className="h-4 w-4" /> Near me
          </button>
        </div>

        <div role="group" aria-label="Map layers" className="gutter flex flex-shrink-0 gap-2">
          {chip("tonight", "Tonight")}{chip("venue", "Venues")}{chip("shop", "Shops")}
        </div>
        {locating && <p role="status" className="gutter pb-1 text-xs text-muted-foreground">{locating}</p>}

        <div className="relative min-h-0 flex-1 border-t border-border/50">
          {/* Kept mounted while the list shows, so toggling back keeps the pan and zoom. */}
          <div className={cn("h-full w-full", view === "list" && "invisible")} aria-hidden={view === "list"}>
            <Suspense fallback={<div className="skeleton-glow h-full w-full" />}>
              <MapCanvas places={places} visible={visible} selectedId={selectedId} onSelect={setSelectedId} me={me} focusId={focusId} />
            </Suspense>
          </div>

          {view === "list" && (
            <ul data-testid="place-list" className="absolute inset-0 overflow-y-auto overscroll-contain bg-background">
              {listRows.length === 0 && <li className="p-4 text-sm text-muted-foreground">Nothing to show: every layer is off.</li>}
              {listRows.map(({ r, d }) => (
                <li key={r.id} className="border-b border-border/40">
                  <button type="button" onClick={() => { setSelectedId(r.id); setView("map"); }} className="press flex min-h-[48px] w-full items-center gap-3 px-4 py-2 text-left">
                    <span className="flex-shrink-0">{glyph[r.kind]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{when(r)}{r.address ? ` · ${r.address}` : ""}</span>
                    </span>
                    {d != null && <span className="text-xs tabular-nums text-muted-foreground">{d < 0.1 ? "<0.1" : d.toFixed(1)} mi</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected && view === "map" && (
            <div data-testid="place-card" className="absolute inset-x-2 bottom-2 z-[500] max-h-[55%] overflow-y-auto rounded-xl border border-border/60 bg-card/95 p-3 shadow-lg backdrop-blur">
              {selected.kind === "shop" ? (
                <>
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground"><Store className="h-3.5 w-3.5" />{selected.name}</p>
                  {selected.address && <p className="text-xs text-muted-foreground">{selected.address}</p>}
                  {selected.hours && <p className="mt-1 flex items-start gap-1 text-xs"><Clock className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />{selected.hours}</p>}
                </>
              ) : (
                <>
                  <p className="truncate text-sm font-semibold text-venue">{selected.name}</p>
                  {selected.address && <p className="text-xs text-muted-foreground">{selected.address}</p>}
                  {selected.events.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {selected.events.map((e) => (
                        <li key={e.id}>
                          <button type="button" onClick={() => { onOpenChange(false); onShowEvent(e); }} className="press flex w-full items-baseline gap-2 rounded-md bg-secondary/60 px-2 py-2 text-left text-xs">
                            <span className="tabular-nums text-muted-foreground">{clock(e.startTime)}</span>
                            <span className="min-w-0 flex-1 truncate font-medium">{e.title}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-1 text-xs text-muted-foreground">Nothing listed on the selected night.</p>}
                </>
              )}
              <Links name={selected.name} lat={selected.lat} lon={selected.lng} address={selected.address} from={selected.kind === "shop" ? "map-shop" : "map-venue"} />
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
