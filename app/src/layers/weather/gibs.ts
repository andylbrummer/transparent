/**
 * NASA GIBS (Global Imagery Browse Services) as the app uses it: whole-globe
 * equirectangular images from the WMS endpoint, and each product's time
 * domain from the WMTS endpoint, so a request names a time that exists.
 *
 * GIBS answers a time outside a product's domain with an empty image, not
 * an error - asking blind for "now" would draw nothing and call it live.
 */

export const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
export const GIBS_WMTS = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface WmsImageOptions {
  readonly width: number;
  readonly height: number;
  readonly format: 'jpeg' | 'png';
  /** As the product's domain writes it: a date, or a date-time ending in Z. */
  readonly time?: string;
}

/** A whole-globe image: longitude −180..180 left to right, north up. */
export function wmsGlobeUrl(endpoint: string, layer: string, options: WmsImageOptions): string {
  return (
    `${endpoint}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layer}&STYLES=&CRS=EPSG:4326` +
    `&BBOX=-90,-180,90,180&WIDTH=${options.width}&HEIGHT=${options.height}&FORMAT=image/${options.format}` +
    (options.format === 'png' ? '&TRANSPARENT=true' : '') +
    (options.time ? `&TIME=${options.time}` : '')
  );
}

export function gibsDomainUrl(layer: string): string {
  return `${GIBS_WMTS}?SERVICE=WMTS&VERSION=1.0.0&REQUEST=DescribeDomains&LAYER=${layer}`;
}

/** One run of evenly spaced times: start, end and the step between them. */
export interface TimePeriod {
  readonly start: Date;
  readonly end: Date;
  /** Fixed step in milliseconds, or 0 for a calendar step. */
  readonly stepMs: number;
  /** Calendar step in months (P1M = 1, P1Y = 12), or 0. */
  readonly stepMonths: number;
  /** True when the product is dated by day, without a time of day. */
  readonly daily: boolean;
}

function parseStep(duration: string): { stepMs: number; stepMonths: number } {
  const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(duration);
  if (!match) throw new Error(`unreadable period "${duration}"`);
  const [years, months, days, hours, minutes, seconds] = match.slice(1).map((v) => Number(v ?? 0));
  return {
    stepMs: days * DAY_MS + hours * HOUR_MS + minutes * 60_000 + seconds * 1000,
    stepMonths: years * 12 + months,
  };
}

/** The periods of a DescribeDomains answer: `<Domain>start/end/period,…</Domain>`. */
export function parseTimeDomain(xml: string): TimePeriod[] {
  const domain = /<Domain>([^<]+)<\/Domain>/.exec(xml);
  if (!domain) return [];
  return domain[1].split(',').map((text) => {
    const [start, end, step] = text.trim().split('/');
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || !step) throw new Error(`unreadable time period "${text}"`);
    return { start: new Date(startMs), end: new Date(endMs), ...parseStep(step), daily: !start.includes('T') };
  });
}

function addMonths(date: Date, months: number): Date {
  const moved = new Date(date);
  moved.setUTCMonth(moved.getUTCMonth() + months);
  return moved;
}

/** The last time in `period` at or before `at`, or null when the period starts later. */
function lastInPeriod(period: TimePeriod, at: Date): Date | null {
  if (at < period.start) return null;
  const limit = Math.min(at.getTime(), period.end.getTime());
  if (period.stepMonths > 0) {
    let time = period.start;
    for (let next = addMonths(time, period.stepMonths); next.getTime() <= limit; next = addMonths(next, period.stepMonths)) {
      time = next;
    }
    return time;
  }
  if (period.stepMs <= 0) return period.start;
  const steps = Math.floor((limit - period.start.getTime()) / period.stepMs);
  return new Date(period.start.getTime() + steps * period.stepMs);
}

/** The newest time the product has at or before `at`. */
export function latestInDomain(periods: readonly TimePeriod[], at: Date): { time: Date; daily: boolean } | null {
  let best: { time: Date; daily: boolean } | null = null;
  for (const period of periods) {
    const time = lastInPeriod(period, at);
    if (time && (!best || time > best.time)) best = { time, daily: period.daily };
  }
  return best;
}

/** A time as GIBS's TIME parameter wants it. */
export function gibsTime(time: Date, daily: boolean): string {
  const iso = time.toISOString();
  return daily ? iso.slice(0, 10) : `${iso.slice(0, 19)}Z`;
}

/**
 * The newest UTC day whose daily mosaic from a sun-synchronous afternoon
 * satellite is whole. A day's daylight passes start at the date line
 * (~01:30 UTC) and work westward right round the planet, finishing at the
 * date line again ~01:30 UTC the next day; processing adds about three hours.
 * Asked earlier, the day's image has a black gap over the Pacific.
 */
export function latestCompleteDay(now: Date): Date {
  const complete = new Date(now.getTime() - 29 * HOUR_MS);
  return new Date(Date.UTC(complete.getUTCFullYear(), complete.getUTCMonth(), complete.getUTCDate()));
}
