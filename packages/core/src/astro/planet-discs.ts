/**
 * The planets as discs: how big each looks, which way its axis points on
 * the sky, which meridian faces the Earth and where the Sun stands over it.
 *
 * Shapes, poles and rotations are the IAU Working Group on Cartographic
 * Coordinates and Rotational Elements' 2015 report (Archinal et al. 2018,
 * Celest. Mech. Dyn. Astron. 130:22) as NAIF's pck00011.tpc transcribes
 * it - planet-rotation-data.ts. For the giant planets that rotation is
 * System III, the magnetic field's: the clouds drift against it.
 *
 * Everything is evaluated when the light now arriving left the planet,
 * which matters: Jupiter turns 24° in the 40 minutes its light travels.
 *
 * Measured against JPL Horizons over 1950-2050, see planet-discs.test.ts.
 */

import { J2000_JD, applyMat3, multiplyMat3, transposeMat3, type Mat3 } from './index';
import { AU_KM, julianEphemerisDate, planetEphemeris, positionAngleDeg, type PlanetEphemeris, type PlanetName, type Vec3Tuple } from './ephemeris';
import { MOON_RADII_KM, PLANET_ROTATION } from './planet-rotation-data';
import { PLANET_EQUATOR_J2000, PLANET_MOON_ORBITS } from './planet-moons-data';

const DEG = Math.PI / 180;
const ARCSEC_PER_RAD = 3600 / DEG;
const wrap360 = (deg: number): number => ((deg % 360) + 360) % 360;

interface RotationModel {
  readonly equatorialRadiusKm: number;
  readonly polarRadiusKm: number;
  readonly poleRa: readonly number[];
  readonly poleDec: readonly number[];
  readonly pm: readonly number[];
  readonly angles: readonly (readonly number[])[];
  readonly raTerms: readonly number[];
  readonly decTerms: readonly number[];
  readonly pmTerms: readonly number[];
}

const MODELS: Readonly<Record<PlanetName, RotationModel>> = PLANET_ROTATION;

export interface PlanetShape {
  readonly equatorialRadiusKm: number;
  readonly polarRadiusKm: number;
  /** Polar over equatorial radius: 1 for a sphere, 0.902 for Saturn. */
  readonly axisRatio: number;
}

export function planetShape(planet: PlanetName): PlanetShape {
  const { equatorialRadiusKm, polarRadiusKm } = MODELS[planet];
  return { equatorialRadiusKm, polarRadiusKm, axisRatio: polarRadiusKm / equatorialRadiusKm };
}

/**
 * Whether the planet's longitudes are counted westward, as the IAU does for
 * a planet turning the way the Earth does: so that the longitude facing a
 * distant observer always grows with time. Venus and Uranus turn the other
 * way about their IAU north poles and count eastward for the same reason.
 */
export function planetLongitudeIsWest(planet: PlanetName): boolean {
  return MODELS[planet].pm[1] > 0;
}

export interface PlanetRotation {
  /** ICRF right ascension and declination of the north pole, degrees. */
  readonly poleRaDeg: number;
  readonly poleDecDeg: number;
  /** W: the prime meridian's angle along the equator from the ascending node on the ICRF equator, degrees in [0, 360). */
  readonly primeMeridianDeg: number;
}

/** The IAU orientation of a planet at Julian Ephemeris Date `jde`. */
export function planetRotation(planet: PlanetName, jde: number): PlanetRotation {
  const model = MODELS[planet];
  const d = jde - J2000_JD;
  const t = d / 36525;
  let ra = model.poleRa[0] + model.poleRa[1] * t;
  let dec = model.poleDec[0] + model.poleDec[1] * t;
  let w = model.pm[0] + model.pm[1] * d;
  for (let i = 0; i < model.angles.length; i++) {
    const coefficients = model.angles[i];
    let theta = 0;
    for (let k = coefficients.length - 1; k >= 0; k--) theta = theta * t + coefficients[k];
    theta *= DEG;
    if (i < model.raTerms.length) ra += model.raTerms[i] * Math.sin(theta);
    if (i < model.decTerms.length) dec += model.decTerms[i] * Math.cos(theta);
    if (i < model.pmTerms.length) w += model.pmTerms[i] * Math.sin(theta);
  }
  return { poleRaDeg: wrap360(ra), poleDecDeg: dec, primeMeridianDeg: wrap360(w) };
}

