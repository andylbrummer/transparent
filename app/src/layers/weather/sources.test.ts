import { describe, it, expect } from 'vitest';
import { GFS_NI, GFS_NJ } from './gfs';
import {
  CLOUD_LAYER,
  cloudSource,
  GFS_FIELDS,
  gfsFieldSource,
  nearestTime,
  parseWmsTimes,
  PRECIPITATION_TILES,
  precipitationSource,
  type WeatherSnapshot,
} from './sources';

const at = (iso: string): Date => new Date(iso);

/** The longwave layer as nowCOAST's capabilities listed it on 10 Nov 2026, between its neighbours. */
const CAPABILITIES = `
  <Layer queryable="1" opaque="0">
    <Name>global_longwave_imagery_mosaic</Name>
    <Title>Global Satellite Longwave Imagery</Title>
    <EX_GeographicBoundingBox><westBoundLongitude>-179.99994344357404</westBoundLongitude><southBoundLatitude>-72.74472336303444</southBoundLatitude></EX_GeographicBoundingBox>
    <Dimension name="time" default="2026-11-09T23:00:00Z" units="ISO8601" nearestValue="1">2026-11-09T19:00:00.000Z,2026-11-09T20:00:00.000Z,2026-11-09T21:00:00.000Z,2026-11-09T22:00:00.000Z,2026-11-09T23:00:00.000Z</Dimension>
  </Layer>
  <Layer queryable="1" opaque="0">
    <Name>global_shortwave_imagery_mosaic</Name>
    <Dimension name="time" default="2026-11-09T22:00:00Z" units="ISO8601">2026-11-09T22:00:00.000Z</Dimension>
  </Layer>`;

const SNAPSHOT: WeatherSnapshot = {
  generated: '2026-11-10T00:30:20Z',
  clouds: { file: 'clouds.jpg', validTime: '2026-11-09T23:00:00Z' },
  precipitation: { file: 'precipitation.png', validTime: '2026-11-09T18:30:00Z' },
  gfs: {
    validTime: '2026-11-10T00:00:00Z',
    grid: { ni: 360, nj: 181, latFirst: 90, latStep: -1, lonFirst: 0, lonStep: 1 },
    'wind-10m': { file: 'wind-10m.bin', scale: 0.21 },
    'wind-250hpa': { file: 'wind-250hpa.bin', scale: 0.81 },
    temperature: { file: 'temperature.bin', scale: 0.75 },
  },
  nightLights: { file: 'night-lights.jpg', year: 2016 },
};

/** The app with no network: only its own baked files answer. */
function offlineApp(files: Record<string, BodyInit>) {
  const requests: string[] = [];
  return {
    requests,
    assetUrl: (path: string) => `/base/${path}`,
    fetchImpl: async (url: string): Promise<Response> => {
      requests.push(url);
      if (url === '/base/weather/snapshot.json') return new Response(JSON.stringify(SNAPSHOT));
      const file = url.replace('/base/weather/', '');
      if (url.startsWith('/base/') && file in files) return new Response(files[file]);
      throw new TypeError('Failed to fetch');
    },
  };
}

describe('parseWmsTimes', () => {
  it('reads the times of the layer asked for, not its neighbour', () => {
    const times = parseWmsTimes(CAPABILITIES, CLOUD_LAYER);
    expect(times.map((t) => t.toISOString())).toEqual([
      '2026-11-09T19:00:00.000Z',
      '2026-11-09T20:00:00.000Z',
      '2026-11-09T21:00:00.000Z',
      '2026-11-09T22:00:00.000Z',
      '2026-11-09T23:00:00.000Z',
    ]);
    expect(parseWmsTimes(CAPABILITIES, 'global_shortwave_imagery_mosaic')).toHaveLength(1);
  });

  it('fails when the layer or its times are missing', () => {
    expect(() => parseWmsTimes(CAPABILITIES, 'no_such_layer')).toThrow('no layer');
    expect(() => parseWmsTimes('<Layer><Name>bare</Name></Layer><Layer><Name>other</Name></Layer>', 'bare')).toThrow('lists no times');
  });
});

describe('nearestTime', () => {
  const times = parseWmsTimes(CAPABILITIES, CLOUD_LAYER);

  it('picks the newest when the app is at the present', () => {
    expect(nearestTime(times, at('2026-11-10T00:20:00Z')).toISOString()).toBe('2026-11-09T23:00:00.000Z');
  });

  it('picks the hour nearest a time inside the listed span', () => {
    expect(nearestTime(times, at('2026-11-09T20:40:00Z')).toISOString()).toBe('2026-11-09T21:00:00.000Z');
    expect(nearestTime(times, at('2026-11-09T18:20:00Z')).toISOString()).toBe('2026-11-09T19:00:00.000Z');
  });

  it('picks the newest for a time long before anything listed: there is no archive to be near', () => {
    expect(nearestTime(times, at('2026-06-21T12:00:00Z')).toISOString()).toBe('2026-11-09T23:00:00.000Z');
  });
});

