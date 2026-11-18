import { useEffect, useRef } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./map.css";

export interface MapPlace {
  id: string;
  kind: "tonight" | "venue" | "shop";
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
export default function MapCanvas({ places, visible, selectedId, onSelect, me }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layers = useRef<Record<string, any>>({});
  const markers = useRef(new Map<string, any>());
  const meMarker = useRef<any>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const m = L.map(host.current!, {
      zoomControl: false, attributionControl: true, maxBounds: BOUNDS, minZoom: 10,
      center: [40.7217, -73.9626], zoom: 12, preferCanvas: false,
    });
    m.attributionControl.setPrefix(false);
    const retina = window.devicePixelRatio > 1;
    // Same CARTO Voyager set the venue sheet already uses (lib/tiles.ts).
    L.tileLayer(`https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}${retina ? "@2x" : ""}.png`, {
      subdomains: "abcd", maxZoom: 19, attribution: "© OpenStreetMap contributors, © CARTO",
    }).addTo(m);
    layers.current = { tonight: L.layerGroup(), venue: L.layerGroup(), shop: L.layerGroup() };
    map.current = m;
    // The sheet animates in, so the container is the wrong size at first.
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(host.current!);
    return () => { ro.disconnect(); m.remove(); map.current = null; markers.current.clear(); };
  }, []);

  // Build markers when the data changes.
  useEffect(() => {
    Object.values(layers.current).forEach((g: any) => g.clearLayers());
    markers.current.clear();
    for (const p of places) {
      const size = 44; // finger-sized hit area; the drawn pin is smaller
      const icon = L.divIcon({
        className: "map-hit", iconSize: [size, size], iconAnchor: [size / 2, size / 2],
        html: `<span class="map-pin map-pin--${p.kind}" data-testid="pin-${p.kind}" data-place="${p.id}" role="img" aria-label="${p.label.replace(/"/g, "")}"></span>`,
      });
      const mk = L.marker([p.lat, p.lng], { icon, keyboard: true, title: p.label, zIndexOffset: p.kind === "tonight" ? 1000 : 0 });
      mk.on("click", () => onSelectRef.current(p.id));
      layers.current[p.kind].addLayer(mk);
      markers.current.set(p.id, mk);
    }
  }, [places]);

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
