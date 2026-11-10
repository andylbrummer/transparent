import { describe, it, expect } from 'vitest';
import OVERLAY_LAYERS, { OVERLAY_ENTRIES } from './layer';
import { overlayImagerySpec, overlaySource, overlayStatus, type OverlaySpec } from './overlay';
import { tiledProduct, type GlobeFetcher } from '../surface-imagery/imagery';

const at = (iso: string): Date => new Date(iso);
const decode = async (blob: Blob): Promise<TexImageSource> => blob as unknown as TexImageSource;
const assetUrl = (path: string): string => `/base/${path}`;

/** GIBS, answering DescribeDomains with `domain` and any image request with its own URL; tiled globes are recorded. */
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

/**
 * Each product's tile matrix set and file type as GIBS's WMTS capabilities
 * listed them on 2026-11-10. The fires are offered only as vector tiles
 * there, so they are drawn by the WMS endpoint (null).
 */
const CAPABILITIES: Record<string, { matrixSet: string; ext: string } | null> = {
  GHRSST_L4_MUR25_Sea_Ice_Concentration: { matrixSet: '2km', ext: 'png' },
  MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct: { matrixSet: '2km', ext: 'png' },
  VIIRS_NOAA20_Thermal_Anomalies_375m_All: null,
  MERRA2_Total_Aerosol_Optical_Thickness_550nm_Extinction_Monthly: { matrixSet: '2km', ext: 'png' },
  TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column: { matrixSet: '2km', ext: 'png' },
  AIRS_L3_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Monthly_Day: { matrixSet: '2km', ext: 'png' },
  OMPS_Ozone_Total_Column: { matrixSet: '2km', ext: 'png' },
  MERRA2_Total_Precipitable_Water_Vapor_Monthly: { matrixSet: '2km', ext: 'png' },
  SMAP_L4_Analyzed_Surface_Soil_Moisture: { matrixSet: '2km', ext: 'png' },
  LIS_High_Resolution_Full_Climatology_Combined_Flash_Rate_Climatology: { matrixSet: '2km', ext: 'png' },
};

const spec = (id: string): OverlaySpec => {
  const entry = OVERLAY_ENTRIES.find((e) => e.id === id);
  if (!entry) throw new Error(`no overlay ${id}`);
  return entry.spec;
};

describe('the overlay definitions', () => {
  it('are one exclusive group of Surface layers, off by default, each with a legend and units in its caption', () => {
    expect(OVERLAY_LAYERS.length).toBe(10);
    for (const layer of OVERLAY_LAYERS) {
      expect(layer.id).toMatch(/^overlay-/);
      expect(layer.section).toBe('Surface');
      expect(layer.exclusiveGroup).toBe('earth-overlays');
      expect(layer.defaultOn).toBeUndefined();
      expect(layer.legend).toBeTruthy();
      expect(layer.caption).toBeTruthy();
      expect(layer.credits.length).toBeGreaterThan(0);
    }
    expect(new Set(OVERLAY_ENTRIES.map((e) => e.spec.product)).size).toBe(10);
  });

  it('ask GIBS for a transparent PNG, so the base map shows where there is no data', () => {
    for (const entry of OVERLAY_ENTRIES) expect(overlayImagerySpec(entry.spec).format).toBe('png');
    expect(overlayImagerySpec(spec('overlay-fires')).width).toBe(4096);
    expect(overlayImagerySpec(spec('overlay-ozone')).width).toBe(2048);
  });

  it('ask for each product in the tile set and file type GIBS lists for it', () => {
    for (const entry of OVERLAY_ENTRIES) {
      const tiled = tiledProduct(overlayImagerySpec(entry.spec));
      expect(tiled && { matrixSet: tiled.matrixSet, ext: tiled.ext }, entry.spec.product).toEqual(CAPABILITIES[entry.spec.product]);
    }
  });
});