function rotationZ(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function rotationX(angle: number): Mat3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

/**
 * A planet's own axes → ICRS at `jde`: z the north pole, x through the
 * prime meridian on the equator, y toward 90° EAST longitude whichever way
 * the planet's own longitudes are counted.
 */
export function planetBodyToIcrs(planet: PlanetName, jde: number): Mat3 {
  const { poleRaDeg, poleDecDeg, primeMeridianDeg } = planetRotation(planet, jde);
  return multiplyMat3(
    rotationZ((poleRaDeg + 90) * DEG),
    multiplyMat3(rotationX((90 - poleDecDeg) * DEG), rotationZ(primeMeridianDeg * DEG))
  );
}

/** A point of a planet's surface named three ways. */
export interface PlanetPoint {
  /** Longitude the way the planet's maps count it (see planetLongitudeIsWest), degrees in [0, 360). */
  readonly lonDeg: number;
  /** Longitude counted eastward, degrees in [0, 360). */
  readonly eastLonDeg: number;
  /** Planetographic latitude: the angle of the surface's normal, what maps and Horizons give. */
  readonly latDeg: number;
  /** Planetocentric latitude: the angle of the direction from the centre. */
  readonly centricLatDeg: number;
}

export interface PlanetDisc {
  readonly ephemeris: PlanetEphemeris;
  /** The body's axes → ICRS when the light left. */
  readonly bodyToIcrs: Mat3;
  /** Apparent equatorial diameter, arcseconds. */
  readonly equatorialDiameterArcsec: number;
  /** Diameter of the outline along the projected axis, arcseconds: the polar one seen equator-on, less flattened when tilted. */
  readonly polarDiameterArcsec: number;
  /** Position angle of the north pole, degrees counter-clockwise (through east) from `north`. */
  readonly northPoleAngleDeg: number;
  /** How far from the disc's centre the north pole lies, arcseconds: negative when it is on the far side. */
  readonly northPoleDistanceArcsec: number;
  /** Where the line from the planet's centre to the Earth leaves the surface: the middle of the disc. */
  readonly subEarth: PlanetPoint;
  /** Where the Sun is overhead. */
  readonly subSolar: PlanetPoint;
  /** Unit vectors from the planet to the Earth and to the Sun, in the planet's own axes. */
  readonly toEarthBody: Vec3Tuple;
  readonly toSunBody: Vec3Tuple;
}

function surfacePoint(planet: PlanetName, direction: Vec3Tuple): PlanetPoint {
  const { axisRatio } = planetShape(planet);
  const eastLonDeg = wrap360(Math.atan2(direction[1], direction[0]) / DEG);
  const centric = Math.asin(Math.max(-1, Math.min(1, direction[2])));
  return {
    lonDeg: planetLongitudeIsWest(planet) ? wrap360(360 - eastLonDeg) : eastLonDeg,
    eastLonDeg,
    latDeg: Math.atan2(Math.sin(centric), Math.cos(centric) * axisRatio * axisRatio) / DEG,
    centricLatDeg: centric / DEG,
  };
}

const unit = (v: Vec3Tuple, sign: number): [number, number, number] => {
  const k = sign / Math.hypot(v[0], v[1], v[2]);
  return [v[0] * k, v[1] * k, v[2] * k];
};

/**
 * A planet's disc as seen from the Earth's centre at `utc`. Position
 * angles are from `north`, by default the ICRS pole.
 */
export function planetDisc(planet: PlanetName, utc: Date, north: Vec3Tuple = [0, 0, 1]): PlanetDisc {
  const ephemeris = planetEphemeris(planet, utc);
  const shape = planetShape(planet);
  const bodyToIcrs = planetBodyToIcrs(planet, julianEphemerisDate(utc) - ephemeris.lightTimeDays);
  const toBody = transposeMat3(bodyToIcrs);
  const toEarthBody = applyMat3(toBody, unit(ephemeris.positionAu, -1));
  const toSunBody = applyMat3(toBody, unit(ephemeris.heliocentricAu, -1));
  const subEarth = surfacePoint(planet, toEarthBody);
  const distanceKm = ephemeris.distanceAu * AU_KM;
  const sinTilt = toEarthBody[2];
  const cosTilt = Math.sqrt(1 - sinTilt * sinTilt);
  // A spheroid seen at latitude B shows an ellipse whose short semi-axis is sqrt(c² cos²B + a² sin²B).
  const outlinePolarKm = Math.hypot(shape.polarRadiusKm * cosTilt, shape.equatorialRadiusKm * sinTilt);
  return {
    ephemeris,
    bodyToIcrs,
    equatorialDiameterArcsec: 2 * Math.asin(shape.equatorialRadiusKm / distanceKm) * ARCSEC_PER_RAD,
    polarDiameterArcsec: 2 * Math.asin(outlinePolarKm / distanceKm) * ARCSEC_PER_RAD,
    northPoleAngleDeg: positionAngleDeg(ephemeris.positionAu, [bodyToIcrs[2], bodyToIcrs[5], bodyToIcrs[8]], north),
    northPoleDistanceArcsec: Math.sign(sinTilt || 1) * Math.asin((shape.polarRadiusKm * cosTilt) / distanceKm) * ARCSEC_PER_RAD,
    subEarth,
    subSolar: surfacePoint(planet, toSunBody),
    toEarthBody,
    toSunBody,
  };
}

/** Saturn's rings as Meeus ch. 45 names them, here from the IAU pole: the rings lie in the planet's equator. */
export interface RingAspect {
  /** B: the Earth's Saturnicentric latitude above the ring plane, degrees; positive shows the northern face. */
  readonly tiltDeg: number;
  /** B′: the Sun's. When it and B differ in sign the Earth sees the unlit face. */
  readonly sunTiltDeg: number;
  /** P: position angle of the rings' minor axis, the planet's north pole, degrees from `north`. */
  readonly positionAngleDeg: number;
}

export function ringAspect(disc: PlanetDisc): RingAspect {
  return {
    tiltDeg: disc.subEarth.centricLatDeg,
    sunTiltDeg: disc.subSolar.centricLatDeg,
    positionAngleDeg: disc.northPoleAngleDeg,
  };
}

type MoonOrbit = {
  readonly planet: string;
  readonly semiMajorAxisKm: number;
  readonly meanLongitude: readonly [number, number];
  readonly eccentricity: number;
  readonly periapsis: readonly [number, number];
  readonly plane: readonly [number, number];
  readonly tilt: number;
  readonly node: readonly [number, number];
  readonly libration: readonly [number, number, number] | null;
};

export type PlanetMoonName = keyof typeof PLANET_MOON_ORBITS;
export const PLANET_MOON_NAMES = Object.keys(PLANET_MOON_ORBITS) as PlanetMoonName[];

/** The planet a moon goes round. */
export function moonPlanet(moon: PlanetMoonName): PlanetName {
  return PLANET_MOON_ORBITS[moon].planet;
}

export function moonRadiusKm(moon: PlanetMoonName): number {
  return MOON_RADII_KM[moon];
}

/** How far the fitted orbit strays from JPL Horizons over 1950-2050, as the bake measured it. */
export function moonOrbitFit(moon: PlanetMoonName): { readonly rmsKm: number; readonly maxKm: number } {
  return PLANET_MOON_ORBITS[moon].fit;
}

/**
 * A moon from its planet's centre, km, ICRS axes, at Julian Ephemeris Date
 * `jde`: a precessing ellipse fitted to JPL Horizons over 1950-2050
 * (planet-moons-data.ts says how well; outside that century it drifts).
 */
export function moonPlanetocentricKm(moon: PlanetMoonName, jde: number): [number, number, number] {
  const orbit: MoonOrbit = PLANET_MOON_ORBITS[moon];
  const d = jde - J2000_JD;
  let meanLongitude = orbit.meanLongitude[0] + orbit.meanLongitude[1] * d;
  if (orbit.libration) meanLongitude += orbit.libration[0] * Math.sin(orbit.libration[1] + orbit.libration[2] * d);
  const periapsis = orbit.periapsis[0] + orbit.periapsis[1] * d;
  const e = orbit.eccentricity;
  const meanAnomaly = meanLongitude - periapsis;
  let eccentric = meanAnomaly;
  for (let i = 0; i < 8; i++) eccentric -= (eccentric - e * Math.sin(eccentric) - meanAnomaly) / (1 - e * Math.cos(eccentric));
  const trueAnomaly = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(eccentric / 2), Math.sqrt(1 - e) * Math.cos(eccentric / 2));
  const r = orbit.semiMajorAxisKm * (1 - e * Math.cos(eccentric));
  const longitude = periapsis + trueAnomaly;
  const node = orbit.node[0] + orbit.node[1] * d;
  const p = orbit.plane[0] + orbit.tilt * Math.sin(node);
  const q = orbit.plane[1] + orbit.tilt * Math.cos(node);
  const k = 1 / (1 + p * p + q * q);
  const x = r * Math.cos(longitude);
  const y = r * Math.sin(longitude);
  const equatorial: Vec3Tuple = [
    k * (x * (1 - p * p + q * q) + y * 2 * p * q),
    k * (x * 2 * p * q + y * (1 + p * p - q * q)),
    k * (-2 * p * x + 2 * q * y),
  ];
  // The rows of the frame are its axes in the ICRS: its transpose takes the frame's coordinates there.
  return applyMat3(transposeMat3(PLANET_EQUATOR_J2000[orbit.planet as keyof typeof PLANET_EQUATOR_J2000] as unknown as Mat3), equatorial);
}

