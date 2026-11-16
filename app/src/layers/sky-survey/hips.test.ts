import { describe, it, expect } from 'vitest';
import { healpixPixelPoint, healpixUnitToNested } from '@transparent-earth/core';
import { HIPS_TILE_PX, bestSource, refineToward, targetOrder, tileImageXy, tileKey, tileSegments, tileUrl, tilesForView, viewRadiusRad } from './hips';

describe('tileUrl', () => {
  it('lays tiles out as the HiPS standard does', () => {
    expect(tileUrl('https://example.org/DSS', { order: 3, ipix: 300 }, 'jpg')).toBe('https://example.org/DSS/Norder3/Dir0/Npix300.jpg');
    expect(tileUrl('https://example.org/DSS/', { order: 7, ipix: 123456 }, 'png')).toBe('https://example.org/DSS/Norder7/Dir120000/Npix123456.png');
  });

  it('keys a tile by order and pixel', () => {
    expect(tileKey({ order: 5, ipix: 42 })).toBe('5/42');
  });
});

describe('targetOrder', () => {
  const pxPerRad = (fovDeg: number, heightPx: number): number => heightPx / ((fovDeg * Math.PI) / 180);

  it('asks for whole-sky tiles in a wide view and deep ones in a narrow one', () => {
    expect(targetOrder(pxPerRad(60, 800), 0, 9)).toBeLessThanOrEqual(1);
    expect(targetOrder(pxPerRad(8, 800), 0, 9)).toBe(4);
    expect(targetOrder(pxPerRad(1, 800), 0, 9)).toBe(7);
  });

  it('goes one order deeper each time the view halves', () => {
    for (const fov of [40, 20, 10, 5, 2.5]) {
      expect(targetOrder(pxPerRad(fov / 2, 900), 0, 20)).toBe(targetOrder(pxPerRad(fov, 900), 0, 20) + 1);
    }
  });

  it('never stretches a tile past a quarter over its own pixels, nor leaves what the survey has', () => {
    for (const fov of [90, 60, 31, 17, 9, 4.2, 2, 1]) {
      const scale = pxPerRad(fov, 844);
      const order = targetOrder(scale, 0, 30);
      const tilePx = (Math.sqrt(Math.PI / 3) / 2 ** order) * scale;
      expect(tilePx).toBeLessThanOrEqual(HIPS_TILE_PX * 1.25 + 1e-9);
    }
    expect(targetOrder(pxPerRad(100, 400), 3, 9)).toBe(3);
    expect(targetOrder(pxPerRad(1, 4000), 3, 9)).toBe(9);
  });
});

describe('viewRadiusRad', () => {
  it('reaches the corners of the screen', () => {
    // Square view, 90° tall: the corner is atan(sqrt 2) from the centre.
    expect(viewRadiusRad(90, 1)).toBeCloseTo(Math.atan(Math.SQRT2), 12);
    expect(viewRadiusRad(60, 16 / 9)).toBeGreaterThan((30 * Math.PI) / 180);
  });
});

describe('tilesForView', () => {
  it('starts with the tile under the view’s centre and respects the limit', () => {
    const direction = [0.3, -0.5, 0.81] as const;
    const tiles = tilesForView(4, direction, 0.2, 12);
    expect(tiles.length).toBeLessThanOrEqual(12);
    expect(tiles[0]).toEqual({ order: 4, ipix: healpixUnitToNested(4, direction) });
  });

  it('needs a dozen or so tiles for a screen, not hundreds, at the order chosen for it', () => {
    for (const fov of [60, 20, 5, 1]) {
      const order = targetOrder(800 / ((fov * Math.PI) / 180), 0, 9);
      const tiles = tilesForView(order, [0.6, 0.64, 0.48], viewRadiusRad(fov, 1.6), 1000);
      expect(tiles.length).toBeGreaterThan(3);
      expect(tiles.length).toBeLessThan(60);
    }
  });
});

