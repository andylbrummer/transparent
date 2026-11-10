import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_M, applyMat3, greenwichMeanSiderealTime, precessionMatrix, transposeMat3 } from '@transparent-earth/core';
import {
  geodeticLatHeight,
  lookAngles,
  parseEpochMs,
  parseGpCsv,
  periodMinutes,
  propagateTeme,
  subPoint,
  sunlitFraction,
  temeToEcef,
  toSatrec,
  toSphericalWorld,
} from './orbit-math';
import { HORIZONS_ISS, REFERENCE_OBSERVER, REFERENCE_SATELLITES, REFERENCE_TIME } from './reference.fixture';

const when = new Date(REFERENCE_TIME);

/** The app's whole chain for one reference satellite: SGP4, the spherical world, the turn to Earth-fixed. */
function place(csv: string): { teme: number[]; world: number[] } {
  const [record] = parseGpCsv(csv);
  const teme = [0, 0, 0, 0, 0, 0];
  expect(propagateTeme(toSatrec(record), record.epochMs, when.getTime(), teme)).toBe(true);
  const inertial = [0, 0, 0];
  toSphericalWorld(teme[0], teme[1], teme[2], inertial);
  const world = [0, 0, 0];
  temeToEcef(inertial[0], inertial[1], inertial[2], greenwichMeanSiderealTime(when), world);
  return { teme, world };
}

describe('parseGpCsv', () => {
  it('reads CelesTrak rows, with or without the columns SGP4 does not need', () => {
    const full =
      'OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,NORAD_CAT_ID,ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT\r\n' +
      'ISS (ZARYA),1998-067A,2026-11-09T11:10:18.771456,15.49275323,.00072858,51.6321,301.1765,6.3021,353.8058,0,U,25544,999,59427,.16254709E-3,.8605E-4,0\r\n' +
      'SOYUZ-MS 29,2026-001A,2026-11-09T11:10:18.771456,15.49275323,.00072858,51.6321,301.1765,6.3021,353.8058,0,U,100057,999,1,.16254709E-3,.8605E-4,0\r\n';
    const records = parseGpCsv(full);
    expect(records.map((r) => r.name)).toEqual(['ISS (ZARYA)', 'SOYUZ-MS 29']);
    // Six-digit catalogue numbers, which the TLE format cannot hold.
    expect(records[1].norad).toBe(100057);
    expect(records[0].bstar).toBeCloseTo(0.00016254709, 12);
    expect(records[0].epochMs).toBeCloseTo(Date.UTC(2026, 10, 9, 11, 10, 18, 771) + 0.456, 3);
    expect(parseGpCsv(REFERENCE_SATELLITES[0].csv)[0].meanMotion).toBe(15.49275323);
  });

  it('refuses what is not GP data and drops rows that do not parse', () => {
    expect(() => parseGpCsv('GP data has not updated since your last successful download of GROUP=active')).toThrow(/not GP data/);
    expect(() => parseGpCsv('OBJECT_NAME,EPOCH\nX,2026-01-01T00:00:00')).toThrow(/NORAD_CAT_ID/);
    const [header, row] = REFERENCE_SATELLITES[0].csv.split('\n');
    expect(parseGpCsv(`${header}\n${row}\nBROKEN,1,not-a-date,1,2,3\n${row.replace('15.49275323', 'fifteen')}\n`)).toHaveLength(1);
  });

  it('keeps the microseconds of an epoch', () => {
    expect(parseEpochMs('2026-11-09T11:10:18.771456') - Date.UTC(2026, 10, 9, 11, 10, 18)).toBeCloseTo(771.456, 3);
    expect(parseEpochMs('2026-11-09T11:10:18')).toBe(Date.UTC(2026, 10, 9, 11, 10, 18));
  });
});

describe('propagation against python sgp4', () => {
  it.each(REFERENCE_SATELLITES.map((s) => [s.name, s] as const))('%s: the same TEME state', (_name, reference) => {
    const { teme } = place(reference.csv);
    // Kilometres: the two SGP4s agree to metres.
    for (let i = 0; i < 3; i++) expect(Math.abs(teme[i] - reference.temeKm[i])).toBeLessThan(0.02);
    for (let i = 0; i < 3; i++) expect(Math.abs(teme[3 + i] - reference.temeKmS[i])).toBeLessThan(2e-5);
  });

  it.each(REFERENCE_SATELLITES.map((s) => [s.name, s] as const))('%s: the same ground point, height and place in the sky', (_name, reference) => {
    const { world } = place(reference.csv);
    const point = subPoint(world[0], world[1], world[2]);
    expect(point.lat).toBeCloseTo(reference.lat, 3);
    expect(point.lon).toBeCloseTo(reference.lon, 3);
    expect(Math.abs(point.heightKm - reference.heightKm)).toBeLessThan(0.02);
    // The app's Earth is a sphere: from Austin a satellite stands within 0.1° of where it does over the real ellipsoid.
    const look = lookAngles(world[0], world[1], world[2], REFERENCE_OBSERVER.lat, REFERENCE_OBSERVER.lon);
    const cosEl = Math.cos((reference.elevation * Math.PI) / 180);
    expect(Math.abs(look.azimuth - reference.azimuth) * cosEl).toBeLessThan(0.1);
    expect(Math.abs(look.elevation - reference.elevation)).toBeLessThan(0.1);
    expect(Math.abs(look.rangeKm - reference.rangeKm) / reference.rangeKm).toBeLessThan(0.002);
  });

  it('GOES 19 keeps station at 75.2°W, 35,786 km up', () => {
    const goes = REFERENCE_SATELLITES.find((s) => s.name === 'GOES 19')!;
    const [record] = parseGpCsv(goes.csv);
    const satrec = toSatrec(record);
    const teme = [0, 0, 0, 0, 0, 0];
    const inertial = [0, 0, 0];
    const world = [0, 0, 0];
    for (let hour = 0; hour <= 24; hour += 3) {
      const date = new Date(when.getTime() + hour * 3600000);
      expect(propagateTeme(satrec, record.epochMs, date.getTime(), teme)).toBe(true);
      toSphericalWorld(teme[0], teme[1], teme[2], inertial);
      temeToEcef(inertial[0], inertial[1], inertial[2], greenwichMeanSiderealTime(date), world);
      const point = subPoint(world[0], world[1], world[2]);
      expect(Math.abs(point.lon + 75.2)).toBeLessThan(0.1);
      expect(Math.abs(point.lat)).toBeLessThan(0.1);
      expect(Math.abs(point.heightKm - 35786)).toBeLessThan(25);
    }
    expect(periodMinutes(record.meanMotion)).toBeCloseTo(1436.07, 0);
  });
});

