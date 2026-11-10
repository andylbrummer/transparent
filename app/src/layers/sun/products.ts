/**
 * The live solar image products the Sun layers draw, and how each frame
 * sits on the sky: where the Sun's centre is in the picture, how many
 * arcseconds a pixel spans, and which way is up.
 *
 * All come from NOAA's Space Weather Prediction Center, which serves them
 * with CORS headers (the instrument teams' own sites do not). None of the
 * geometry below is taken on trust: it was measured from frames of
 * 2026-11-09/10 and is re-measured on the baked snapshot by
 * tools/pipeline/test_sun_snapshot.py -
 *
 * - coronagraphs: a plate solution against the catalogue stars visible in
 *   the frame (40 stars in LASCO C3, 22 in CCOR-1, residual under a pixel),
 *   which gives scale and roll; the Sun's centre from the limb circle the
 *   products draw (LASCO) or from the same star solution (CCOR-1, whose
 *   drawn circle sits 5 px off it).
 * - disc imagers: a fit to the limb, in July and in November, which shows
 *   SDO's browse images keep a fixed plate scale rather than a fixed disc.
 *
 * The one surprise: LASCO frames are not solar-north-up. SOHO flies with
 * its roll axis to ECLIPTIC north, so the Sun's axis leans up to 7.25°
 * either way in them through the year (6.6° on the day measured).
 */

export type ProductId = 'hmi' | 'suvi-171' | 'suvi-195' | 'suvi-304' | 'lasco-c2' | 'lasco-c3' | 'ccor1';

/** How a frame's colours become light. */
export type ProductTone =
  /** Greyscale photosphere: shown as it is inside the limb, nothing outside. */
  | 'disc'
  /** Colour on black: added as it is. */
  | 'emission'
  /**
   * LASCO's false-colour tables, which run black → blue → cyan → white (C3)
   * and black → red → orange → white (C2): one channel fills after another,
   * so the mean of the three is the brightness the table encodes.
   */
  | 'table';

export interface ProductGeometry {
  /** Sun centre as a fraction of the frame's width and height, from the top-left corner. */
  readonly centre: readonly [number, number];
  /** Frame width in pixels at the size the plate scale refers to. */
  readonly widthPx: number;
  /** Arcseconds per pixel at that size. */
  readonly arcsecPerPx: number;
  /**
   * The spacecraft's distance from the Sun over the Earth's. SOHO sits at
   * L1, 1% nearer, so everything in its frames looks 1% larger than from here.
   */
  readonly distanceFactor: number;
  /** Which pole the top of the frame points to. */
  readonly up: 'solar-north' | 'ecliptic-north';
  /** Useful data lies between these radii, in solar radii: inside is disc or occulter, outside is captions and frame. */
  readonly innerRadii: number;
  readonly outerRadii: number;
  readonly tone: ProductTone;
  /**
   * For 'table' frames: the encoded brightness of the empty sky at the edge
   * of the field (measured as the median there), taken as black.
   */
  readonly tableFloor?: number;
}

export interface Product extends ProductGeometry {
  readonly id: ProductId;
  /** Short name for chips and labels. */
  readonly name: string;
  /** Index of the last day's frames, relative to SWPC_BASE. */
  readonly indexPath: string;
  /** Baked fallback under app/public/, see tools/pipeline/generate_sun_snapshot.py. */
  readonly snapshotPath: string;
}

export const SWPC_BASE = 'https://services.swpc.noaa.gov';

const SUVI_GEOMETRY: ProductGeometry = {
  // Level-2 composites are re-centred and rotated to solar north by NOAA; 2.5″ pixels.
  centre: [0.5, 0.5],
  widthPx: 1280,
  arcsecPerPx: 2.5,
  distanceFactor: 1,
  up: 'solar-north',
  innerRadii: 0,
  // The caption strip starts 600 px (1.55 radii) below the centre.
  outerRadii: 1.5,
  tone: 'emission',
};

