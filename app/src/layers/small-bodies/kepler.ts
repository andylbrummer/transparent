/**
 * Where a small body is, from its osculating orbital elements: the
 * unperturbed (two-body) orbit round the Sun that matches the real one at
 * the elements' epoch. Away from the epoch the planets' pull, which this
 * leaves out, moves the real body off it - by arcminutes within a year for
 * the bodies here (see kepler.test.ts, against JPL Horizons) - so the
 * layers show nothing outside the period the baked elements are good for.
 *
 * Pure: no drawing here. The same arithmetic as
 * tools/pipeline/generate_small_bodies.py, which checks every baked body.
 */

import { heliocentricIcrsAu, julianEphemerisDate, type Vec3Tuple } from '@transparent-earth/core';

const DEG = Math.PI / 180;
/** Gaussian gravitational constant, au^1.5 per day: the Sun's pull in the elements' units. */
export const GAUSS_K = 0.01720209895;
/** Obliquity of the ecliptic at J2000 (IAU 1976): JPL's "ecliptic and equinox of J2000". */
const OBLIQUITY = (84381.448 / 3600) * DEG;
const COS_OBLIQUITY = Math.cos(OBLIQUITY);
const SIN_OBLIQUITY = Math.sin(OBLIQUITY);
const LIGHT_DAYS_PER_AU = 499.004784 / 86400;

/** An orbit as JPL writes a comet's: usable for an ellipse, a parabola and a hyperbola alike. */
export interface OrbitElements {
  /** Perihelion distance, au. */
  readonly q: number;
  /** Eccentricity. */
  readonly e: number;
  /** Inclination, longitude of the ascending node, argument of perihelion: degrees, ecliptic and equinox of J2000. */
  readonly i: number;
  readonly om: number;
  readonly w: number;
  /** Time of perihelion passage, Julian date (TDB). */
  readonly tp: number;
}

/**
 * The orbit's own axes in ICRS: unit vectors toward perihelion (first
 * three numbers) and a quarter turn on along the orbit (last three).
 */
export function orbitBasis(incDeg: number, nodeDeg: number, periDeg: number, out: number[] = []): number[] {
  const i = incDeg * DEG;
  const om = nodeDeg * DEG;
  const w = periDeg * DEG;
  const cosOm = Math.cos(om);
  const sinOm = Math.sin(om);
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  // On the ecliptic, then tipped up to the equator.
  const px = cosOm * cosW - sinOm * sinW * cosI;
  const py = sinOm * cosW + cosOm * sinW * cosI;
  const pz = sinW * sinI;
  const qx = -cosOm * sinW - sinOm * cosW * cosI;
  const qy = -sinOm * sinW + cosOm * cosW * cosI;
  const qz = cosW * sinI;
  out[0] = px;
  out[1] = py * COS_OBLIQUITY - pz * SIN_OBLIQUITY;
  out[2] = py * SIN_OBLIQUITY + pz * COS_OBLIQUITY;
  out[3] = qx;
  out[4] = qy * COS_OBLIQUITY - qz * SIN_OBLIQUITY;
  out[5] = qy * SIN_OBLIQUITY + qz * COS_OBLIQUITY;
  return out;
}

/** Eccentric anomaly E of Kepler's equation E − e sin E = M, radians, for an ellipse. */
export function solveKepler(meanAnomaly: number, e: number): number {
  // Into −π..π, where Newton's method from these starts always settles.
  const mean = meanAnomaly - 2 * Math.PI * Math.round(meanAnomaly / (2 * Math.PI));
  let ecc = e < 0.8 ? mean : Math.sign(mean || 1) * Math.PI;
  for (let pass = 0; pass < 60; pass++) {
    const step = (ecc - e * Math.sin(ecc) - mean) / (1 - e * Math.cos(ecc));
    ecc -= step;
    if (Math.abs(step) < 1e-14) break;
  }
  return ecc;
}

/**
 * Position in the orbit's plane at `jd` (TDB), au: x toward perihelion,
 * y a quarter turn on. Written into `out`.
 */
export function inPlanePosition(q: number, e: number, tp: number, jd: number, out: number[]): number[] {
  const dt = jd - tp;
  if (e < 1) {
    const a = q / (1 - e);
    const ecc = solveKepler(GAUSS_K * a ** -1.5 * dt, e);
    out[0] = a * (Math.cos(ecc) - e);
    out[1] = a * Math.sqrt(1 - e * e) * Math.sin(ecc);
  } else if (e === 1) {
    // Barker's equation: the parabola has a closed answer.
    const w = (1.5 * GAUSS_K * dt) / Math.sqrt(2 * q ** 3);
    const s = Math.cbrt(w + Math.sqrt(w * w + 1));
    const tanHalf = s - 1 / s;
    out[0] = q * (1 - tanHalf * tanHalf);
    out[1] = 2 * q * tanHalf;
  } else {
    const a = q / (e - 1);
    const mean = GAUSS_K * a ** -1.5 * dt;
    let hyp = Math.asinh(mean / e);
    for (let pass = 0; pass < 60; pass++) {
      const step = (e * Math.sinh(hyp) - hyp - mean) / (e * Math.cosh(hyp) - 1);
      hyp -= step;
      if (Math.abs(step) < 1e-14) break;
    }
    out[0] = a * (e - Math.cosh(hyp));
    out[1] = a * Math.sqrt(e * e - 1) * Math.sinh(hyp);
  }
  return out;
}