describe('against JPL Horizons', () => {
  it('puts the ISS where Horizons does, in the sky over Austin and among the stars', () => {
    const iss = REFERENCE_SATELLITES[0];
    const { teme, world } = place(iss.csv);
    const look = lookAngles(world[0], world[1], world[2], REFERENCE_OBSERVER.lat, REFERENCE_OBSERVER.lon);
    expect(Math.abs(look.azimuth - HORIZONS_ISS.azimuth)).toBeLessThan(0.15);
    expect(Math.abs(look.elevation - HORIZONS_ISS.elevation)).toBeLessThan(0.1);
    // TEME is the equator and equinox of date: undo precession to compare with Horizons' ICRF vector.
    const icrf = applyMat3(transposeMat3(precessionMatrix(when)), [teme[0], teme[1], teme[2]]);
    const miss = Math.hypot(icrf[0] - HORIZONS_ISS.icrfKm[0], icrf[1] - HORIZONS_ISS.icrfKm[1], icrf[2] - HORIZONS_ISS.icrfKm[2]);
    // Horizons keeps its own TLE-based ISS trajectory; nutation, left out here, is worth up to 0.6 km at this radius.
    expect(miss).toBeLessThan(3);
  });
});

describe('geometry', () => {
  it('finds geodetic latitude and height at the equator, the pole and between', () => {
    const out = [0, 0];
    geodeticLatHeight(6378.137 + 400, 0, out);
    expect(out[0]).toBeCloseTo(0, 12);
    expect(out[1]).toBeCloseTo(400, 6);
    geodeticLatHeight(0, 6356.7523142 + 800, out);
    expect(out[0]).toBeCloseTo(Math.PI / 2, 9);
    expect(out[1]).toBeCloseTo(800, 4);
    // 45°N, 500 km up, from the forward formula.
    const lat = Math.PI / 4;
    const e2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);
    const n = 6378.137 / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    geodeticLatHeight((n + 500) * Math.cos(lat), (n * (1 - e2) + 500) * Math.sin(lat), out);
    expect(out[0]).toBeCloseTo(lat, 10);
    expect(out[1]).toBeCloseTo(500, 6);
  });

  it('puts a point over its geodetic ground point at its height above the sphere', () => {
    const out = [0, 0, 0];
    toSphericalWorld(0, 6378.137 + 420, 0, out);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(EARTH_RADIUS_M + 420000, 3);
    toSphericalWorld(0, 0, -(6356.7523142 + 420), out);
    expect(out[2]).toBeCloseTo(-(EARTH_RADIUS_M + 420000), 0);
    expect(Math.hypot(out[0], out[1])).toBeLessThan(1e-3);
  });

  it('knows sunlight from the Earth’s shadow', () => {
    const sun = [1, 0, 0] as const;
    const leo = EARTH_RADIUS_M + 400e3;
    expect(sunlitFraction(leo, 0, 0, sun)).toBe(1);
    expect(sunlitFraction(-leo, 0, 0, sun)).toBe(0);
    // Over the terminator, and well clear of the shadow on the night side.
    expect(sunlitFraction(0, leo, 0, sun)).toBe(1);
    expect(sunlitFraction(-leo, 0, EARTH_RADIUS_M + 2000e3, sun)).toBe(1);
    // The umbra narrows with distance: 42,164 km behind the Earth its radius is about 6,177 km.
    expect(sunlitFraction(-42164e3, 6100e3, 0, sun)).toBe(0);
    expect(sunlitFraction(-42164e3, 6300e3, 0, sun)).toBeGreaterThan(0);
    expect(sunlitFraction(-42164e3, 6300e3, 0, sun)).toBeLessThan(1);
    expect(sunlitFraction(-42164e3, 6600e3, 0, sun)).toBe(1);
  });
});
