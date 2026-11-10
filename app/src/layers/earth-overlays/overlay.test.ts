import { describe, it, expect } from 'vitest';
import OVERLAY_LAYERS, { OVERLAY_ENTRIES } from './layer';
import { overlayImagerySpec, overlaySource, overlayStatus, type OverlaySpec } from './overlay';

const at = (iso: string): Date => new Date(iso);
const decode = async (blob: Blob): Promise<TexImageSource> => blob as unknown as TexImageSource;
const assetUrl = (path: string): string => `/base/${path}`;

/** GIBS, answering DescribeDomains with `domain` and any image request with its own URL. */
function gibs(domain: string) {
  const requests: string[] = [];
  const fetchImpl = async (url: string): Promise<Response> => {
    requests.push(url);
    if (url.includes('DescribeDomains')) return new Response(`<Domains><DimensionDomain><Domain>${domain}</Domain></DimensionDomain></Domains>`);
    if (url.startsWith('/base/')) return new Response('baked');
    return new Response('image');
  };
  return { requests, fetchImpl };
}

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
});

describe('overlaySource', () => {
  it('takes the day before the newest for a product whose newest day is still filling in', async () => {
    const { requests, fetchImpl } = gibs('2022-08-10/2026-07-10/P1D,2026-07-17/2026-11-02/P1D');
    const source = overlaySource(spec('overlay-ozone'), 'overlay-ozone', assetUrl, decode, fetchImpl);
    const latest = await source.latest(at('2026-11-10T05:00:00Z'));
    expect(latest).toEqual({ tag: '2026-11-01', validTime: at('2026-11-01T00:00:00Z') });
    await source.download(latest.tag);
    const image = new URL(requests[1]).searchParams;
    expect([image.get('LAYERS'), image.get('TIME'), image.get('FORMAT'), image.get('TRANSPARENT')]).toEqual([
      'OMPS_Ozone_Total_Column',
      '2026-11-01',
      'image/png',
      'true',
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
    const { requests, fetchImpl } = gibs('1980-01-01/2026-08-01/P1M');
    const source = overlaySource(spec('overlay-aerosol'), 'overlay-aerosol', assetUrl, decode, fetchImpl);
    const latest = await source.latest(at('2026-11-10T05:00:00Z'));
    expect(latest.tag).toBe('2026-08-01');
    await source.download(latest.tag);
    expect(new URL(requests[1]).searchParams.get('TIME')).toBe('2026-08-01');
  });

  it('asks for the climatology without a date, and has a baked copy of it', async () => {
    const { requests, fetchImpl } = gibs('');
    const source = overlaySource(spec('overlay-lightning'), 'overlay-lightning', assetUrl, decode, fetchImpl);
    const latest = await source.latest(at('2026-11-10T05:00:00Z'));
    await source.download(latest.tag);
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]).searchParams.get('TIME')).toBeNull();
    await source.snapshot();
    expect(requests[1]).toBe('/base/geo/overlay-lightning.png');
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
