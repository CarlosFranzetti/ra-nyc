import { describe, expect, it } from "vitest";
import { TILE_SIZE, tileCoords, tileMosaic, tileUrl } from "../../src/lib/tiles.js";

/** Nowadays, Ridgewood — the venue every other test uses. */
const LAT = 40.6928669;
const LON = -73.9016974;

describe("tileCoords", () => {
  it("puts the origin at the top-left of the world", () => {
    // Web Mercator's (0,0) is 180°W, ~85°N — not the equator.
    const { x, y } = tileCoords(85.0511, -180, 0);
    expect(x).toBeCloseTo(0, 3);
    expect(y).toBeCloseTo(0, 3);
  });

  it("puts the null island at the centre", () => {
    const { x, y } = tileCoords(0, 0, 1);
    expect(x).toBeCloseTo(1, 6);
    expect(y).toBeCloseTo(1, 6);
  });

  it("agrees with the other standard form of the projection", () => {
    // Web Mercator's y can be written with asinh(tan(φ)) instead of the
    // ln(tan + sec) the implementation uses. They are identities, so writing
    // the other one here cross-checks the transcription — which a fixture
    // copied out of the implementation's own output could never do.
    const latRad = (LAT * Math.PI) / 180;
    const scale = 2 ** 16;
    const expected = {
      x: ((LON + 180) / 360) * scale,
      y: ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * scale,
    };
    const actual = tileCoords(LAT, LON, 16);
    expect(actual.x).toBeCloseTo(expected.x, 9);
    expect(actual.y).toBeCloseTo(expected.y, 9);
  });

  it("places a New York venue in the northern and western hemispheres", () => {
    const { x, y } = tileCoords(LAT, LON, 16);
    const scale = 2 ** 16;
    // West of Greenwich is the left half; north of the equator, the top half.
    expect(x).toBeLessThan(scale / 2);
    expect(y).toBeLessThan(scale / 2);
  });

  it("doubles with each zoom level", () => {
    const a = tileCoords(LAT, LON, 10);
    const b = tileCoords(LAT, LON, 11);
    expect(b.x).toBeCloseTo(a.x * 2, 6);
    expect(b.y).toBeCloseTo(a.y * 2, 6);
  });
});

describe("tileUrl", () => {
  it("builds a CARTO Voyager URL", () => {
    expect(tileUrl(16, 19315, 24647)).toMatch(
      /^https:\/\/[abcd]\.basemaps\.cartocdn\.com\/rastertiles\/voyager\/16\/19315\/24647\.png$/,
    );
  });

  it("asks for the dense variant on a retina screen", () => {
    expect(tileUrl(16, 19315, 24647, true)).toContain("@2x.png");
  });

  it("always sends the same tile to the same host", () => {
    // Random subdomains would multiply cache misses by four.
    expect(tileUrl(16, 19315, 24647)).toBe(tileUrl(16, 19315, 24647));
    expect(tileUrl(16, 19316, 24647)).not.toBe(tileUrl(16, 19315, 24647));
  });
});

describe("tileMosaic", () => {
  const WIDTH = 380;
  const HEIGHT = 208;
  const tiles = tileMosaic(LAT, LON, 16, WIDTH, HEIGHT);

  it("covers the container in both axes", () => {
    expect(tiles.some((t) => t.left <= 0)).toBe(true);
    expect(tiles.some((t) => t.left + TILE_SIZE >= WIDTH)).toBe(true);
    expect(tiles.some((t) => t.top <= 0)).toBe(true);
    expect(tiles.some((t) => t.top + TILE_SIZE >= HEIGHT)).toBe(true);
  });

  it("leaves no gaps", () => {
    // Every tile's left edge must be another tile's right edge, or outside.
    const lefts = new Set(tiles.map((t) => t.left));
    for (const tile of tiles) {
      const next = tile.left + TILE_SIZE;
      expect(next >= WIDTH || lefts.has(next)).toBe(true);
    }
  });

  it("puts the venue dead centre", () => {
    const centre = tileCoords(LAT, LON, 16);
    // Reconstruct where the point lands: its world pixel, minus the world pixel
    // of whichever tile owns it, plus that tile's placement.
    const owner = tiles.find(
      (t) => t.key === `16/${Math.floor(centre.x)}/${Math.floor(centre.y)}`,
    );
    expect(owner).toBeDefined();
    const pointX = owner!.left + (centre.x - Math.floor(centre.x)) * TILE_SIZE;
    const pointY = owner!.top + (centre.y - Math.floor(centre.y)) * TILE_SIZE;
    expect(pointX).toBeCloseTo(WIDTH / 2, 6);
    expect(pointY).toBeCloseTo(HEIGHT / 2, 6);
  });

  it("asks for more tiles as the container grows", () => {
    const wide = tileMosaic(LAT, LON, 16, 1200, HEIGHT);
    expect(wide.length).toBeGreaterThan(tiles.length);
  });

  it("returns nothing before the container has been measured", () => {
    // First render, ResizeObserver has not fired yet.
    expect(tileMosaic(LAT, LON, 16, 0, 0)).toEqual([]);
  });

  it("wraps longitude rather than requesting a tile that cannot exist", () => {
    // At the antimeridian the container straddles x = 0, and a negative tile
    // index is a 404 from every tile server there is.
    const wrapped = tileMosaic(0, 179.99, 4, 800, 200);
    for (const tile of wrapped) {
      const x = Number(tile.url.split("/").at(-2));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(2 ** 4);
    }
  });

  it("does not run off the top or bottom of the world", () => {
    // Latitude does not wrap: past the poles there is no tile, only sky.
    const polar = tileMosaic(85.05, 0, 2, 400, 400);
    for (const tile of polar) {
      const y = Number(tile.url.split("/").at(-1)!.replace(".png", ""));
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(2 ** 2);
    }
  });
});
