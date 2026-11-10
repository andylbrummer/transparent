import { describe, it, expect } from 'vitest';
import SURFACE_LAYERS, { IMAGERY_SPECS } from './layer';
import { imagerySource, isDated, tiledProduct, undatedStatus, type GlobeFetcher, type ImagerySpec } from './imagery';

const at = (iso: string): Date => new Date(iso);
const decode = async (blob: Blob): Promise<TexImageSource> => blob as unknown as TexImageSource;
const assetUrl = (path: string): string => `/base/${path}`;

const TRUE_COLOUR: ImagerySpec = { product: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', matrixSet: '250m', format: 'jpeg', width: 4096, time: 'complete-day' };
const SST: ImagerySpec = { product: 'GHRSST_L4_MUR_Sea_Surface_Temperature', matrixSet: '1km', format: 'png', width: 2048, time: 'latest' };
const NIGHT: ImagerySpec = {
  product: 'VIIRS_Black_Marble',
  matrixSet: 'wms',
  format: 'jpeg',
  width: 4096,
  time: '2016-01-01',
  bakedAsset: 'weather/night-lights.jpg',
};
const RELIEF: ImagerySpec = { product: 'BlueMarble_ShadedRelief_Bathymetry', matrixSet: '500m', format: 'jpeg', width: 4096, time: null };

/**
 * Each product's tile matrix set and file type as GIBS's WMTS capabilities
 * listed them on 2026-11-10 (wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml).
 * A tile asked for in the wrong set or type is a 400, not a picture. The
 * night lights are tiled only as PNG, 5.3 MB for the globe against a 0.4 MB
 * JPEG from WMS, so they are drawn by WMS (null).
 */
const CAPABILITIES: Record<string, { matrixSet: string; ext: string } | null> = {
  VIIRS_NOAA20_CorrectedReflectance_TrueColor: { matrixSet: '250m', ext: 'jpeg' },
  VIIRS_Black_Marble: null,
  BlueMarble_ShadedRelief_Bathymetry: { matrixSet: '500m', ext: 'jpeg' },
  GHRSST_L4_MUR_Sea_Surface_Temperature: { matrixSet: '1km', ext: 'png' },
  GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies: { matrixSet: '1km', ext: 'png' },
  MODIS_Terra_L3_NDVI_16Day: { matrixSet: '250m', ext: 'png' },
  GPW_Population_Density_2020: { matrixSet: '1km', ext: 'png' },
};

/** GIBS, answering DescribeDomains with `domain`; globes are recorded, not drawn. */
function gibs(domain: string) {
  const requests: string[] = [];
  const globes: Parameters<GlobeFetcher>[] = [];
  const fetchImpl = async (url: string): Promise<Response> => {
    requests.push(url);
    if (url.includes('DescribeDomains')) return new Response(`<Domains><DimensionDomain><Domain>${domain}</Domain></DimensionDomain></Domains>`);
    if (url.startsWith('/base/')) return new Response('baked');
    return new Response('image');
  };
  const fetchGlobe: GlobeFetcher = async (...args) => {
    globes.push(args);
    return new Blob(['globe']);
  };
  return { requests, globes, fetchImpl, fetchGlobe };
}

describe('imagerySource', () => {
  it('asks for the newest whole day of a daily mosaic, not the day still being flown', async () => {
    const { globes, fetchImpl, fetchGlobe } = gibs('2022-01-14/2026-11-09/P1D');
    const source = imagerySource(TRUE_COLOUR, 'surface-true-colour', assetUrl, decode, fetchImpl, fetchGlobe);
    // GIBS already lists the 9th, but at 00:20 on the 10th its Pacific passes are not in.
    const latest = await source.latest(at('2026-11-10T00:20:00Z'));
    expect(latest).toEqual({ tag: '2026-11-08', validTime: at('2026-11-08T00:00:00Z') });
    await source.download(latest.tag);
    expect(globes).toEqual([[{ layer: TRUE_COLOUR.product, matrixSet: '250m', ext: 'jpeg' }, '2026-11-08', 4096, 'image/jpeg']]);
  });

  it('steps back to the last day the product has when the whole day wanted is missing', async () => {
    const { fetchImpl } = gibs('2026-04-30/2026-07-10/P1D,2026-07-16/2026-11-02/P1D');
    const source = imagerySource(TRUE_COLOUR, 'x', assetUrl, decode, fetchImpl);
    expect((await source.latest(at('2026-11-10T12:00:00Z'))).tag).toBe('2026-11-02');
    // Inside a gap in the record.
    expect((await source.latest(at('2026-07-14T12:00:00Z'))).tag).toBe('2026-07-10');
  });

  it('asks for the newest date of an analysis that has no swath to wait for', async () => {
    const { fetchImpl } = gibs('2024-07-03/2026-11-08/P1D');
    const source = imagerySource(SST, 'surface-sst', assetUrl, decode, fetchImpl);
    expect((await source.latest(at('2026-11-10T00:20:00Z'))).tag).toBe('2026-11-08');
    expect((await source.latest(at('2025-01-15T09:00:00Z'))).tag).toBe('2025-01-15');
  });

  it('asks for a fixed date without consulting the domain', async () => {
    const { requests, globes, fetchImpl, fetchGlobe } = gibs('unused');
    const source = imagerySource(NIGHT, 'surface-night-lights', assetUrl, decode, fetchImpl, fetchGlobe);
    const latest = await source.latest(at('2026-11-10T00:20:00Z'));
    expect(latest.tag).toBe('2016-01-01');
    await source.download(latest.tag);
    expect(globes).toHaveLength(0);
    expect(requests).toHaveLength(1);
    const image = new URL(requests[0]).searchParams;
    expect([image.get('LAYERS'), image.get('TIME'), image.get('FORMAT'), image.get('WIDTH')]).toEqual([NIGHT.product, '2016-01-01', 'image/jpeg', '4096']);
  });

  it('sends no time for a product that has only one', async () => {
    const { globes, fetchImpl, fetchGlobe } = gibs('unused');
    const source = imagerySource(RELIEF, 'surface-relief', assetUrl, decode, fetchImpl, fetchGlobe);
    await source.download((await source.latest(at('2026-11-10T00:20:00Z'))).tag);
    expect(globes[0][1]).toBeNull();
  });

  it('keeps a data product lossless, so its colours still match its legend', async () => {
    const { globes, fetchImpl, fetchGlobe } = gibs('2024-07-03/2026-11-08/P1D');
    const source = imagerySource(SST, 'surface-sst', assetUrl, decode, fetchImpl, fetchGlobe);
    await source.download('2026-11-08');
    expect(globes[0].slice(1)).toEqual(['2026-11-08', 2048, 'image/png']);
  });

  it('falls back to a baked copy only where there is one', async () => {
    const { requests, fetchImpl } = gibs('unused');
    const night = await imagerySource(NIGHT, 'n', assetUrl, decode, fetchImpl).snapshot();
    expect(await (night.value as unknown as Blob).text()).toBe('baked');
    expect(requests).toEqual(['/base/weather/night-lights.jpg']);
    await expect(imagerySource(RELIEF, 'r', assetUrl, decode, fetchImpl).snapshot()).rejects.toThrow('no baked copy');
  });

  it('fails for a date before the product began', async () => {
    const { fetchImpl } = gibs('2024-07-03/2026-11-08/P1D');
    await expect(imagerySource(SST, 's', assetUrl, decode, fetchImpl).latest(at('2010-01-01T00:00:00Z'))).rejects.toThrow('nothing at or before');
  });
});

describe('undatedStatus', () => {
  it('shows no chip for the real thing and says so when it is a stand-in', () => {
    expect(undatedStatus('live · 1 Jan 1970')).toEqual({ text: null, tone: 'info' });
    expect(undatedStatus('latest · 1 Jan 1970')).toEqual({ text: null, tone: 'info' });
    expect(undatedStatus('offline · cached 1 Jan 1970')).toEqual({ text: 'offline · cached', tone: 'stale' });
    expect(undatedStatus('offline · snapshot 1 Jan 1970')).toEqual({ text: 'offline · low-resolution copy', tone: 'stale' });
  });
});

describe('the surface layers', () => {
  it('are one exclusive group in the Surface section, all off by default', () => {
    expect(SURFACE_LAYERS.length).toBeGreaterThanOrEqual(4);
    for (const layer of SURFACE_LAYERS) {
      expect(layer.section).toBe('Surface');
      expect(layer.exclusiveGroup).toBe('surface-imagery');
      expect(layer.defaultOn).toBeUndefined();
      expect(layer.id).toMatch(/^surface-[a-z-]+$/);
      expect(layer.credits.length).toBeGreaterThan(0);
    }
    expect(new Set(SURFACE_LAYERS.map((layer) => layer.id)).size).toBe(SURFACE_LAYERS.length);
  });

  it('ask for each product in the tile set and file type GIBS lists for it', () => {
    const specs = Object.values(IMAGERY_SPECS);
    expect(specs).toHaveLength(SURFACE_LAYERS.length);
    for (const spec of specs) {
      const tiled = tiledProduct(spec);
      expect(tiled && { matrixSet: tiled.matrixSet, ext: tiled.ext }, spec.product).toEqual(CAPABILITIES[spec.product]);
    }
  });

  it('knows a dated product from a fixed one', () => {
    expect([TRUE_COLOUR, SST, NIGHT, RELIEF].map(isDated)).toEqual([true, true, false, false]);
  });
});
