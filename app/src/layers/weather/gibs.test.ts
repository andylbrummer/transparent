import { describe, it, expect } from 'vitest';
import { GIBS_WMS, gibsDomainUrl, gibsTime, latestCompleteDay, latestInDomain, parseTimeDomain, wmsGlobeUrl } from './gibs';

/** GIBS's DescribeDomains answer for IMERG_Precipitation_Rate_30min, 9 Nov 2026 (first period shortened). */
const IMERG_DOMAINS =
  "<Domains xmlns:ows='http://www.opengis.net/ows/1.1'><SpaceDomain><BoundingBox maxx='180' crs='urn:ogc:def:crs:OGC:2:84' minx='-180' miny='-90' maxy='90'/></SpaceDomain>" +
  '<DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>2025-09-13T20:30:00Z/2026-01-22T00:00:00Z/PT30M,' +
  '2026-01-22T01:00:00Z/2026-02-10T00:00:00Z/PT30M,2026-02-10T01:00:00Z/2026-11-09T18:30:00Z/PT30M</Domain><Size>3</Size></DimensionDomain></Domains>';

const at = (iso: string): Date => new Date(iso);

describe('wmsGlobeUrl', () => {
  it('asks for the whole globe, north up, in the size and time given', () => {
    const url = new URL(wmsGlobeUrl(GIBS_WMS, 'IMERG_Precipitation_Rate_30min', { width: 2048, height: 1024, format: 'png', time: '2026-11-09T18:30:00Z' }));
    expect(url.origin + url.pathname).toBe(GIBS_WMS);
    const q = url.searchParams;
    expect(q.get('LAYERS')).toBe('IMERG_Precipitation_Rate_30min');
    // WMS 1.3.0 with EPSG:4326 orders the box latitude first.
    expect(q.get('BBOX')).toBe('-90,-180,90,180');
    expect(q.get('CRS')).toBe('EPSG:4326');
    expect([q.get('WIDTH'), q.get('HEIGHT')]).toEqual(['2048', '1024']);
    expect(q.get('FORMAT')).toBe('image/png');
    expect(q.get('TRANSPARENT')).toBe('true');
    expect(q.get('TIME')).toBe('2026-11-09T18:30:00Z');
  });

  it('leaves the time out for a product with only one, and transparency out of a JPEG', () => {
    const q = new URL(wmsGlobeUrl(GIBS_WMS, 'BlueMarble_ShadedRelief_Bathymetry', { width: 4096, height: 2048, format: 'jpeg' })).searchParams;
    expect(q.has('TIME')).toBe(false);
    expect(q.has('TRANSPARENT')).toBe(false);
  });

  it('builds the DescribeDomains request for a layer', () => {
    const q = new URL(gibsDomainUrl('VIIRS_Black_Marble')).searchParams;
    expect([q.get('SERVICE'), q.get('REQUEST'), q.get('LAYER')]).toEqual(['WMTS', 'DescribeDomains', 'VIIRS_Black_Marble']);
  });
});

describe('parseTimeDomain', () => {
  it('reads every period with its step', () => {
    const periods = parseTimeDomain(IMERG_DOMAINS);
    expect(periods).toHaveLength(3);
    expect(periods[2].start.toISOString()).toBe('2026-02-10T01:00:00.000Z');
    expect(periods[2].end.toISOString()).toBe('2026-11-09T18:30:00.000Z');
    expect(periods[2].stepMs).toBe(30 * 60_000);
    expect(periods[2].daily).toBe(false);
  });

  it('knows a daily product from a timed one, and calendar steps from fixed ones', () => {
    const [days, sixteen, years] = parseTimeDomain('<Domain>2024-07-03/2026-11-08/P1D,2026-01-01/2026-10-16/P16D,2012-01-01/2016-01-01/P1Y</Domain>');
    expect(days.daily).toBe(true);
    expect(days.stepMs).toBe(86_400_000);
    expect(sixteen.stepMs).toBe(16 * 86_400_000);
    expect([years.stepMs, years.stepMonths]).toEqual([0, 12]);
  });

  it('gives no periods for a product without a time domain', () => {
    expect(parseTimeDomain("<Domains xmlns:ows='http://www.opengis.net/ows/1.1'/>")).toEqual([]);
  });

  it('refuses a period it cannot read', () => {
    expect(() => parseTimeDomain('<Domain>2026-01-01/2026-02-01/sometimes</Domain>')).toThrow(/unreadable period/);
  });
});

describe('latestInDomain', () => {
  const periods = parseTimeDomain(IMERG_DOMAINS);

  it('stops at the end of the domain when asked for now', () => {
    expect(latestInDomain(periods, at('2026-11-10T00:20:00Z'))?.time.toISOString()).toBe('2026-11-09T18:30:00.000Z');
  });

  it('floors a past instant to the step', () => {
    expect(latestInDomain(periods, at('2026-06-01T12:47:00Z'))?.time.toISOString()).toBe('2026-06-01T12:30:00.000Z');
  });

  it('falls back across a gap in the record to the last time before it', () => {
    // Nothing between 22 Jan 00:00 and 01:00.
    expect(latestInDomain(periods, at('2026-01-22T00:45:00Z'))?.time.toISOString()).toBe('2026-01-22T00:00:00.000Z');
  });

  it('has nothing before the record begins', () => {
    expect(latestInDomain(periods, at('2020-01-01T00:00:00Z'))).toBeNull();
  });

  it('steps a 16-day composite from the start of its year', () => {
    const ndvi = parseTimeDomain('<Domain>2025-01-01/2025-12-19/P16D,2026-01-01/2026-10-16/P16D</Domain>');
    expect(latestInDomain(ndvi, at('2026-02-20T00:00:00Z'))?.time.toISOString().slice(0, 10)).toBe('2026-02-18');
    expect(latestInDomain(ndvi, at('2026-11-10T00:00:00Z'))).toEqual({ time: at('2026-10-16T00:00:00Z'), daily: true });
  });

  it('steps yearly and monthly products by the calendar', () => {
    const yearly = parseTimeDomain('<Domain>2012-01-01/2016-01-01/P1Y</Domain>');
    expect(latestInDomain(yearly, at('2014-06-01T00:00:00Z'))?.time.toISOString().slice(0, 10)).toBe('2014-01-01');
    const monthly = parseTimeDomain('<Domain>2024-01-01/2026-09-01/P1M</Domain>');
    expect(latestInDomain(monthly, at('2025-03-30T00:00:00Z'))?.time.toISOString().slice(0, 10)).toBe('2025-03-01');
  });
});

describe('gibsTime', () => {
  it('writes a day as a date and a time to the second', () => {
    expect(gibsTime(at('2026-11-08T00:00:00Z'), true)).toBe('2026-11-08');
    expect(gibsTime(at('2026-11-09T18:30:00Z'), false)).toBe('2026-11-09T18:30:00Z');
  });
});

describe('latestCompleteDay', () => {
  it('is the day before yesterday until the last passes over the Pacific are in', () => {
    // Checked against GIBS at this instant: the mosaic for the 9th still
    // lacked everything west of 150°W; the 8th was whole.
    expect(latestCompleteDay(at('2026-11-10T00:20:00Z')).toISOString()).toBe('2026-11-08T00:00:00.000Z');
  });

  it('is yesterday from 05:00 UTC', () => {
    expect(latestCompleteDay(at('2026-11-10T04:59:00Z')).toISOString().slice(0, 10)).toBe('2026-11-08');
    expect(latestCompleteDay(at('2026-11-10T05:00:00Z')).toISOString().slice(0, 10)).toBe('2026-11-09');
  });
});