describe('overlaySource', () => {
  it('takes the day before the newest for a product whose newest day is still filling in', async () => {
    const { globes, fetchImpl, fetchGlobe } = gibs('2022-08-10/2026-07-10/P1D,2026-07-17/2026-11-02/P1D');
    const source = overlaySource(spec('overlay-ozone'), 'overlay-ozone', assetUrl, decode, fetchImpl, fetchGlobe);
    const latest = await source.latest(at('2026-11-10T05:00:00Z'));
    expect(latest).toEqual({ tag: '2026-11-01', validTime: at('2026-11-01T00:00:00Z') });
    await source.download(latest.tag);
    expect(globes).toEqual([[{ layer: 'OMPS_Ozone_Total_Column', matrixSet: '2km', ext: 'png' }, '2026-11-01', 2048, 'image/png']]);
  });

  it('draws the fires through WMS as a transparent PNG: GIBS tiles them only as vectors', async () => {
    const { requests, globes, fetchImpl, fetchGlobe } = gibs('2020-01-01/2026-11-09/P1D');
    const source = overlaySource(spec('overlay-fires'), 'overlay-fires', assetUrl, decode, fetchImpl, fetchGlobe);
    await source.download('2026-11-08');
    expect(globes).toHaveLength(0);
    const image = new URL(requests[0]).searchParams;
    expect([image.get('LAYERS'), image.get('TIME'), image.get('FORMAT'), image.get('TRANSPARENT'), image.get('WIDTH')]).toEqual([
      'VIIRS_NOAA20_Thermal_Anomalies_375m_All',
      '2026-11-08',
      'image/png',
      'true',
      '4096',
    ]);
  });

  it('steps over a gap in the domain rather than naming a day the product lacks', async () => {
    const { fetchImpl } = gibs('2022-08-10/2026-07-10/P1D,2026-07-17/2026-11-02/P1D');
    const source = overlaySource(spec('overlay-ozone'), 'overlay-ozone', assetUrl, decode, fetchImpl);
    // Newest at the pinned time is 17 July; the day before it is missing; the 10th is the last before the gap.
    expect((await source.latest(at('2026-07-17T12:00:00Z'))).tag).toBe('2026-07-10');
  });

  it('follows a pinned clock back through the archive', async () => {
    const { fetchImpl } = gibs('2012-01-26/2026-11-02/P1D');
    const source = overlaySource(spec('overlay-ozone'), 'overlay-ozone', assetUrl, decode, fetchImpl);
    expect((await source.latest(at('2019-10-05T12:00:00Z'))).tag).toBe('2019-10-04');
  });

  it('names the newest month of a monthly mean', async () => {
    const { globes, fetchImpl, fetchGlobe } = gibs('1980-01-01/2026-08-01/P1M');
    const source = overlaySource(spec('overlay-aerosol'), 'overlay-aerosol', assetUrl, decode, fetchImpl, fetchGlobe);
    const latest = await source.latest(at('2026-11-10T05:00:00Z'));
    expect(latest.tag).toBe('2026-08-01');
    await source.download(latest.tag);
    expect(globes[0][1]).toBe('2026-08-01');
  });

  it('asks for the climatology without a date, and has a baked copy of it', async () => {
    const { requests, globes, fetchImpl, fetchGlobe } = gibs('');
    const source = overlaySource(spec('overlay-lightning'), 'overlay-lightning', assetUrl, decode, fetchImpl, fetchGlobe);
    const latest = await source.latest(at('2026-11-10T05:00:00Z'));
    await source.download(latest.tag);
    expect(requests).toHaveLength(0);
    expect(globes[0][1]).toBeNull();
    await source.snapshot();
    expect(requests[0]).toBe('/base/geo/overlay-lightning.png');
  });

  it('has no baked copy of a dated product: an old day must not pass for today', async () => {
    const { fetchImpl } = gibs('2020-01-01/2026-11-09/P1D');
    const source = overlaySource(spec('overlay-fires'), 'overlay-fires', assetUrl, decode, fetchImpl);
    await expect(source.snapshot()).rejects.toThrow();
  });
});

describe('overlayStatus', () => {
  it('passes a daily product’s chip through', () => {
    expect(overlayStatus('live · 9 Nov 2026', 'live', 'daily')).toEqual({ text: 'live · 9 Nov 2026', tone: 'live' });
    expect(overlayStatus('offline · cached 9 Nov 2026', 'stale', 'daily')).toEqual({ text: 'offline · cached 9 Nov 2026', tone: 'stale' });
  });

  it('names a monthly mean by its month and never calls it live', () => {
    expect(overlayStatus('live · 1 Aug 2026', 'live', 'monthly')).toEqual({ text: 'mean of Aug 2026', tone: 'info' });
    expect(overlayStatus('latest · 1 Aug 2026', 'stale', 'monthly')).toEqual({ text: 'mean of Aug 2026', tone: 'info' });
    expect(overlayStatus('offline · cached 1 Aug 2026', 'stale', 'monthly')).toEqual({ text: 'offline · cached Aug 2026', tone: 'stale' });
    expect(overlayStatus('live · 11 Aug 2026', 'live', 'monthly').text).toBe('mean of 11 Aug 2026');
  });

  it('says nothing for the climatology unless it is the baked copy', () => {
    expect(overlayStatus('live · 1 Jan 1970', 'live', 'fixed')).toEqual({ text: null, tone: 'info' });
    expect(overlayStatus('offline · snapshot 1 Jan 1970', 'stale', 'fixed')).toEqual({ text: 'offline · low-resolution copy', tone: 'stale' });
  });
});
