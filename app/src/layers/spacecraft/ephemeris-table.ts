/**
 * Reading the baked table of spacecraft positions (app/public/space/
 * spacecraft.json, tools/pipeline/generate_spacecraft.py, from JPL
 * Horizons), and the Lagrange points the same layers mark.
 *
 * Pure: no drawing here.
 */

const DEG = Math.PI / 180;
const DAY_MS = 86400000;
export const AU_M = 149597870700;
/** Light crosses one astronomical unit in this many seconds. */
export const AU_LIGHT_SECONDS = 499.004784;

export interface CraftTable {
  readonly name: string;
  readonly horizons: string;
  readonly where: 'L1' | 'L2' | 'deep';
  readonly stepDays: number;
  /** Days from the table's start to this craft's first sample. */
  readonly offsetDays: number;
  /** Geocentric astrometric right ascension and declination (ICRF), degrees, and distance, au: one per step, at 00:00 UTC. */
  readonly ra: readonly number[];
  readonly dec: readonly number[];
  readonly au: readonly number[];
}

export interface SpacecraftData {
  /** YYYY-MM-DD. */
  readonly start: string;
  readonly stop: string;
  readonly craft: readonly CraftTable[];
}

/**
 * Two samples further apart on the sky than this are not interpolated
 * between. It happens only when a probe swings past the Earth for a
 * gravity assist and crosses half the sky in hours: a daily table cannot
 * say where it is then, so for those few days it is not shown.
 */
export const MAX_STEP_DEG = 8;
const MIN_STEP_COSINE = Math.cos(MAX_STEP_DEG * DEG);

/**
 * Where a craft is at `dateMs`: its geocentric ICRS position in au into
 * `out`, by interpolating direction and distance between the two samples
 * around the date. False outside the craft's table - nothing is
 * extrapolated - and across a step wider than MAX_STEP_DEG.
 */
export function craftPositionAu(craft: CraftTable, startMs: number, dateMs: number, out: number[]): boolean {
  const steps = ((dateMs - startMs) / DAY_MS - craft.offsetDays) / craft.stepDays;
  const last = craft.ra.length - 1;
  if (!(steps >= 0 && steps <= last)) return false;
  const i = Math.min(last - 1, Math.floor(steps));
  const t = steps - i;
  const ra0 = craft.ra[i] * DEG;
  const dec0 = craft.dec[i] * DEG;
  const ra1 = craft.ra[i + 1] * DEG;
  const dec1 = craft.dec[i + 1] * DEG;
  const a = [Math.cos(dec0) * Math.cos(ra0), Math.cos(dec0) * Math.sin(ra0), Math.sin(dec0)];
  const b = [Math.cos(dec1) * Math.cos(ra1), Math.cos(dec1) * Math.sin(ra1), Math.sin(dec1)];
  if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < MIN_STEP_COSINE) return false;
  const x = (1 - t) * a[0] + t * b[0];
  const y = (1 - t) * a[1] + t * b[1];
  const z = (1 - t) * a[2] + t * b[2];
  // The chord between two directions a step apart, pushed back out to the sphere.
  const distance = ((1 - t) * craft.au[i] + t * craft.au[i + 1]) / Math.hypot(x, y, z);
  out[0] = x * distance;
  out[1] = y * distance;
  out[2] = z * distance;
  return true;
}

/** "1.45 million km", "0.35 au", "170.0 au". */
export function distanceText(au: number): string {
  if (au < 0.1) return `${((au * AU_M) / 1e9).toFixed(2)} million km`;
  return `${au.toFixed(au < 10 ? 2 : 1)} au`;
}

/** "4.8 light-seconds", "12.3 light-minutes", "23.6 light-hours". */
export function lightTimeText(au: number): string {
  const seconds = au * AU_LIGHT_SECONDS;
  if (seconds < 90) return `${seconds.toFixed(1)} light-seconds`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)} light-minutes`;
  return `${(seconds / 3600).toFixed(1)} light-hours`;
}

/** Gravitational parameters, km³/s², as JPL Horizons lists them for the Sun, the Earth and the Moon. */
export const GM_SUN = 132712440041.93938;
export const GM_EARTH = 398600.435436;
export const GM_MOON = 4902.800066;
/** The mass fraction of the smaller body: the Earth and Moon together against the Sun, and the Moon against the Earth. */
export const MU_SUN_EARTH = (GM_EARTH + GM_MOON) / (GM_SUN + GM_EARTH + GM_MOON);
export const MU_EARTH_MOON = GM_MOON / (GM_EARTH + GM_MOON);

function root(f: (x: number) => number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  const rising = f(b) > f(a);
  for (let i = 0; i < 200; i++) {
    const mid = (a + b) / 2;
    if (f(mid) > 0 === rising) b = mid;
    else a = mid;
  }
  return (a + b) / 2;
}

/**
 * The three collinear Lagrange points of two bodies in circular orbit
 * about each other, `mu` being the smaller one's share of the mass: their
 * distances in units of the bodies' separation - L1 and L2 from the
 * smaller body (toward and away from the larger), L3 from the larger body
 * on the far side. Roots of the balance of gravity and centrifugal force
 * along the line through the bodies (the restricted three-body problem).
 */
export function collinearLagrange(mu: number): { l1: number; l2: number; l3: number } {
  // Rotating frame, separation 1, barycentre at 0: the larger body at -mu, the smaller at 1 - mu.
  const force = (x: number): number => x - ((1 - mu) * (x + mu)) / Math.abs(x + mu) ** 3 - (mu * (x - 1 + mu)) / Math.abs(x - 1 + mu) ** 3;
  const tiny = 1e-9;
  return {
    l1: 1 - mu - root(force, -mu + tiny, 1 - mu - tiny),
    l2: root(force, 1 - mu + tiny, 2) - (1 - mu),
    l3: -mu - root(force, -2, -mu - tiny),
  };
}
