import { describe, it, expect } from 'vitest';
import { PLANET_DISCS } from './planet-discs.fixture';
import { PLANET_MOONS } from './planet-moons.fixture';
import { AU_KM, PLANET_NAMES, julianEphemerisDate, type PlanetName, type Vec3Tuple } from './ephemeris';
import { applyMat3, precessionMatrix, raDecToUnit, transposeMat3 } from './index';
import {
  PLANET_MOON_NAMES,
  SATURN_RINGS,
  moonOrbitFit,
  moonPlanet,
  moonPlanetocentricKm,
  moonRadiusKm,
  planetBodyToIcrs,
  planetDisc,
  planetLongitudeIsWest,
  planetMoons,
  planetRotation,
  planetShape,
  rayMeetsSpheroid,
  ringAspect,
} from './planet-discs';

const DEG = Math.PI / 180;
const ARCSEC_PER_RAD = 3600 / DEG;
const wrap180 = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;
/** Horizons measures position angles from the true north of date; the mean pole of date is within 10″ of it. */
const northOfDate = (date: Date): Vec3Tuple => applyMat3(transposeMat3(precessionMatrix(date)), [0, 0, 1]);

const discCases = PLANET_NAMES.flatMap((planet) =>
  PLANET_DISCS.instants.map((iso, index) => ({ planet, iso, date: new Date(iso), want: PLANET_DISCS.geocentric[planet][index] }))
);

describe('planetShape', () => {
  it('has the giants flattened and the rocky planets nearly round', () => {
    expect(planetShape('saturn').axisRatio).toBeCloseTo(0.902, 3);
    expect(planetShape('jupiter').axisRatio).toBeCloseTo(0.935, 3);
    expect(planetShape('venus').axisRatio).toBe(1);
    expect(planetShape('mars').equatorialRadiusKm).toBeCloseTo(3396.19, 2);
  });
});

describe('planetLongitudeIsWest', () => {
  it.each(PLANET_NAMES)('counts %s’s longitudes the way Horizons says it does', (planet) => {
    expect(planetLongitudeIsWest(planet)).toBe(PLANET_DISCS.longitudePositive[planet] === 'west');
  });
});

describe('planetRotation', () => {
  it.each(discCases)('puts $planet’s pole where Horizons does at $iso', ({ planet, date, want }) => {
    const disc = planetDisc(planet, date);
    const rotation = planetRotation(planet, julianEphemerisDate(date) - disc.ephemeris.lightTimeDays);
    expect(Math.abs(wrap180(rotation.poleRaDeg - want.poleRa) * Math.cos(want.poleDec * DEG))).toBeLessThan(1e-4);
    expect(Math.abs(rotation.poleDecDeg - want.poleDec)).toBeLessThan(1e-4);
  });

  it('gives a right-handed frame whose z axis is the pole', () => {
    const m = planetBodyToIcrs('saturn', 2461000.5);
    const { poleRaDeg, poleDecDeg } = planetRotation('saturn', 2461000.5);
    const pole = raDecToUnit(poleRaDeg, poleDecDeg);
    expect(m[2]).toBeCloseTo(pole[0], 12);
    expect(m[5]).toBeCloseTo(pole[1], 12);
    expect(m[8]).toBeCloseTo(pole[2], 12);
    const x: Vec3Tuple = [m[0], m[3], m[6]];
    const y: Vec3Tuple = [m[1], m[4], m[7]];
    expect(x[0] * y[1] - x[1] * y[0]).toBeCloseTo(m[8], 12);
  });
});

