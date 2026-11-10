import { describe, it, expect } from 'vitest';
import { GIBS_TILE_PX, gibsTileUrl, globeTileLevel, globeTilePlan, tileSpanDeg } from './gibs-tiles';

describe('the GIBS geographic tiling', () => {
  it('halves the tile span each level from 288°', () => {
    expect(tileSpanDeg(0)).toBe(288);
    expect(tileSpanDeg(3)).toBe(36);
  });

  it('picks the coarsest level at least as sharp as the picture wanted', () => {
    // A level holds 640 · 2^level pixels round the globe.
    expect(globeTileLevel(1280)).toBe(1);
    expect(globeTileLevel(2048)).toBe(2);
    expect(globeTileLevel(2560)).toBe(2);
    expect(globeTileLevel(4096)).toBe(3);
  });
});

describe('globeTilePlan', () => {
  it('covers the whole globe at 4096 with the 50 tiles of level 3, shrunk to fit', () => {
    const plan = globeTilePlan(4096);
    expect(plan).toMatchObject({ level: 3, width: 4096, height: 2048 });
    expect(plan.tiles).toHaveLength(50);
    const scale = 4096 / (640 * 8);
    for (const tile of plan.tiles) {
      expect(tile.size).toBeCloseTo(GIBS_TILE_PX * scale, 9);
      expect(tile.x).toBeCloseTo(tile.col * tile.size, 9);
      expect(tile.y).toBeCloseTo(tile.row * tile.size, 9);
    }
    // The last column ends at the right edge, the last row at the bottom: 360° by 180° exactly.
    const last = plan.tiles[plan.tiles.length - 1];
    expect(last.x + last.size).toBeCloseTo(4096, 9);
    expect(last.y + last.size).toBeCloseTo(2048, 9);
  });

  it('asks only for tiles that start on the globe at a level whose grid overhangs it', () => {
    // Level 2: 72° tiles, five across exactly, but three rows reach 216° - the third starts at 54°S.
    const plan = globeTilePlan(2048);
    expect(plan.level).toBe(2);
    expect(plan.tiles).toHaveLength(15);
    // Level 1: 144° tiles, three columns reach 432°, the third starting at 108°E.
    expect(globeTilePlan(1280).tiles).toHaveLength(6);
  });
});

describe('gibsTileUrl', () => {
  it('names a dated tile as the REST template does', () => {
    expect(gibsTileUrl({ layer: 'VIIRS_Black_Marble', matrixSet: '500m', ext: 'png' }, '2016-01-01', 2, { row: 1, col: 4 })).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_Black_Marble/default/2016-01-01/500m/2/1/4.png'
    );
  });

  it('leaves the time out for a product with only one', () => {
    expect(gibsTileUrl({ layer: 'BlueMarble_NextGeneration', matrixSet: '500m', ext: 'jpeg' }, null, 3, { row: 0, col: 9 })).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/default/500m/3/0/9.jpeg'
    );
  });
});