/**
 * What the planet does to the view of a moon: `transit` it crosses the
 * disc's face, `occulted` it is behind the disc, `eclipsed` it is in the
 * planet's shadow and dark though the line of sight is open.
 */
export type MoonSituation = 'clear' | 'transit' | 'occulted' | 'eclipsed';

export interface PlanetMoonView {
  readonly moon: PlanetMoonName;
  /** Planet to moon when the light left, km, ICRS axes. */
  readonly offsetKm: Vec3Tuple;
  /** The same in the planet's own axes, in equatorial radii of the planet. */
  readonly offsetBody: Vec3Tuple;
  /** Unit vector from the Earth's centre to the moon, ICRS axes. */
  readonly direction: Vec3Tuple;
  /** Angle between the moon and the planet's centre, arcseconds. */
  readonly separationArcsec: number;
  readonly situation: MoonSituation;
}

/** Whether the ray from `origin` along unit `direction` meets the spheroid; both in equatorial radii, the planet's own axes. */
export function rayMeetsSpheroid(origin: Vec3Tuple, direction: Vec3Tuple, axisRatio: number): boolean {
  const o: Vec3Tuple = [origin[0], origin[1], origin[2] / axisRatio];
  const u: Vec3Tuple = [direction[0], direction[1], direction[2] / axisRatio];
  const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
  const ou = o[0] * u[0] + o[1] * u[1] + o[2] * u[2];
  const oo = o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
  // Ahead of the origin, and the closest approach inside the unit sphere.
  return ou < 0 && oo - (ou * ou) / uu < 1;
}