/** Heliocentric position at `jd` (TDB), au, ICRS axes. */
export function heliocentricPosition(orbit: OrbitElements, jd: number, out: number[] = []): number[] {
  const basis = orbitBasis(orbit.i, orbit.om, orbit.w, SCRATCH_BASIS);
  const [x, y] = inPlanePosition(orbit.q, orbit.e, orbit.tp, jd, SCRATCH_PLANE);
  out[0] = basis[0] * x + basis[3] * y;
  out[1] = basis[1] * x + basis[4] * y;
  out[2] = basis[2] * x + basis[5] * y;
  return out;
}

const SCRATCH_BASIS: number[] = [];
const SCRATCH_PLANE: number[] = [];
const SCRATCH_HELIO: number[] = [];

/** A body as seen from the Earth's centre. */
export interface BodyView {
  /** Unit vector toward it, ICRS: where its light comes from (astrometric, light-time allowed for). */
  readonly direction: [number, number, number];
  /** From the Earth, au. */
  distanceAu: number;
  /** From the Sun, au. */
  sunDistanceAu: number;
  /** Sun–body–Earth angle, radians. */
  phaseAngle: number;
  /** Sun–Earth–body angle, degrees: how far from the Sun it stands in the sky. */
  elongationDeg: number;
}

export function emptyView(): BodyView {
  return { direction: [1, 0, 0], distanceAu: 1, sunDistanceAu: 1, phaseAngle: 0, elongationDeg: 0 };
}

/** The Earth's heliocentric position at a UTC instant, au, ICRS axes, and that instant as a Julian date (TT). */
export function earthAt(utc: Date): { readonly jd: number; readonly earth: Vec3Tuple } {
  const jd = julianEphemerisDate(utc);
  return { jd, earth: heliocentricIcrsAu('earth', jd) };
}

/** Where the body on `orbit` is seen from the Earth (heliocentric `earth`, au) at `jd`; written into `view`. */
export function viewFromEarth(orbit: OrbitElements, jd: number, earth: Vec3Tuple, view: BodyView): BodyView {
  let delay = 0;
  let dx = 0;
  let dy = 0;
  let dz = 0;
  let distance = 0;
  const helio = SCRATCH_HELIO;
  // The light seen now left a light-time ago: step back to where the body was then.
  for (let pass = 0; pass < 3; pass++) {
    heliocentricPosition(orbit, jd - delay, helio);
    dx = helio[0] - earth[0];
    dy = helio[1] - earth[1];
    dz = helio[2] - earth[2];
    distance = Math.hypot(dx, dy, dz);
    delay = distance * LIGHT_DAYS_PER_AU;
  }
  const sunDistance = Math.hypot(helio[0], helio[1], helio[2]);
  const earthSun = Math.hypot(earth[0], earth[1], earth[2]);
  view.direction[0] = dx / distance;
  view.direction[1] = dy / distance;
  view.direction[2] = dz / distance;
  view.distanceAu = distance;
  view.sunDistanceAu = sunDistance;
  // Both from the triangle Sun-Earth-body.
  view.phaseAngle = Math.acos(clamp((helio[0] * dx + helio[1] * dy + helio[2] * dz) / (sunDistance * distance)));
  view.elongationDeg = Math.acos(clamp(-(earth[0] * dx + earth[1] * dy + earth[2] * dz) / (earthSun * distance))) / DEG;
  return view;
}

const clamp = (cosine: number): number => Math.max(-1, Math.min(1, cosine));

/**
 * Apparent visual magnitude of an asteroid in the IAU H,G system (Bowell
 * et al. 1989, as JPL and the Minor Planet Center use it): absolute
 * magnitude H, slope parameter G, distances in au, phase angle in radians.
 */
export function asteroidMagnitude(h: number, g: number, sunDistanceAu: number, distanceAu: number, phaseAngle: number): number {
  const t = Math.tan(phaseAngle / 2);
  const phi1 = Math.exp(-3.33 * t ** 0.63);
  const phi2 = Math.exp(-1.87 * t ** 1.22);
  return h + 5 * Math.log10(sunDistanceAu * distanceAu) - 2.5 * Math.log10((1 - g) * phi1 + g * phi2);
}

/**
 * Predicted total magnitude of a comet from JPL's M1 and K1:
 * M1 + 5 log Δ + K1 log r. A fit to past brightness, not an observation:
 * comets routinely run a magnitude or two either side of it.
 */
export function cometMagnitude(m1: number, k1: number, sunDistanceAu: number, distanceAu: number): number {
  return m1 + 5 * Math.log10(distanceAu) + k1 * Math.log10(sunDistanceAu);
}

/** The baked elements' epoch and the period they may be used for, Julian dates. */
export interface ValidityWindow {
  readonly epochJd: number;
  readonly validFromJd: number;
  readonly validToJd: number;
}

export function withinWindow(window: ValidityWindow, jd: number): boolean {
  return jd >= window.validFromJd && jd <= window.validToJd;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1 Jan 2027" for a Julian date, UTC. */
export function jdDateText(jd: number): string {
  const d = new Date((jd - 2440587.5) * 86400000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The chip while the clock is outside the window: the layer shows nothing and says why. */
export function outsideWindowStatus(window: ValidityWindow): string {
  return `hidden · orbits good ${jdDateText(window.validFromJd)} – ${jdDateText(window.validToJd)} only`;
}
