import { describe, it, expect } from 'vitest';
import { HORIZONS } from './ephemeris.fixture';
import {
  AU_KM,
  MOON_RADIUS_KM,
  PLANET_NAMES,
  SUN_RADIUS_KM,
  discOrientation,
  julianEphemerisDate,
  moonBodyToIcrs,
  moonEclipticOfDate,
  moonGeocentricKm,
  moonPhase,
  moonPhaseName,
  observerIcrsM,
  planetEphemeris,
  positionAngleDeg,
  separationDeg,
  sunBodyToIcrs,
  sunGeocentricAu,
  surfacePointIcrs,
  ttMinusUtcSeconds,
  type PlanetName,
  type Vec3Tuple,
} from './ephemeris';
import { applyMat3, horizontalFromIcrs, precessionMatrix, raDecToUnit, transposeMat3 } from './index';

const DEG = Math.PI / 180;
const ARCSEC = 1 / 3600;
const instants = HORIZONS.instants.map((iso, index) => ({ iso, index, date: new Date(iso) }));
const wrap180 = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;
const minus = (a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const times = (a: Vec3Tuple, s: number): Vec3Tuple => [a[0] * s, a[1] * s, a[2] * s];
/** Horizons measures position angles from the true north of date; the mean pole of date is within 10″ of it. */
const northOfDate = (date: Date): Vec3Tuple => applyMat3(transposeMat3(precessionMatrix(date)), [0, 0, 1]);

describe('ttMinusUtcSeconds', () => {
  it.each(instants)('matches Horizons TDB−UT at $iso within a second', ({ date, index }) => {
    expect(Math.abs(ttMinusUtcSeconds(date) - HORIZONS.geocentric.sun[index].tdbMinusUt)).toBeLessThan(1);
  });

  it('is exact through the leap seconds', () => {
    expect(ttMinusUtcSeconds(new Date('1972-01-01T00:00:00Z'))).toBeCloseTo(42.184, 9);
    expect(ttMinusUtcSeconds(new Date('1998-12-31T23:59:59Z'))).toBeCloseTo(63.184, 9);
    expect(ttMinusUtcSeconds(new Date('2026-11-09T00:00:00Z'))).toBeCloseTo(69.184, 9);
  });

  it('turns a UTC instant into its Julian Ephemeris Date', () => {
    // TT − UTC was 58.184 s in April 1992, so this instant is 1992 April 12, 0h TT.
    expect(julianEphemerisDate(new Date(Date.UTC(1992, 3, 12) - 58184))).toBeCloseTo(2448724.5, 8);
  });
});

describe('the Sun against JPL Horizons, 1900-2100', () => {
  it.each(instants)('is within 0.2″ and 1e-6 au at $iso', ({ date, index }) => {
    const want = HORIZONS.geocentric.sun[index];
    const sun = sunGeocentricAu(date);
    expect(separationDeg(sun, raDecToUnit(want.ra, want.dec))).toBeLessThan(0.2 * ARCSEC);
    expect(Math.abs(Math.hypot(...sun) - want.distanceAu)).toBeLessThan(1e-6);
  });

  it.each(instants)('has its disc turned as Horizons has it at $iso: B0, P within 0.03°, L0 within 0.15°', ({ date, index }) => {
    const want = HORIZONS.geocentric.sun[index];
    const got = discOrientation(sunBodyToIcrs(date), times(sunGeocentricAu(date), -1), northOfDate(date));
    expect(Math.abs(got.centreLatDeg - want.subObserverLat)).toBeLessThan(0.03);
    expect(Math.abs(wrap180(got.northPoleAngleDeg - want.northPoleAngle))).toBeLessThan(0.03);
    // Horizons turns the Sun at the IAU's rounded 14.1844°/day; Carrington's 25.38 days drifts 0.1° a century from it.
    expect(Math.abs(wrap180(got.centreLonDeg - want.subObserverLon))).toBeLessThan(0.15);
  });

  it('subtends what Horizons says', () => {
    const want = HORIZONS.geocentric.sun[8];
    const diameter = (2 * Math.asin(SUN_RADIUS_KM / (want.distanceAu * AU_KM))) / DEG / ARCSEC;
    expect(Math.abs(diameter - want.angularDiameterArcsec)).toBeLessThan(0.05);
  });

  it.each(instants)('stands where Horizons puts it over Austin at $iso, within 0.01°', ({ date, index }) => {
    const want = HORIZONS.topocentric.sun[index];
    const { lat, lon } = HORIZONS.site;
    const topocentric = minus(times(sunGeocentricAu(date), AU_KM * 1000), observerIcrsM(lat, lon, 0, date));
    expect(separationDeg(topocentric, raDecToUnit(want.ra, want.dec))).toBeLessThan(0.2 * ARCSEC);
    // Azimuth and elevation are apparent: aberration and nutation, which the app's frame leaves out, show here.
    const got = horizontalFromIcrs(topocentric, lat, lon, date);
    expect(Math.abs(got.elevation - want.elevation)).toBeLessThan(0.01);
    expect(Math.abs(wrap180(got.azimuth - want.azimuth)) * Math.cos(want.elevation * DEG)).toBeLessThan(0.01);
  });
});

describe('the planets against JPL Horizons, 1900-2100', () => {
  // Measured maxima: Mercury 0.11″, Venus 0.25″, Mars 0.17″, Jupiter 0.45″, Saturn 0.29″, Uranus 1.9″, Neptune 2.4″.
  const toleranceArcsec: Readonly<Record<PlanetName, number>> = {
    mercury: 0.5,
    venus: 0.5,
    mars: 0.5,
    jupiter: 1,
    saturn: 1,
    uranus: 3,
    neptune: 3,
  };
  const cases = PLANET_NAMES.flatMap((planet) => instants.map((instant) => ({ planet, ...instant })));

  it.each(cases)('$planet at $iso: place, distance, phase', ({ planet, date, index }) => {
    const want = HORIZONS.geocentric[planet][index];
    const got = planetEphemeris(planet, date);
    expect(separationDeg(got.positionAu, raDecToUnit(want.ra, want.dec))).toBeLessThan(toleranceArcsec[planet] * ARCSEC);
    expect(Math.abs(got.distanceAu - want.distanceAu)).toBeLessThan(1e-4);
    expect(Math.abs(got.sunDistanceAu - want.sunDistanceAu)).toBeLessThan(1e-4);
    expect(Math.abs(got.phaseAngleDeg - want.phaseAngle)).toBeLessThan(0.01);
    expect(Math.abs(got.illuminatedFraction * 100 - want.illuminatedPercent)).toBeLessThan(0.01);
  });

  it.each(cases)('$planet at $iso: magnitude', ({ planet, date, index }) => {
    const want = HORIZONS.geocentric[planet][index];
    const got = planetEphemeris(planet, date);
    // Horizons uses Mallama & Hilton's 2018 fits; the 1984 formulae stay within 0.2 mag of them
    // except for a thin crescent of Mercury (phase angle past 150°), lost in the Sun's glare anyway.
    const tolerance = planet === 'mercury' && want.phaseAngle > 150 ? 0.7 : 0.2;
    expect(Math.abs(got.magnitude - want.magnitude)).toBeLessThan(tolerance);
  });
});

describe('the Moon against JPL Horizons, 1900-2100', () => {
  it.each(instants)('is within 6″ and 10 km from the geocentre at $iso', ({ date, index }) => {
    const want = HORIZONS.geocentric.moon[index];
    const moon = moonGeocentricKm(date);
    expect(separationDeg(moon, raDecToUnit(want.ra, want.dec))).toBeLessThan(6 * ARCSEC);
    expect(Math.abs(Math.hypot(...moon) - want.distanceAu * AU_KM)).toBeLessThan(10);
  });

  it.each(instants)('is within 6″ seen from Austin, where parallax moves it up to a degree, at $iso', ({ date, index }) => {
    const want = HORIZONS.topocentric.moon[index];
    const { lat, lon } = HORIZONS.site;
    const topocentric = minus(times(moonGeocentricKm(date), 1000), observerIcrsM(lat, lon, 0, date));
    expect(separationDeg(topocentric, raDecToUnit(want.ra, want.dec))).toBeLessThan(6 * ARCSEC);
    const got = horizontalFromIcrs(topocentric, lat, lon, date);
    expect(Math.abs(got.elevation - want.elevation)).toBeLessThan(0.01);
    expect(Math.abs(wrap180(got.azimuth - want.azimuth)) * Math.cos(want.elevation * DEG)).toBeLessThan(0.01);
    // And the parallax is real: the geocentric place would miss by far more.
    const geocentric = HORIZONS.geocentric.moon[index];
    expect(separationDeg(raDecToUnit(geocentric.ra, geocentric.dec), raDecToUnit(want.ra, want.dec))).toBeGreaterThan(0.1);
  });

  it.each(instants)('shows the phase and bright limb Horizons gives at $iso', ({ date, index }) => {
    const want = HORIZONS.geocentric.moon[index];
    const got = moonPhase(moonGeocentricKm(date), times(sunGeocentricAu(date), AU_KM), northOfDate(date));
    expect(Math.abs(got.illuminatedFraction * 100 - want.illuminatedPercent)).toBeLessThan(0.02);
    expect(Math.abs(got.phaseAngleDeg - want.phaseAngle)).toBeLessThan(0.02);
    // Within a day of new or full the limb's direction swings fast; elsewhere it is steady.
    const tolerance = want.phaseAngle > 170 || want.phaseAngle < 10 ? 0.5 : 0.05;
    expect(Math.abs(wrap180(got.brightLimbAngleDeg - want.subSolarAngle))).toBeLessThan(tolerance);
  });

  it.each(instants)('is turned as Horizons has it at $iso: libration and axis within 0.05°', ({ date, index }) => {
    const want = HORIZONS.geocentric.moon[index];
    const got = discOrientation(moonBodyToIcrs(date), times(moonGeocentricKm(date), -1), northOfDate(date));
    // What is left is the physical libration, which Cassini's laws leave out.
    expect(Math.abs(wrap180(got.centreLonDeg - want.subObserverLon))).toBeLessThan(0.05);
    expect(Math.abs(got.centreLatDeg - want.subObserverLat)).toBeLessThan(0.05);
    expect(Math.abs(wrap180(got.northPoleAngleDeg - want.northPoleAngle))).toBeLessThan(0.05);
  });

  it('subtends what Horizons says', () => {
    const want = HORIZONS.geocentric.moon[8];
    const diameter = (2 * Math.asin(MOON_RADIUS_KM / (want.distanceAu * AU_KM))) / DEG / ARCSEC;
    expect(Math.abs(diameter - want.angularDiameterArcsec)).toBeLessThan(0.1);
  });

  it('reproduces Meeus example 47.a (1992 April 12, 0h TD)', () => {
    const got = moonEclipticOfDate(new Date(Date.UTC(1992, 3, 12) - 58184));
    expect(got.lon / DEG - 360 * Math.floor(got.lon / DEG / 360)).toBeCloseTo(133.162655, 5);
    expect(got.lat / DEG).toBeCloseTo(-3.229126, 5);
    expect(got.distanceKm).toBeCloseTo(368409.7, 1);
  });
});

describe('the total solar eclipse of 2026 August 12, from Burgos', () => {
  // JPL Horizons, observer at 42.34°N 3.70°W, 18:29:00 UTC, astrometric ICRF place and angular diameter.
  // Fetched 2026-11-09 from https://ssd.jpl.nasa.gov/api/horizons.api.
  const date = new Date('2026-08-12T18:29:00Z');
  const horizonsSun = { ra: 142.1106, dec: 14.90555, diameterArcsec: 1893.318 };
  const horizonsMoon = { ra: 142.10709, dec: 14.90561, diameterArcsec: 1957.698 };
  const observer = observerIcrsM(42.34, -3.7, 0, date);
  const sun = minus(times(sunGeocentricAu(date), AU_KM * 1000), observer);
  const moon = minus(times(moonGeocentricKm(date), 1000), observer);

  it('has both bodies where Horizons has them', () => {
    expect(separationDeg(sun, raDecToUnit(horizonsSun.ra, horizonsSun.dec))).toBeLessThan(0.3 * ARCSEC);
    expect(separationDeg(moon, raDecToUnit(horizonsMoon.ra, horizonsMoon.dec))).toBeLessThan(6 * ARCSEC);
  });

  it('puts the Moon wholly over the Sun: totality', () => {
    const sunRadius = Math.asin((SUN_RADIUS_KM * 1000) / Math.hypot(...sun)) / DEG;
    const moonRadius = Math.asin((MOON_RADIUS_KM * 1000) / Math.hypot(...moon)) / DEG;
    expect(sunRadius / ARCSEC).toBeCloseTo(horizonsSun.diameterArcsec / 2, 0);
    expect(moonRadius / ARCSEC).toBeCloseTo(horizonsMoon.diameterArcsec / 2, 0);
    // Horizons: centres 12″ apart, the Moon's disc 32″ wider in radius than the Sun's.
    const separation = separationDeg(sun, moon);
    expect(separation).toBeLessThan(moonRadius - sunRadius);
    expect(separation / ARCSEC).toBeLessThan(20);
  });

  it('is only partial ten minutes earlier', () => {
    const earlier = new Date('2026-08-12T18:19:00Z');
    const at = observerIcrsM(42.34, -3.7, 0, earlier);
    const s = minus(times(sunGeocentricAu(earlier), AU_KM * 1000), at);
    const m = minus(times(moonGeocentricKm(earlier), 1000), at);
    expect(separationDeg(s, m) / ARCSEC).toBeGreaterThan(300);
  });
});

describe('moonPhaseName', () => {
  it('names the eight phases by how far the Moon has run ahead of the Sun', () => {
    expect(moonPhaseName(2)).toBe('New Moon');
    expect(moonPhaseName(358)).toBe('New Moon');
    expect(moonPhaseName(45)).toBe('Waxing crescent');
    expect(moonPhaseName(91)).toBe('First quarter');
    expect(moonPhaseName(130)).toBe('Waxing gibbous');
    expect(moonPhaseName(178)).toBe('Full Moon');
    expect(moonPhaseName(220)).toBe('Waning gibbous');
    expect(moonPhaseName(272)).toBe('Last quarter');
    expect(moonPhaseName(320)).toBe('Waning crescent');
  });

  it('calls the Moon of 2026 November 9 new: Horizons has it 0.4% lit that evening', () => {
    expect(HORIZONS.geocentric.moon[8].illuminatedPercent).toBeLessThan(1);
    const date = new Date(HORIZONS.instants[8]);
    expect(moonPhase(moonGeocentricKm(date), times(sunGeocentricAu(date), AU_KM)).name).toBe('New Moon');
  });
});

describe('positionAngleDeg and surfacePointIcrs', () => {
  it('measures from north through east', () => {
    const at = raDecToUnit(40, 20);
    expect(positionAngleDeg(at, minus(raDecToUnit(40, 21), at))).toBeCloseTo(0, 6);
    expect(positionAngleDeg(at, minus(raDecToUnit(40.5, 20), at))).toBeCloseTo(90, 0);
    expect(positionAngleDeg(at, minus(raDecToUnit(40, 19), at))).toBeCloseTo(180, 6);
  });

  it('puts the disc centre at the sub-observer point and the pole at latitude 90', () => {
    const date = new Date('2026-11-09T18:00:00Z');
    const frame = sunBodyToIcrs(date);
    const toEarth = times(sunGeocentricAu(date), -1);
    const { centreLatDeg, centreLonDeg } = discOrientation(frame, toEarth);
    expect(separationDeg(surfacePointIcrs(frame, centreLatDeg, centreLonDeg), toEarth)).toBeLessThan(1e-6);
    expect(separationDeg(surfacePointIcrs(frame, 90, 0), [frame[2], frame[5], frame[8]])).toBeLessThan(1e-6);
  });
});