describe('tileImageXy', () => {
  it('puts the south corner top-left, the east corner bottom-left and the north corner bottom-right', () => {
    expect(tileImageXy(0, 0)).toEqual([0, 0]);
    expect(tileImageXy(1, 0)).toEqual([0, 1]);
    expect(tileImageXy(0, 1)).toEqual([1, 0]);
    expect(tileImageXy(1, 1)).toEqual([1, 1]);
  });
});

describe('bestSource', () => {
  const wanted = { order: 6, ipix: 31415 };

  it('uses the tile itself when it is held', () => {
    const source = bestSource(wanted, 0, () => true);
    expect(source).toEqual({ tile: wanted, window: { ipix: 31415, u0: 0, v0: 0, size: 1 } });
  });

  it('falls back to the nearest ancestor held, cut to the wanted tile', () => {
    const held = new Set(['4/1963', '2/122']);
    const source = bestSource(wanted, 0, (tile) => held.has(tileKey(tile)))!;
    expect(source.tile).toEqual({ order: 4, ipix: Math.floor(31415 / 16) });
    expect(source.window.size).toBe(1 / 4);
    // The window's centre is the wanted tile's centre.
    const own = healpixPixelPoint(6, 31415, 0.5, 0.5);
    const through = healpixPixelPoint(4, source.tile.ipix, source.window.u0 + source.window.size / 2, source.window.v0 + source.window.size / 2);
    expect(Math.hypot(own[0] - through[0], own[1] - through[1], own[2] - through[2])).toBeLessThan(1e-12);
  });

  it('gives nothing when no ancestor down to the survey’s first order is held', () => {
    expect(bestSource(wanted, 3, (tile) => tile.order < 3)).toBeNull();
  });
});

describe('tileSegments', () => {
  it('follows big tiles’ curved edges more finely than small ones', () => {
    expect(tileSegments(0)).toBeGreaterThan(tileSegments(3));
    expect(tileSegments(3)).toBeGreaterThan(tileSegments(8));
    expect(tileSegments(9)).toBeGreaterThanOrEqual(1);
  });
});

describe('refineToward', () => {
  const direction: [number, number, number] = [0.6, 0.3, Math.sqrt(1 - 0.45)];
  /** A tile's share of the sphere: 12 × 4^order tiles of equal area. */
  const area = (tile: { order: number }): number => 1 / (12 * 4 ** tile.order);

  it('keeps one cover of the same sky, with no two tiles over the same place', () => {
    const view = tilesForView(3, direction, 0.3, 64);
    const cover = refineToward(view, direction, 0.01, 8);
    const sum = (tiles: readonly { order: number }[]): number => tiles.reduce((total, tile) => total + area(tile), 0);
    expect(sum(cover)).toBeCloseTo(sum(view), 12);
    // No tile is an ancestor of another.
    const keys = new Set(cover.map(tileKey));
    for (const tile of cover) {
      for (let order = tile.order - 1; order >= 3; order--) {
        expect(keys.has(tileKey({ order, ipix: tile.ipix >> (2 * (tile.order - order)) }))).toBe(false);
      }
    }
  });

  it('draws the disc at the order asked for, and leaves the view far from it as it was', () => {
    // A disc about a tile of the order asked for across, as the survey pairs them (targetOrder).
    const radius = 0.01;
    const order = 6;
    const view = tilesForView(3, direction, 0.3, 64);
    const cover = refineToward(view, direction, radius, order);
    const centre = healpixUnitToNested(order, direction);
    expect(cover.map(tileKey)).toContain(tileKey({ order, ipix: centre }));
    const untouched = view.filter((tile) => !tilesForView(3, direction, radius, 64).some((near) => near.ipix === tile.ipix));
    for (const tile of untouched) expect(cover.map(tileKey)).toContain(tileKey(tile));
    // Each split adds three tiles; a few splits an order on the way down, not the whole view at order 6.
    const splitsPerOrder = (cover.length - view.length) / 3 / (order - 3);
    expect(splitsPerOrder).toBeLessThan(6);
  });
});