describe('planetDisc against JPL Horizons', () => {
  it.each(discCases)('$planet at $iso: size', ({ planet, date, want }) => {
    const disc = planetDisc(planet, date);
    expect(Math.abs(disc.equatorialDiameterArcsec / want.angularDiameterArcsec - 1)).toBeLessThan(1e-5);
    // Seen equator-on the outline is the polar diameter; tilted, something between the two.
    expect(disc.polarDiameterArcsec).toBeLessThanOrEqual(disc.equatorialDiameterArcsec + 1e-9);
    expect(disc.polarDiameterArcsec).toBeGreaterThanOrEqual(disc.equatorialDiameterArcsec * planetShape(planet).axisRatio - 1e-9);
  });

  it.each(discCases)('$planet at $iso: the points under the Earth and the Sun', ({ planet, date, want }) => {
    const disc = planetDisc(planet, date);
    // 0.01° of longitude is 20 km on Jupiter's equator; the Sun's point carries the ephemeris's own error twice.
    expect(Math.abs(wrap180(disc.subEarth.lonDeg - want.subObserverLon))).toBeLessThan(0.005);
    expect(Math.abs(disc.subEarth.latDeg - want.subObserverLat)).toBeLessThan(0.002);
    expect(Math.abs(wrap180(disc.subSolar.lonDeg - want.subSolarLon))).toBeLessThan(0.02);
    expect(Math.abs(disc.subSolar.latDeg - want.subSolarLat)).toBeLessThan(0.005);
  });

  it.each(discCases)('$planet at $iso: which way the pole points on the sky', ({ planet, date, want }) => {
    const disc = planetDisc(planet, date, northOfDate(date));
    // Uranus's pole lies nearly along the line of sight at times, where its position angle is ill-conditioned.
    expect(Math.abs(wrap180(disc.northPoleAngleDeg - want.northPoleAngle))).toBeLessThan(planet === 'uranus' ? 0.03 : 0.01);
    // Horizons' pole distance is c·cos(planetographic latitude). The pole's true place on the disc is
    // c·cos(planetocentric latitude), which is what the app draws; the two agree for a sphere.
    const graphic = disc.subEarth.latDeg * DEG;
    const horizonsWay =
      Math.sign(graphic || 1) * Math.asin((planetShape(planet).polarRadiusKm * Math.cos(graphic)) / (disc.ephemeris.distanceAu * AU_KM)) * ARCSEC_PER_RAD;
    expect(Math.abs(horizonsWay - want.northPoleDistanceArcsec)).toBeLessThan(0.001);
    expect(Math.sign(disc.northPoleDistanceArcsec)).toBe(Math.sign(want.northPoleDistanceArcsec));
    expect(Math.abs(disc.northPoleDistanceArcsec)).toBeGreaterThanOrEqual(Math.abs(horizonsWay) - 1e-9);
  });

  it.each(discCases)('$planet at $iso: phase', ({ planet, date, want }) => {
    expect(Math.abs(planetDisc(planet, date).ephemeris.illuminatedFraction * 100 - want.illuminatedPercent)).toBeLessThan(0.01);
  });

  it('shows Venus as a thin crescent in August 2023 and Jupiter always nearly full', () => {
    expect(planetDisc('venus', new Date('2023-08-10T12:00:00Z')).ephemeris.illuminatedFraction).toBeLessThan(0.03);
    for (const iso of PLANET_DISCS.instants) expect(planetDisc('jupiter', new Date(iso)).ephemeris.illuminatedFraction).toBeGreaterThan(0.98);
  });
});

describe('ringAspect', () => {
  it('has Saturn’s rings wide open in 2017 and edge-on in March 2025', () => {
    const open = ringAspect(planetDisc('saturn', new Date('2017-10-16T18:00:00Z')));
    expect(open.tiltDeg).toBeGreaterThan(26);
    expect(open.sunTiltDeg).toBeGreaterThan(26);
    const edge = ringAspect(planetDisc('saturn', new Date('2025-03-23T12:00:00Z')));
    expect(Math.abs(edge.tiltDeg)).toBeLessThan(0.1);
  });

  it('lists the main rings from the planet outward without overlap', () => {
    for (let i = 0; i < SATURN_RINGS.length; i++) {
      expect(SATURN_RINGS[i].outerKm).toBeGreaterThan(SATURN_RINGS[i].innerKm);
      if (i > 0) expect(SATURN_RINGS[i].innerKm).toBe(SATURN_RINGS[i - 1].outerKm);
    }
    expect(SATURN_RINGS[0].innerKm).toBeGreaterThan(planetShape('saturn').equatorialRadiusKm);
    // The B ring is the opaque one; the Cassini division nearly empty.
    const depth = (name: string): number => SATURN_RINGS.find((band) => band.name === name)!.opticalDepth;
    expect(depth('B ring')).toBeGreaterThan(depth('A ring'));
    expect(depth('Cassini division')).toBeLessThan(0.1);
  });
});

describe('rayMeetsSpheroid', () => {
  it('meets a ball ahead and misses one behind or to the side', () => {
    expect(rayMeetsSpheroid([3, 0, 0], [-1, 0, 0], 1)).toBe(true);
    expect(rayMeetsSpheroid([3, 0, 0], [1, 0, 0], 1)).toBe(false);
    expect(rayMeetsSpheroid([3, 1.01, 0], [-1, 0, 0], 1)).toBe(false);
    expect(rayMeetsSpheroid([3, 0.99, 0], [-1, 0, 0], 1)).toBe(true);
  });

  it('knows a flattened planet is lower over its poles', () => {
    expect(rayMeetsSpheroid([3, 0, 0.95], [-1, 0, 0], 0.9)).toBe(false);
    expect(rayMeetsSpheroid([3, 0, 0.85], [-1, 0, 0], 0.9)).toBe(true);
    expect(rayMeetsSpheroid([3, 0.95, 0], [-1, 0, 0], 0.9)).toBe(true);
  });
});

/**
 * How far a moon may be from where Horizons has it, arcseconds on the sky. Measured worst over the
 * fixture: Io 0.07, Europa 0.34, Ganymede 0.77, Callisto 0.76; Titan 0.12, Iapetus 1.29, Saturn's
 * other three under 0.07; Triton 0.04. Jupiter's disc is 30-50″ across.
 */
