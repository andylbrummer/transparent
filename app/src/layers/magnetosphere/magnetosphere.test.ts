import { describe, expect, it } from 'vitest';
import { magneticFieldEcef } from '@transparent-earth/core';
import { GRID_HEIGHT, GRID_WIDTH, parseOvation } from './aurora';
import { SURFACE_KM, dipoleFootpoints, geomagneticLatitude, outwardSign, strengthColor, traceFieldLine } from './field-lines';
import layers from './layer';
import { FOOT_LATITUDES, OUTER_RADII, modelYear, traceCage } from './magnetic-field';
import { windText } from './magnetopause';
import {
  dynamicPressureNPa,
  parseHemisphericPower,
  parseKp,
  parseSolarWind,
  parseSwpcTime,
  readingStatus,
  shueMagnetopause,
  shueRadius,
} from './space-weather';

const YEAR = 2026.9;
const bounds = { minRadiusKm: SURFACE_KM, maxRadiusKm: SURFACE_KM * OUTER_RADII };

describe('field lines', () => {
  it('arches from one hemisphere to the other, about as high as a dipole says', () => {
    const [foot] = dipoleFootpoints([60], 1, YEAR, SURFACE_KM + 1);
    expect(geomagneticLatitude(foot, YEAR)).toBeCloseTo(60, 6);
    const line = traceFieldLine(foot, outwardSign(foot, YEAR), YEAR, bounds);
    expect(line.end).toBe('inner');
    let apex = 0;
    for (let i = 0; i < line.strengths.length; i++) apex = Math.max(apex, Math.hypot(line.points[i * 3], line.points[i * 3 + 1], line.points[i * 3 + 2]));
    // A dipole line from 60° reaches 1/cos²60° = 4 radii; the real field is lumpier and offset.
    expect(apex / SURFACE_KM).toBeGreaterThan(3.3);
    expect(apex / SURFACE_KM).toBeLessThan(4.8);
    const n = line.strengths.length;
    const last: [number, number, number] = [line.points[n * 3 - 3], line.points[n * 3 - 2], line.points[n * 3 - 1]];
    // The last, short step is cut straight: within a few hundred metres of the bound.
    expect(Math.abs(Math.hypot(...last) - SURFACE_KM)).toBeLessThan(0.5);
    const landing = geomagneticLatitude(last, YEAR);
    expect(landing).toBeLessThan(-52);
    expect(landing).toBeGreaterThan(-68);
  });

  it('is tangent to the field all the way', () => {
    const [foot] = dipoleFootpoints([50], 1, YEAR, SURFACE_KM + 1);
    const sign = outwardSign(foot, YEAR);
    const line = traceFieldLine(foot, sign, YEAR, bounds);
    const b = [0, 0, 0];
    for (let i = 0; i < line.strengths.length - 2; i++) {
      const o = i * 3;
      const chord = [line.points[o + 3] - line.points[o], line.points[o + 4] - line.points[o + 1], line.points[o + 5] - line.points[o + 2]];
      // The field at the middle of a chord points along it.
      magneticFieldEcef(line.points[o] + chord[0] / 2, line.points[o + 1] + chord[1] / 2, line.points[o + 2] + chord[2] / 2, YEAR, b);
      const cosine = (sign * (chord[0] * b[0] + chord[1] * b[1] + chord[2] * b[2])) / (Math.hypot(...chord) * Math.hypot(...b));
      expect(cosine).toBeGreaterThan(0.9999);
      expect(line.strengths[i]).toBeGreaterThan(0);
    }
  });

  it('leaves the drawing from near the pole', () => {
    const [foot] = dipoleFootpoints([82], 1, YEAR, SURFACE_KM + 1);
    const line = traceFieldLine(foot, outwardSign(foot, YEAR), YEAR, bounds);
    expect(line.end).toBe('outer');
    const n = line.strengths.length;
    expect(Math.abs(Math.hypot(line.points[n * 3 - 3], line.points[n * 3 - 2], line.points[n * 3 - 1]) - SURFACE_KM * OUTER_RADII)).toBeLessThan(1);
    // In the north the field goes into the ground: outward is against it.
    expect(outwardSign(foot, YEAR)).toBe(-1);
  });

  it('builds a cage: closed arches from every low footpoint, open rings in both hemispheres', async () => {
    const cage = await traceCage(YEAR);
    const closed = cage.filter((line) => line.end === 'inner').length;
    const open = cage.filter((line) => line.end === 'outer');
    expect(cage.every((line) => line.end !== 'steps')).toBe(true);
    expect(closed).toBeGreaterThanOrEqual(18 * (FOOT_LATITUDES.length - 3));
    const north = open.filter((line) => line.points[2] > 0).length;
    expect(north).toBeGreaterThanOrEqual(18 * 2);
    expect(open.length - north).toBeGreaterThanOrEqual(18 * 2);
    const points = cage.reduce((sum, line) => sum + line.strengths.length, 0);
    expect(points).toBeLessThan(40000);
  });

  it('colours by strength and holds the model to its years', () => {
    const weak = [0, 0, 0];
    const strong = [0, 0, 0];
    expect(strengthColor(100, weak)).toBe(0);
    expect(strengthColor(60000, strong)).toBeCloseTo(0.99, 1);
    expect(weak[2]).toBeGreaterThan(weak[0]);
    expect(strong[0]).toBeGreaterThan(strong[2]);
    expect(modelYear(new Date('2026-11-09T00:00:00Z')).inRange).toBe(true);
    expect(modelYear(new Date('2031-06-01T00:00:00Z'))).toEqual({ year: 2030, inRange: false });
    expect(modelYear(new Date('2020-06-01T00:00:00Z'))).toEqual({ year: 2025, inRange: false });
  });
});