export const PRODUCTS: Readonly<Record<ProductId, Product>> = {
  hmi: {
    id: 'hmi',
    name: 'SDO/HMI continuum',
    indexPath: '/products/animations/sdo-hmii.json',
    snapshotPath: 'sky/sun/hmi.jpg',
    // Limb fits (steepest fall of brightness along 720 rays): centre 255.5, 255.4; radius 237.8 px with the
    // Sun at 968.5″ (2026-11-09) and 231.5 px at 943.9″ (2026-07-04): 4.07-4.08″ per pixel both times.
    centre: [255.5 / 512, 255.4 / 512],
    widthPx: 512,
    arcsecPerPx: 4.075,
    distanceFactor: 1,
    up: 'solar-north',
    innerRadii: 0,
    outerRadii: 1,
    tone: 'disc',
  },
  'suvi-171': {
    ...SUVI_GEOMETRY,
    id: 'suvi-171',
    name: 'GOES-19 SUVI 171 Å',
    indexPath: '/products/animations/suvi-primary-171.json',
    snapshotPath: 'sky/sun/suvi-171.jpg',
  },
  'suvi-195': {
    ...SUVI_GEOMETRY,
    id: 'suvi-195',
    name: 'GOES-19 SUVI 195 Å',
    indexPath: '/products/animations/suvi-primary-195.json',
    snapshotPath: 'sky/sun/suvi-195.jpg',
  },
  'suvi-304': {
    ...SUVI_GEOMETRY,
    id: 'suvi-304',
    name: 'GOES-19 SUVI 304 Å',
    indexPath: '/products/animations/suvi-primary-304.json',
    snapshotPath: 'sky/sun/suvi-304.jpg',
  },
  'lasco-c2': {
    id: 'lasco-c2',
    name: 'SOHO/LASCO C2',
    indexPath: '/products/animations/lasco-c2.json',
    snapshotPath: 'sky/sun/lasco-c2.jpg',
    // Drawn limb circle: centre 256.0, 259.1, radius 41.0 px = the Sun's 978″ from SOHO at 23.8″ per pixel
    // (the instrument's 11.9″ pixels, halved frame). Too few stars reach C2 to solve its roll: it shares C3's.
    centre: [256 / 512, 259.1 / 512],
    widthPx: 512,
    arcsecPerPx: 23.8,
    distanceFactor: 0.99,
    up: 'ecliptic-north',
    // The occulter's shadow ends at 95 px; the timestamp starts 245 px out.
    innerRadii: 2.35,
    outerRadii: 5.8,
    tone: 'table',
    // Median at 160-240 px from the centre: rgb 99, 1, 0, a mean of 0.13. C2's field is narrow and its
    // corona still falling at the edge, so the floor is set a little under that.
    tableFloor: 0.1,
  },
  'lasco-c3': {
    id: 'lasco-c3',
    name: 'SOHO/LASCO C3',
    indexPath: '/products/animations/lasco-c3.json',
    snapshotPath: 'sky/sun/lasco-c3.jpg',
    // Star solution: 112.58″ per pixel (the instrument's 56″, halved frame), top of frame 6.60° east of
    // solar north = ecliptic north. Sun centre from the drawn limb circle: 258.5, 246.2.
    centre: [258.5 / 512, 246.2 / 512],
    widthPx: 512,
    arcsecPerPx: 112.58,
    distanceFactor: 0.99,
    up: 'ecliptic-north',
    // Occulter to 38 px, but C2 covers out to 5.8 radii: C3 takes over there. The field's edge is 246 px
    // above the Sun.
    innerRadii: 5.6,
    outerRadii: 27.5,
    tone: 'table',
    // Median at 160-240 px from the centre: rgb 1, 68, 187.
    tableFloor: 0.33,
  },
  ccor1: {
    id: 'ccor1',
    name: 'GOES-19 CCOR-1',
    indexPath: '/products/animations/ccor1/ccor1.json',
    snapshotPath: 'sky/sun/ccor1.jpg',
    // Star solutions of two frames twelve hours apart: 39.97″ per pixel, top of frame within 0.1° of solar
    // north, Sun at 591.9-594.7, 593.2-593.9 (the spread is GOES-19's own parallax on its orbit).
    centre: [593.3 / 1204, 593.5 / 1205],
    widthPx: 1204,
    arcsecPerPx: 39.97,
    distanceFactor: 1,
    up: 'solar-north',
    // Occulter to 96 px; the frame's captions begin 572 px out.
    innerRadii: 4.1,
    outerRadii: 21.5,
    tone: 'emission',
  },
};