/** The moons of the planet whose disc this is, as seen from the Earth's centre at `utc` (the instant the disc was made for). */
export function planetMoons(planet: PlanetName, disc: PlanetDisc, utc: Date): PlanetMoonView[] {
  const jde = julianEphemerisDate(utc) - disc.ephemeris.lightTimeDays;
  const shape = planetShape(planet);
  const toBody = transposeMat3(disc.bodyToIcrs);
  const away: Vec3Tuple = [-disc.toEarthBody[0], -disc.toEarthBody[1], -disc.toEarthBody[2]];
  const p = disc.ephemeris.positionAu;
  const views: PlanetMoonView[] = [];
  for (const moon of PLANET_MOON_NAMES) {
    if (PLANET_MOON_ORBITS[moon].planet !== planet) continue;
    const offsetKm = moonPlanetocentricKm(moon, jde);
    const b = applyMat3(toBody, offsetKm);
    const offsetBody: Vec3Tuple = [b[0] / shape.equatorialRadiusKm, b[1] / shape.equatorialRadiusKm, b[2] / shape.equatorialRadiusKm];
    const direction = unit([p[0] * AU_KM + offsetKm[0], p[1] * AU_KM + offsetKm[1], p[2] * AU_KM + offsetKm[2]], 1);
    const cos = (direction[0] * p[0] + direction[1] * p[1] + direction[2] * p[2]) / disc.ephemeris.distanceAu;
    const cross = Math.hypot(
      direction[1] * p[2] - direction[2] * p[1],
      direction[2] * p[0] - direction[0] * p[2],
      direction[0] * p[1] - direction[1] * p[0]
    ) / disc.ephemeris.distanceAu;
    let situation: MoonSituation = 'clear';
    if (rayMeetsSpheroid(offsetBody, disc.toEarthBody, shape.axisRatio)) situation = 'occulted';
    else if (rayMeetsSpheroid(offsetBody, disc.toSunBody, shape.axisRatio)) situation = 'eclipsed';
    else if (rayMeetsSpheroid(offsetBody, away, shape.axisRatio)) situation = 'transit';
    views.push({ moon, offsetKm, offsetBody, direction, separationArcsec: Math.atan2(cross, cos) * ARCSEC_PER_RAD, situation });
  }
  return views;
}

export interface RingBand {
  readonly name: string;
  readonly innerKm: number;
  readonly outerKm: number;
  /** Normal optical depth: how much of the light going straight through is stopped, as exp(-depth). */
  readonly opticalDepth: number;
  /** Fraction of the light a ring particle scatters back rather than absorbs. */
  readonly albedo: number;
}

/**
 * Saturn's main rings: edges from NASA's Saturnian Rings Fact Sheet
 * (D. R. Williams, NSSDCA, 2022). The sheet gives each ring's optical
 * depth and albedo as a range; these are the middles of those ranges, so
 * each ring is one flat tone - the ringlets and density waves inside them
 * are not drawn. The Encke and Keeler gaps (325 and 35 km) are too narrow
 * to show and are left out.
 */
export const SATURN_RINGS: readonly RingBand[] = [
  { name: 'C ring', innerKm: 74658, outerKm: 91975, opticalDepth: 0.2, albedo: 0.2 },
  { name: 'B ring', innerKm: 91975, outerKm: 117507, opticalDepth: 1.45, albedo: 0.5 },
  { name: 'Cassini division', innerKm: 117507, outerKm: 122340, opticalDepth: 0.05, albedo: 0.3 },
  { name: 'A ring', innerKm: 122340, outerKm: 136780, opticalDepth: 0.7, albedo: 0.5 },
];
