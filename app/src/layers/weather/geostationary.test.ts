import { describe, it, expect } from 'vitest';
import {
  GEO_SATELLITES,
  SEAM_LONGITUDE,
  canvasX,
  encodeGeoTag,
  geoCanvasSize,
  geoColorSource,
  geoDomainUrl,
  geoTileUrl,
  geoTiles,
  parseGeoTag,
} from './geostationary';
import { earthNowLevel } from './shells';

const west = GEO_SATELLITES[0];
const east = GEO_SATELLITES[1];

describe('the tiling', () => {
  it('makes a canvas twice as wide as tall, at the tiles’ own scale', () => {
    expect(geoCanvasSize(1)).toEqual({ width: 1280, height: 640 });
    expect(geoCanvasSize(2)).toEqual({ width: 2560, height: 1280 });
  });

  it('asks only for the columns a satellite can see', () => {
    // Level 2: five columns of 72° from 180°W. East (75°W) reaches 157°W..7°E: columns 0, 1, 2.
    expect(geoTiles(2, east.longitude).map((tile) => tile.col).filter((col, i, all) => all.indexOf(col) === i)).toEqual([0, 1, 2]);
    // West (137°W) reaches across the date line to 141°E: columns 0, 1 and 4.
    expect(geoTiles(2, west.longitude).map((tile) => tile.col).filter((col, i, all) => all.indexOf(col) === i)).toEqual([0, 1, 4]);
    // Three rows of 72° cover 90°N to 126°S: the last is half off the map.
    expect(new Set(geoTiles(2, east.longitude).map((tile) => tile.row))).toEqual(new Set([0, 1, 2]));
    expect(geoTiles(2, east.longitude)).toHaveLength(9);
  });

  it('needs four tiles a satellite at level 1', () => {
    expect(geoTiles(1, east.longitude)).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ]);
    expect(geoTiles(1, west.longitude).map((tile) => tile.col)).toEqual([0, 2, 0, 2]);
  });

  it('puts longitudes on the canvas from 180°W at the left', () => {
    expect(canvasX(-180, 2560)).toBe(0);
    expect(canvasX(0, 2560)).toBe(1280);
    expect(canvasX(SEAM_LONGITUDE, 2560)).toBeCloseTo(524.8, 1);
  });

  it('joins the pictures midway between the satellites', () => {
    expect(SEAM_LONGITUDE).toBeCloseTo(-106.2, 6);
    expect(SEAM_LONGITUDE - west.longitude).toBeCloseTo(east.longitude - SEAM_LONGITUDE, 9);
  });
});

describe('addresses', () => {
  it('writes a tile’s address as GIBS serves it', () => {
    expect(geoTileUrl(east.layer, '2026-11-10T14:50:00Z', 2, { row: 1, col: 1 })).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/GOES-East_ABI_GeoColor/default/2026-11-10T14:50:00Z/1km/2/1/1.png'
    );
  });

  it('asks for one day of the time domain, ending at the next ten-minute mark', () => {
    const url = geoDomainUrl(west.layer, new Date('2026-11-10T15:07:31Z'));
    expect(url).toContain('REQUEST=DescribeDomains&LAYER=GOES-West_ABI_GeoColor');
    expect(url).toContain('TIME=2026-11-09T15:10:00Z/2026-11-10T15:10:00Z');
  });
});

describe('tags', () => {
  it('round-trip, with either satellite missing', () => {
    for (const tag of [
      { level: 2, times: { west: '2026-11-10T15:00:00Z', east: '2026-11-10T14:50:00Z' } },
      { level: 1, times: { east: '2026-11-10T14:50:00Z' } },
      { level: 1, times: { west: '2026-11-10T15:00:00Z' } },
    ]) {
      expect(parseGeoTag(encodeGeoTag(tag))).toEqual(tag);
    }
    expect(encodeGeoTag({ level: 2, times: { west: 'A', east: 'B' } })).toBe('z2|west=A|east=B');
  });

  it('refuses what it did not write', () => {
    expect(() => parseGeoTag('2|west=A')).toThrow();
    expect(() => parseGeoTag('z2|north=A')).toThrow();
  });
});

const domain = (periods: string): string =>
  `<Domains><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>${periods}</Domain><Size>1</Size></DimensionDomain></Domains>`;

describe('geoColorSource.latest', () => {
  const context = (answers: Record<string, string | Error>): { assetUrl: (path: string) => string; fetchImpl: (url: string) => Promise<Response> } => ({
    assetUrl: (path) => `/${path}`,
    fetchImpl: async (url) => {
      const key = Object.keys(answers).find((layer) => url.includes(`LAYER=${layer}&`));
      const answer = key ? answers[key] : new Error('unexpected');
      if (answer instanceof Error) throw answer;
      return new Response(answer, { status: 200 });
    },
  });
  const now = new Date('2026-11-10T15:07:00Z');

  it('takes each satellite’s newest time and dates the picture by the older', async () => {
    const source = geoColorSource(
      context({
        'GOES-West_ABI_GeoColor': domain('2026-11-09T15:10:00Z/2026-11-10T15:00:00Z/PT10M'),
        // As GIBS clips a period to the asked range: a bare date for midnight, and a gap before the newest.
        'GOES-East_ABI_GeoColor': domain('2026-11-10/2026-11-10T14:30:00Z/PT10M,2026-11-10T14:50:00Z/2026-11-10T14:50:00Z/PT10M'),
      }),
      2
    );
    const latest = await source.latest(now);
    expect(latest.tag).toBe('z2|west=2026-11-10T15:00:00Z|east=2026-11-10T14:50:00Z');
    expect(latest.validTime.toISOString()).toBe('2026-11-10T14:50:00.000Z');
  });

  it('makes do with one satellite when the other cannot be reached', async () => {
    const source = geoColorSource(
      context({ 'GOES-West_ABI_GeoColor': new Error('down'), 'GOES-East_ABI_GeoColor': domain('2026-11-10T14:00:00Z/2026-11-10T14:50:00Z/PT10M') }),
      1
    );
    const latest = await source.latest(now);
    expect(latest.tag).toBe('z1|east=2026-11-10T14:50:00Z');
  });

  it('fails when neither answers, so the cached or baked picture is shown', async () => {
    const source = geoColorSource(context({ 'GOES-West_ABI_GeoColor': new Error('down'), 'GOES-East_ABI_GeoColor': new Error('down') }), 1);
    await expect(source.latest(now)).rejects.toThrow();
  });

  it('keeps a picture per level, so a phone’s is not shown on a desk', () => {
    expect(geoColorSource(context({}), 1).storeKey).not.toBe(geoColorSource(context({}), 2).storeKey);
  });
});

describe('earthNowLevel', () => {
  it('fetches the smaller picture on a touch device', () => {
    expect(earthNowLevel(true)).toBe(1);
    expect(earthNowLevel(false)).toBe(2);
  });
});
