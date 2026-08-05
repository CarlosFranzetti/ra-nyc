/**
 * Slippy-map tile arithmetic, so a map can be a grid of `<img>` tags.
 *
 * The venue map used to be an OpenStreetMap embed iframe. One tag, no key, no
 * SDK — the right weight for something most sessions never open — but it came
 * with OSM's standard raster style, which is a pale grey-and-beige road atlas.
 * In a dark app it had to be inverted to be bearable, and inverted it looked
 * like a photographic negative of a map rather than a map.
 *
 * Composing tiles by hand keeps every property that made the iframe the right
 * call and drops the one that didn't: still no mapping library, still nothing in
 * the bundle beyond this file, but now any tile server will do. The trade is
 * that the map no longer pans or zooms — which the embed barely did either, and
 * "Open in Maps" is one tap away for anyone who wants to actually navigate.
 *
 * The maths is the standard Web Mercator scheme every tile server shares:
 * at zoom `z` the world is a 2^z × 2^z grid of 256px tiles, x running west to
 * east and y north to south.
 */

export const TILE_SIZE = 256;

export interface TilePlacement {
  /** Stable across re-renders, so React reuses the `<img>` and its cache. */
  key: string;
  url: string;
  /** Offset in CSS pixels from the container's top-left corner. */
  left: number;
  top: number;
}

/**
 * Fractional tile coordinates — the whole part identifies the tile, the
 * fraction locates the point inside it.
 */
export function tileCoords(
  lat: number,
  lon: number,
  zoom: number,
): { x: number; y: number } {
  const scale = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * scale,
    y:
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      scale,
  };
}

/**
 * CARTO's Voyager basemap: coloured, high-contrast and flat-shaded — parks
 * green, water blue, buildings picked out against the roads. It is the closest
 * keyless tile set to what a phone's own map app looks like, which is the point.
 *
 * Free for non-commercial use up to 75k map views a month, with attribution.
 * This app opens a map only when someone taps a venue name, so that ceiling is
 * a long way off; if it ever comes close, only this function changes.
 *
 * The subdomain is derived from the tile rather than picked at random, so the
 * same tile always resolves to the same host and stays in the browser cache.
 */
export function tileUrl(zoom: number, x: number, y: number, retina = false): string {
  const host = "abcd"[(x + y) % 4];
  return `https://${host}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${x}/${y}${
    retina ? "@2x" : ""
  }.png`;
}

/**
 * Every tile needed to fill `width × height` with `lat`/`lon` dead centre.
 *
 * Positions are returned rather than computed in the component so the whole
 * thing stays a pure function of five numbers — which is the only reason it can
 * be tested without a browser.
 */
export function tileMosaic(
  lat: number,
  lon: number,
  zoom: number,
  width: number,
  height: number,
  retina = false,
): TilePlacement[] {
  if (width <= 0 || height <= 0) return [];

  const scale = 2 ** zoom;
  const centre = tileCoords(lat, lon, zoom);

  // World-pixel coordinates of the container's top-left corner.
  const originX = centre.x * TILE_SIZE - width / 2;
  const originY = centre.y * TILE_SIZE - height / 2;

  const tiles: TilePlacement[] = [];
  for (
    let ty = Math.floor(originY / TILE_SIZE);
    ty * TILE_SIZE < originY + height;
    ty += 1
  ) {
    // Latitude does not wrap: above the north edge or below the south there is
    // simply no tile, and asking for one returns a 404 rather than sky.
    if (ty < 0 || ty >= scale) continue;

    for (
      let tx = Math.floor(originX / TILE_SIZE);
      tx * TILE_SIZE < originX + width;
      tx += 1
    ) {
      // Longitude does. A container wider than the world at low zoom, or a
      // venue near the antimeridian, both land outside [0, scale).
      const wrapped = ((tx % scale) + scale) % scale;
      tiles.push({
        key: `${zoom}/${tx}/${ty}`,
        url: tileUrl(zoom, wrapped, ty, retina),
        left: tx * TILE_SIZE - originX,
        top: ty * TILE_SIZE - originY,
      });
    }
  }

  return tiles;
}
