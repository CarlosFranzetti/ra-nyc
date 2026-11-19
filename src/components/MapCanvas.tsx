import { useEffect, useRef } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./map.css";

export interface MapPlace {
  id: string;
  kind: "tonight" | "venue" | "shop";
  /** Tonight events at this venue; drawn inside the marker. */
  count?: number;
  lat: number;
  lng: number;
  label: string;
}

interface Props {
  places: MapPlace[];
  visible: Record<MapPlace["kind"], boolean>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  me: { lat: number; lng: number } | null;
  /** Place to centre on when the sheet opens from a venue. */
  focusId?: string | null;
}

/** NYC, roughly the five boroughs, so the map can never be dragged to the Atlantic. */
const BOUNDS: [[number, number], [number, number]] = [[40.40, -74.35], [41.00, -73.55]];

/**
 * The Leaflet half of the map sheet. Loaded only when the sheet opens, so the
 * listings page never downloads Leaflet or its stylesheet.
 *
 * Markers are `divIcon`s drawn by CSS (no marker images to host, and they
 * follow the theme tokens). Each kind lives in its own layer group so the
 * legend toggles are one `addTo` / `remove` call.
 */
/** The three marker glyphs, as drawn: see the legend chips for the same shapes. */
function pinSvg(p: MapPlace): string {
  if (p.kind === "tonight") {
    const n = p.count ?? 1;
    return `<svg class="map-pin map-pin--tonight" width="28" height="28" viewBox="-14 -14 28 28" aria-hidden="true" data-testid="pin-tonight" data-place="${p.id}"><circle r="12" fill="hsl(var(--background))"/><circle r="10" fill="hsl(var(--primary))"/><text y="3.8" text-anchor="middle" font-size="11" font-weight="700" fill="hsl(var(--primary-foreground))" style="font-variant-numeric:tabular-nums">${n > 9 ? "9+" : n}</text></svg>`;
  }
  if (p.kind === "venue") {
    return `<svg class="map-pin map-pin--venue" width="20" height="20" viewBox="-10 -10 20 20" aria-hidden="true" data-testid="pin-venue" data-place="${p.id}"><circle r="7" fill="hsl(var(--background))" stroke="hsl(var(--venue))" stroke-width="2.5"/></svg>`;
  }
  return `<svg class="map-pin map-pin--shop" width="24" height="24" viewBox="-12 -12 24 24" aria-hidden="true" data-testid="pin-shop" data-place="${p.id}"><rect x="-6" y="-6" width="12" height="12" rx="2" transform="rotate(45)" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" stroke-opacity="0.8" stroke-width="2"/><circle r="1.8" fill="hsl(var(--foreground))"/></svg>`;
}

function accessibleName(p: MapPlace): string {
  if (p.kind === "tonight") return `${p.label}, ${p.count ?? 1} ${(p.count ?? 1) === 1 ? "event" : "events"} tonight`;
  return p.kind === "shop" ? `${p.label}, record shop` : `${p.label}, venue`;
}

export default function MapCanvas({ places, visible, selectedId, onSelect, me, focusId }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layers = useRef<Record<string, any>>({});
  const markers = useRef(new Map<string, any>());
  const meMarker = useRef<any>(null);
  const focusRef = useRef<any>(null);
  const mountedAt = useRef(Date.now());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const m = L.map(host.current!, {
      zoomControl: false, attributionControl: true, maxBounds: BOUNDS, minZoom: 10,
      center: [40.7217, -73.9626], zoom: 12, preferCanvas: false,
    });
    m.attributionControl.setPrefix(false);
    // CARTO's raster tiles now answer every keyless request with an "API KEY
    // REQUIRED" watermark, and a key in the client is against house rules, so
    // this is OpenStreetMap's own tile server, darkened in CSS (see map.css).
    // One line to change if a keyless dark set turns up.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, className: "map-tiles", attribution: "© OpenStreetMap contributors",
    }).addTo(m);
    layers.current = { tonight: L.layerGroup(), venue: L.layerGroup(), shop: L.layerGroup() };
    map.current = m;
    // The sheet animates in, so the container is the wrong size at first.
    const ro = new ResizeObserver(() => {
      m.invalidateSize();
      // While the sheet is still sliding in the box keeps changing size; keep a
      // venue we were asked to show in the middle of it.
      if (focusRef.current && Date.now() - mountedAt.current < 2500) m.setView(focusRef.current, 16, { animate: false });
    });
    ro.observe(host.current!);
    return () => { ro.disconnect(); m.remove(); map.current = null; markers.current.clear(); };
  }, []);

  // Build markers when the data changes.
  useEffect(() => {
    Object.values(layers.current).forEach((g: any) => g.clearLayers());
    markers.current.clear();
    for (const p of places) {
      const size = 44; // finger-sized hit area; the drawn pin is smaller
      const icon = L.divIcon({ className: "map-hit", iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: pinSvg(p) });
      const mk = L.marker([p.lat, p.lng], { icon, keyboard: true, zIndexOffset: p.kind === "tonight" ? 1000 : p.kind === "venue" ? 500 : 0 });
      const name = accessibleName(p);
      // Leaflet gives the marker element role="button"; it needs a name.
      mk.on("add", () => mk.getElement()?.setAttribute("aria-label", name));
      mk.on("click", () => onSelectRef.current(p.id));
      layers.current[p.kind].addLayer(mk);
      markers.current.set(p.id, mk);
    }
  }, [places]);

  // Centre on the venue the sheet was opened from.
  useEffect(() => {
    const mk = focusId ? markers.current.get(focusId) : null;
    if (mk && map.current) { focusRef.current = mk.getLatLng(); map.current.setView(focusRef.current, 16, { animate: false }); }
  }, [focusId, places]);

  // The legend.
  useEffect(() => {
    for (const k of ["venue", "shop", "tonight"] as const) {
      const g = layers.current[k];
      if (!g || !map.current) continue;
      if (visible[k]) g.addTo(map.current); else g.remove();
    }
  }, [visible, places]);

  useEffect(() => {
    markers.current.forEach((mk, id) =>
      mk.getElement()?.querySelector(".map-pin")?.classList.toggle("map-pin--selected", id === selectedId));
    const mk = selectedId ? markers.current.get(selectedId) : null;
    if (mk && map.current) map.current.panTo(mk.getLatLng(), { animate: true });
  }, [selectedId, visible, places]);

  useEffect(() => {
    meMarker.current?.remove();
    if (!me || !map.current) return;
    meMarker.current = L.marker([me.lat, me.lng], {
      icon: L.divIcon({ className: "map-hit", iconSize: [44, 44], html: `<span class="map-me" data-testid="pin-me"></span>` }),
      interactive: false,
    }).addTo(map.current);
    map.current.flyTo([me.lat, me.lng], 15);
  }, [me]);

  return <div ref={host} data-vaul-no-drag data-testid="map-canvas" className="h-full w-full" />;
}