const MOON_TOLERANCE_ARCSEC: Partial<Record<PlanetName, number>> = { jupiter: 1.0, saturn: 1.5, neptune: 0.1 };

const moonCases = PLANET_MOON_NAMES.flatMap((moon) =>
  PLANET_MOONS.instants.map((iso, index) => ({
    moon,
    iso,
    date: new Date(iso),
    want: PLANET_MOONS.moons[moon][index],
    planetWant: PLANET_MOONS.planets[moonPlanet(moon) as 'jupiter' | 'saturn' | 'neptune'][index],
  }))
);

/** Offset of a moon from its planet on the sky, arcseconds along ICRS axes (small angles). */
const offsetArcsec = (moon: Vec3Tuple, planet: Vec3Tuple): Vec3Tuple => [
  (moon[0] - planet[0]) * ARCSEC_PER_RAD,
  (moon[1] - planet[1]) * ARCSEC_PER_RAD,
  (moon[2] - planet[2]) * ARCSEC_PER_RAD,
];

describe('moons against JPL Horizons', () => {
  it('knows which planet each goes round', () => {
    expect(PLANET_MOON_NAMES.filter((moon) => moonPlanet(moon) === 'jupiter')).toEqual(['io', 'europa', 'ganymede', 'callisto']);
    expect(moonPlanet('titan')).toBe('saturn');
    expect(moonPlanet('triton')).toBe('neptune');
    expect(moonRadiusKm('ganymede')).toBeGreaterThan(moonRadiusKm('titan'));
  });

  it.each(PLANET_MOON_NAMES)('%s: the fitted orbit stays within a quarter of a degree of Horizons over 1950-2050', (moon) => {
    const fit = moonOrbitFit(moon);
    const radiusKm = Math.hypot(...moonPlanetocentricKm(moon, 2461000.5));
    expect(fit.maxKm / radiusKm / DEG).toBeLessThan(0.25);
    expect(fit.rmsKm).toBeLessThan(fit.maxKm);
  });

  it.each(moonCases)('$moon at $iso: place beside its planet', ({ moon, date, want, planetWant }) => {
    const planet = moonPlanet(moon);
    const disc = planetDisc(planet, date);
    const view = planetMoons(planet, disc, date).find((entry) => entry.moon === moon)!;
    const p = disc.ephemeris.positionAu;
    const planetDirection: Vec3Tuple = [p[0] / disc.ephemeris.distanceAu, p[1] / disc.ephemeris.distanceAu, p[2] / disc.ephemeris.distanceAu];
    // Offsets, so that the planet's own ephemeris error (a couple of arcseconds for Neptune) cancels.
    const got = offsetArcsec(view.direction, planetDirection);
    const expected = offsetArcsec(raDecToUnit(want.ra, want.dec), raDecToUnit(planetWant.ra, planetWant.dec));
    const errorArcsec = Math.hypot(got[0] - expected[0], got[1] - expected[1], got[2] - expected[2]);
    expect(errorArcsec).toBeLessThan(MOON_TOLERANCE_ARCSEC[planet]!);
  });

  it.each(moonCases)('$moon at $iso: hidden, shadowed or crossing as Horizons says', ({ moon, date, want }) => {
    const planet = moonPlanet(moon);
    const disc = planetDisc(planet, date);
    const view = planetMoons(planet, disc, date).find((entry) => entry.moon === moon)!;
    // Horizons judges limb to limb and the app by the moon's centre: within a moon's width
    // (and the orbit's error) of the planet's limb or of the shadow's edge the two may differ.
    const planetRadiusArcsec = disc.equatorialDiameterArcsec / 2;
    const marginArcsec = MOON_TOLERANCE_ARCSEC[planet]! + (moonRadiusKm(moon) / (disc.ephemeris.distanceAu * AU_KM)) * ARCSEC_PER_RAD;
    const nearLimb = Math.abs(want.separationArcsec - planetRadiusArcsec) < marginArcsec + planetRadiusArcsec * (1 - planetShape(planet).axisRatio);
    // 'partly-eclipsed' is Horizons' word for a moon on the shadow's edge; none is in the fixture today.
    if (nearLimb || (want.situation as string) === 'partly-eclipsed') return;
    expect(view.situation).toBe(want.situation);
  });

  it('hides each of Jupiter’s moons at the events picked for the fixture', () => {
    const at = (iso: string, moon: string): string => {
      const date = new Date(iso);
      return planetMoons('jupiter', planetDisc('jupiter', date), date).find((entry) => entry.moon === moon)!.situation;
    };
    expect(at('2026-11-10T03:25:00Z', 'io')).toBe('transit');
    expect(at('2026-11-10T22:50:00Z', 'io')).toBe('eclipsed');
    expect(at('2026-11-11T00:35:00Z', 'io')).toBe('occulted');
    expect(at('2026-11-14T21:10:00Z', 'ganymede')).toBe('eclipsed');
    expect(at('2026-11-16T17:20:00Z', 'callisto')).toBe('occulted');
  });
});