describe('solar wind and the magnetopause', () => {
  const header = ['time_tag', 'speed', 'density', 'temperature', 'bx', 'by', 'bz', 'bt', 'vx', 'vy', 'vz', 'propagated_time_tag'];
  const row = (minute: number, speed: number | null, density: number | null, bz: number | null): unknown[] => [
    `2026-11-10T00:${String(minute).padStart(2, '0')}:00Z`,
    speed,
    density,
    296179,
    1.7,
    -3.2,
    bz,
    4.1,
    -670,
    -48,
    -65,
    `2026-11-10T01:${String(minute).padStart(2, '0')}:30Z`,
  ];

  it('averages the last complete minutes of SWPC’s propagated solar wind', () => {
    const wind = parseSolarWind([header, row(1, 500, 4, -2), row(2, 700, 2, 2), row(3, null, 2, 1), row(4, 600, 3, 3)]);
    expect(wind).not.toBeNull();
    expect(wind!.speedKmS).toBeCloseTo(600, 9);
    expect(wind!.densityCm3).toBeCloseTo(3, 9);
    expect(wind!.bzNt).toBeCloseTo(1, 9);
    // When the newest plasma reaches the Earth.
    expect(wind!.timeMs).toBe(Date.UTC(2026, 10, 10, 1, 4, 30));
  });

  it('refuses fill values and feeds it does not know', () => {
    expect(parseSolarWind([header, row(1, -9999, 4, 1), row(2, 500, 99999, 1)])).toBeNull();
    expect(parseSolarWind([['time_tag', 'speed'], ['2026-11-10T00:00:00Z', 500]])).toBeNull();
    expect(parseSolarWind({ error: 'no' })).toBeNull();
  });

  it('puts the nose where Shue et al. (1998) do', () => {
    // Their nominal case: Bz = 0, 2 nPa. r0 = (10.22 + 1.29 tanh(0.184 × 8.14)) × 2^(-1/6.6).
    const quiet = shueMagnetopause(0, 2);
    // tanh(1.4977) = 0.9048, so 11.387 × 0.9003.
    expect(quiet.r0).toBeCloseTo(10.252, 2);
    expect(quiet.alpha).toBeCloseTo(0.58965, 4);
    expect(shueRadius(quiet, 0)).toBeCloseTo(quiet.r0, 12);
    // At the terminator the surface is 2^alpha times further out.
    expect(shueRadius(quiet, Math.PI / 2) / quiet.r0).toBeCloseTo(2 ** quiet.alpha, 12);
    // A storm: strong southward field and high pressure push it inside geostationary orbit (6.6 radii).
    expect(shueMagnetopause(-20, 20).r0).toBeLessThan(6.6);
    // More pressure, closer nose; southward field erodes it.
    expect(shueMagnetopause(0, 8).r0).toBeLessThan(quiet.r0);
    expect(shueMagnetopause(-10, 2).r0).toBeLessThan(quiet.r0);
  });

  it('works out the wind’s pressure and says what it shows', () => {
    // 5 protons/cm³ at 400 km/s: the textbook quiet wind, about 1.6 nPa.
    expect(dynamicPressureNPa(5, 400)).toBeCloseTo(1.552, 3);
    expect(windText({ timeMs: 0, speedKmS: 675.4, densityCm3: 1.83, bzNt: -0.91 })).toMatch(/^nose 1\d\.\d R⊕ · wind 675 km\/s, 1\.8 \/cm³, Bz −0\.9 nT$/);
  });
});