/** Pixels (at the product's reference size) spanned by one solar radius, when the Sun's radius from Earth is `sunRadiusArcsec`. */
export function solarRadiusPx(product: ProductGeometry, sunRadiusArcsec: number): number {
  return sunRadiusArcsec / product.distanceFactor / product.arcsecPerPx;
}

export interface Frame {
  /** Absolute URL of the image. */
  readonly url: string;
  /** Observation time, ms since the epoch. */
  readonly timeMs: number;
}

/**
 * When a frame was taken, from its file name. SWPC's names carry the time
 * in three styles: 20261109_2230_c3_512.jpg, 20261109_234038_512_HMII.jpg
 * and or_suvi-l2-ci171_g19_s20261109T001600Z_e....png (start of exposure).
 */
export function frameTimeMs(url: string): number | null {
  const name = url.slice(url.lastIndexOf('/') + 1);
  const match = /_s(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(name) ?? /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})?_/.exec(name);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => (part === undefined ? 0 : Number(part)));
  const time = Date.UTC(year, month - 1, day, hour, minute, second);
  return Number.isNaN(time) ? null : time;
}

/** The frames an SWPC animation index lists, oldest first; entries whose time cannot be read are dropped. */
export function parseFrameIndex(index: unknown): Frame[] {
  if (!Array.isArray(index)) return [];
  const frames: Frame[] = [];
  for (const entry of index) {
    const url = (entry as { url?: unknown } | null)?.url;
    if (typeof url !== 'string') continue;
    const timeMs = frameTimeMs(url);
    if (timeMs !== null) frames.push({ url: SWPC_BASE + url, timeMs });
  }
  return frames.sort((a, b) => a.timeMs - b.timeMs);
}

/** The frame taken nearest `nowMs`, or null if there are none. */
export function nearestFrame(frames: readonly Frame[], nowMs: number): Frame | null {
  let best: Frame | null = null;
  for (const frame of frames) {
    if (best === null || Math.abs(frame.timeMs - nowMs) < Math.abs(best.timeMs - nowMs)) best = frame;
  }
  return best;
}

/**
 * A frame further than this from the app clock no longer shows "now":
 * LASCO frames reach the ground hours late, and the Sun turns 13° a day.
 */