describe('cloudSource', () => {
  it('asks nowCOAST for its times and names the image to fetch by time', async () => {
    const requests: string[] = [];
    const source = cloudSource({
      assetUrl: (path) => path,
      fetchImpl: async (url) => {
        requests.push(url);
        return new Response(url.includes('GetCapabilities') ? CAPABILITIES : 'jpeg bytes');
      },
    });
    const latest = await source.latest(at('2026-11-10T00:20:00Z'));
    expect(latest).toEqual({ tag: '2026-11-09T23:00:00Z', validTime: at('2026-11-09T23:00:00Z') });
    expect(await (await source.download(latest.tag)).text()).toBe('jpeg bytes');
    const image = new URL(requests[1]).searchParams;
    expect(requests[1].startsWith('https://nowcoast.noaa.gov/geoserver/satellite/wms?')).toBe(true);
    expect([image.get('LAYERS'), image.get('TIME'), image.get('FORMAT'), image.get('WIDTH')]).toEqual([
      CLOUD_LAYER,
      '2026-11-09T23:00:00Z',
      'image/jpeg',
      '2048',
    ]);
  });
});

describe('precipitationSource', () => {
  const domain = '<Domains><DimensionDomain><Domain>2026-02-10T01:00:00Z/2026-11-09T18:30:00Z/PT30M</Domain></DimensionDomain></Domains>';
  const source = precipitationSource({ assetUrl: (path) => path, fetchImpl: async () => new Response(domain) });

  it('takes the newest half hour GIBS has', async () => {
    expect((await source.latest(at('2026-11-10T00:20:00Z'))).tag).toBe('2026-11-09T18:30:00Z');
  });

  it('takes the half hour of a pinned past time: the archive is served', async () => {
    const latest = await source.latest(at('2026-07-04T15:44:00Z'));
    expect(latest.tag).toBe('2026-07-04T15:30:00Z');
    expect(latest.validTime).toEqual(at('2026-07-04T15:30:00Z'));
  });

  it('fails for a time before the record', async () => {
    await expect(source.latest(at('2020-01-01T00:00:00Z'))).rejects.toThrow('nothing at or before');
  });

  it('asks for tiles in the set and file type GIBS lists for the product', () => {
    expect(PRECIPITATION_TILES).toEqual({ layer: 'IMERG_Precipitation_Rate_30min', matrixSet: '2km', ext: 'png' });
  });
});

describe('gfsFieldSource snapshots', () => {
  const size = GFS_NI * GFS_NJ;

  it('reads the baked wind as u then v in m/s, with the snapshot valid time', async () => {
    const raw = new Int8Array(2 * size);
    raw[5] = 100;
    raw[size + 5] = -50;
    const app = offlineApp({ 'wind-250hpa.bin': raw.buffer });
    const { value, validTime } = await gfsFieldSource(app, 'wind-250hpa').snapshot();
    expect(value).toHaveLength(2);
    expect(value[0][5]).toBeCloseTo(81, 4);
    expect(value[1][5]).toBeCloseTo(-40.5, 4);
    expect(validTime).toEqual(at('2026-11-10T00:00:00Z'));
    expect(app.requests).toEqual(['/base/weather/snapshot.json', '/base/weather/wind-250hpa.bin']);
  });

  it('reads the baked temperature in °C as baked', async () => {
    const raw = new Int8Array(size);
    raw[0] = -40;
    const app = offlineApp({ 'temperature.bin': raw.buffer });
    const { value } = await gfsFieldSource(app, 'temperature').snapshot();
    expect(value[0][0]).toBeCloseTo(-30, 4);
  });

  it('fails when the baked file is missing', async () => {
    await expect(gfsFieldSource(offlineApp({}), 'wind-10m').snapshot()).rejects.toThrow('Failed to fetch');
  });

  it('asks the inventory for u before v at each level, the order the snapshot holds', () => {
    expect(GFS_FIELDS['wind-10m']).toEqual(['UGRD:10 m above ground', 'VGRD:10 m above ground']);
    expect(GFS_FIELDS['wind-250hpa']).toEqual(['UGRD:250 mb', 'VGRD:250 mb']);
    expect(GFS_FIELDS.temperature).toEqual(['TMP:2 m above ground']);
  });
});