describe('aurora and indices', () => {
  it('lays the OVATION grid out like the globe’s textures', () => {
    const coordinates: number[][] = [];
    for (let lon = 0; lon < 360; lon++) for (let lat = -90; lat <= 90; lat++) coordinates.push([lon, lat, lon === 250 && lat === 65 ? 80 : lon === 0 && lat === -70 ? 7 : 0]);
    const grid = parseOvation({ 'Observation Time': '2026-11-10T01:42:00Z', 'Forecast Time': '2026-11-10T02:21:00Z', coordinates });
    expect(grid).not.toBeNull();
    expect(grid!.forecastMs).toBe(Date.UTC(2026, 10, 10, 2, 21));
    expect(grid!.percent.length).toBe(GRID_WIDTH * GRID_HEIGHT);
    // 250°E is 110°W: column 70. 65°N: row 155.
    expect(grid!.percent[155 * GRID_WIDTH + 70]).toBe(80);
    // Greenwich is the middle column; 70°S is row 20.
    expect(grid!.percent[20 * GRID_WIDTH + 180]).toBe(7);
    expect(grid!.percent.reduce((sum, v) => sum + v, 0)).toBe(87);
  });

  it('refuses a grid with holes or without its times', () => {
    expect(parseOvation({ 'Observation Time': '2026-11-10T01:42:00Z', 'Forecast Time': '2026-11-10T02:21:00Z', coordinates: [[0, 0, 5]] })).toBeNull();
    expect(parseOvation({ coordinates: [] })).toBeNull();
    expect(parseOvation(null)).toBeNull();
  });

  it('reads the K index, the hemispheric power and SWPC’s time tags', () => {
    expect(parseKp([{ time_tag: '2026-11-09T18:00:00', Kp: 1.67 }, { time_tag: '2026-11-09T21:00:00', Kp: 2.0, a_running: 7 }])).toEqual({
      timeMs: Date.UTC(2026, 10, 9, 21),
      kp: 2,
    });
    expect(parseKp([['time_tag', 'Kp'], ['2026-11-09 21:00:00.000', '2.33']])).toEqual({ timeMs: Date.UTC(2026, 10, 9, 21), kp: 2.33 });
    expect(parseKp([])).toBeNull();
    const text = '# Observation        Forecast\n#----\n2026-11-10_02:00    2026-11-10_02:36      15      12\n2026-11-10_02:05    2026-11-10_02:41      14      13\n';
    expect(parseHemisphericPower(text)).toEqual({ north: 14, south: 13 });
    expect(parseHemisphericPower('# nothing yet\n')).toBeNull();
    expect(parseSwpcTime('2026-11-10T02:43:34Z')).toBe(Date.UTC(2026, 10, 10, 2, 43, 34));
    expect(parseSwpcTime('2026-11-10T01:44:00')).toBe(Date.UTC(2026, 10, 10, 1, 44));
    expect(Number.isNaN(parseSwpcTime(null))).toBe(true);
  });

  it('says how current a reading is', () => {
    const t = Date.UTC(2026, 10, 10, 2, 52);
    expect(readingStatus('forecast', t, true, t - 30 * 60000, 'Kp 2.0')).toEqual({ text: 'live · 02:52 UTC · Kp 2.0', tone: 'live' });
    expect(readingStatus('forecast', t, true, t - 15 * 3600000)).toEqual({ text: 'forecast of 10 Nov 02:52 UTC', tone: 'stale' });
    expect(readingStatus('solar wind', t, false, t)).toEqual({ text: 'offline · solar wind of 10 Nov 2026', tone: 'stale' });
  });
});

describe('layer definitions', () => {
  it('are off by default, in Near space, and say when they are models', () => {
    expect(layers.map((layer) => layer.id)).toEqual(['magnetic-field', 'magnetopause', 'aurora']);
    for (const layer of layers) {
      expect(layer.section).toBe('Near space');
      expect(layer.defaultOn).toBeUndefined();
      expect(layer.credits.length).toBeGreaterThan(0);
    }
    expect(layers[1].label).toMatch(/model/);
    expect(layers[1].caption).toMatch(/^MODEL/);
  });
});