export const LIVE_WINDOW_MS = 6 * 3600 * 1000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "9 Nov 22:30 UT". */
export function formatImageTime(timeMs: number): string {
  const d = new Date(timeMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UT`;
}

/** "9 Nov 2026". */
export function formatImageDate(timeMs: number): string {
  const d = new Date(timeMs);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** One numbered active region from SWPC's solar_regions.json, as observed at the end of `observedDate` UT. */
export interface ActiveRegion {
  readonly region: number;
  /** Heliographic latitude, degrees north. */
  readonly latDeg: number;
  /** Carrington longitude, degrees: fixed to the turning Sun, so the region can be placed at any hour. */
  readonly carringtonLonDeg: number;
  /** Sunspot area in millionths of the visible hemisphere, or null if spotless. */
  readonly area: number | null;
  /** McIntosh class, e.g. "Dkc"; null if spotless. */
  readonly spotClass: string | null;
  /** Mount Wilson magnetic class, e.g. "BGD"; null if spotless. */
  readonly magClass: string | null;
  readonly observedDate: string;
}

/** The regions of the latest daily report in solar_regions.json (which holds a month of them). */
export function latestActiveRegions(report: unknown): ActiveRegion[] {
  if (!Array.isArray(report)) return [];
  const regions: ActiveRegion[] = [];
  for (const raw of report) {
    const entry = raw as Record<string, unknown> | null;
    if (
      entry === null ||
      typeof entry.region !== 'number' ||
      typeof entry.latitude !== 'number' ||
      typeof entry.carrington_longitude !== 'number' ||
      typeof entry.observed_date !== 'string'
    ) {
      continue;
    }
    regions.push({
      region: entry.region,
      latDeg: entry.latitude,
      carringtonLonDeg: entry.carrington_longitude,
      area: typeof entry.area === 'number' ? entry.area : null,
      spotClass: typeof entry.spot_class === 'string' ? entry.spot_class : null,
      magClass: typeof entry.mag_class === 'string' ? entry.mag_class : null,
      observedDate: entry.observed_date,
    });
  }
  const latest = regions.reduce((max, r) => (r.observedDate > max ? r.observedDate : max), '');
  return regions.filter((r) => r.observedDate === latest);
}

/** Mount Wilson class in the Greek it is written in: "BGD" → "βγδ". */
export function magClassGreek(magClass: string): string {
  const greek: Readonly<Record<string, string>> = { A: 'α', B: 'β', G: 'γ', D: 'δ' };
  return [...magClass.toUpperCase()].map((letter) => greek[letter] ?? '').join('');
}

/** "AR 4566 βγδ", or just the number for a region without spots. */
export function activeRegionLabel(region: ActiveRegion): string {
  const mag = region.magClass ? magClassGreek(region.magClass) : '';
  return mag ? `AR ${region.region} ${mag}` : `AR ${region.region}`;
}

/** The numbers SWPC publishes about the Sun's state; any may be missing if its feed failed. */
export interface SpaceWeather {
  /** GOES soft X-ray level now, as a flare class: "B7.6". */
  readonly xrayClass: string | null;
  /** 10.7 cm radio flux, solar flux units. */
  readonly f107: number | null;
  /** Solar wind speed at L1, km/s. */
  readonly windKmS: number | null;
  /** SWPC's daily sunspot number, and the day it is for. */
  readonly sunspotNumber: number | null;
  readonly sunspotDate: string | null;
  /** Time of the newest of the readings, ms. */
  readonly timeMs: number | null;
}

/**
 * The last day's row of SWPC's daily-solar-indices.txt: year month day,
 * 10.7 cm flux, sunspot number, then areas and counts.
 */
export function parseDailySolarIndices(text: string): { sunspotNumber: number; date: string } | null {
  let result: { sunspotNumber: number; date: string } | null = null;
  for (const line of text.split('\n')) {
    const match = /^(\d{4}) (\d{2}) (\d{2})\s+(-?\d+)\s+(-?\d+)\s/.exec(line);
    if (!match) continue;
    const sunspotNumber = Number(match[5]);
    if (sunspotNumber >= 0) result = { sunspotNumber, date: `${match[1]}-${match[2]}-${match[3]}` };
  }
  return result;
}

/** One line for the Sun's label: only what is known. */
export function spaceWeatherSummary(weather: SpaceWeather): string {
  const parts: string[] = [];
  if (weather.xrayClass) parts.push(`X-ray ${weather.xrayClass}`);
  if (weather.sunspotNumber !== null) parts.push(`sunspot no. ${weather.sunspotNumber}`);
  if (weather.f107 !== null) parts.push(`F10.7 ${Math.round(weather.f107)}`);
  if (weather.windKmS !== null) parts.push(`wind ${Math.round(weather.windKmS)} km/s`);
  return parts.join(' · ');
}
