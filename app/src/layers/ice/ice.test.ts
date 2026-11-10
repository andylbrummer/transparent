import { describe, it, expect } from 'vitest';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import ICE_LAYERS, { BED_RAMP, THICKNESS_RAMP, rampGradient } from './layer';
import { extremeLabel, metresText, rampColor, rampGlsl, type AntarcticIceData } from './antarctic';
import { areaText, glslColor, iceLabelText } from './glaciers';
import { MAX_GAP_DAYS, dayText, lineSegmentPositions, pickDay, poleLabelText, seaIceStatus, type PoleIce, type SeaIceDay } from './sea-ice';

const pole = (extentMkm2: number | null = 8.58, medianMkm2: number | null = 10.194): PoleIce => ({ extentMkm2, medianMkm2, edge: [], median: [] });
const day = (date: string): SeaIceDay => ({ date, north: pole(), south: pole() });
const DAYS = [day('2025-11-15'), day('2025-12-01'), day('2026-01-15'), day('2026-02-01'), day('2026-11-01'), day('2026-11-08')];
const at = (iso: string): number => Date.parse(iso);

describe('the ice layers', () => {
  it('are two Surface layers, off by default, credited', () => {
    expect(ICE_LAYERS.map((l) => l.id)).toEqual(['glaciers', 'sea-ice-extent', 'antarctic-ice-thickness', 'antarctic-bed']);
    for (const layer of ICE_LAYERS) {
      expect(layer.section).toBe('Surface');
      expect(layer.defaultOn).toBeUndefined();
      expect(layer.credits.length).toBe(1);
    }
  });

  it('show one of the two maps of Antarctica at a time', () => {
    expect(ICE_LAYERS.filter((l) => l.exclusiveGroup === 'antarctic-ice').map((l) => l.id)).toEqual(['antarctic-ice-thickness', 'antarctic-bed']);
  });
});

describe('the Antarctic ramps', () => {
  it('put each legend stop where its value falls along the bar', () => {
    expect(rampGradient(THICKNESS_RAMP)).toBe(
      'linear-gradient(to right, #eefcff 0.0%, #9bdcf2 20.8%, #4a9bdc 41.7%, #3d55bd 62.5%, #5a2ea3 83.3%, #2b1058 100.0%)'
    );
    expect(rampGradient(BED_RAMP)).toContain('#d8ecf5 38.5%');
  });

  it('colour a value as the legend does: exact at the stops, between them between', () => {
    expect(rampColor(THICKNESS_RAMP, 0)).toEqual([0xee, 0xfc, 0xff]);
    expect(rampColor(THICKNESS_RAMP, 2000)).toEqual([0x4a, 0x9b, 0xdc]);
    expect(rampColor(THICKNESS_RAMP, 9000)).toEqual([0x2b, 0x10, 0x58]);
    expect(rampColor(BED_RAMP, -9000)).toEqual([0x0b, 0x2a, 0x6b]);
    expect(rampColor(BED_RAMP, 0)).toEqual([0xd8, 0xec, 0xf5]);
    expect(rampColor(BED_RAMP, 250)[2]).toBeCloseTo((0xf5 + 0x8f) / 2, 6);
  });

  it('write the shader ramp from the same stops', () => {
    const glsl = rampGlsl(BED_RAMP);
    expect(glsl).toContain('vec3 ramp(float v)');
    expect(glsl).toContain('clamp((v - -2500.0) / 1500.0, 0.0, 1.0)');
    expect(glsl.match(/mix\(/g)?.length).toBe(BED_RAMP.length - 1);
  });

  it('label the extremes with their figures', () => {
    const data: AntarcticIceData = {
      strip: { width: 2048, height: 256, latTop: -58, latBottom: -90 },
      thickness: { stepM: 20, offsetM: 0 },
      bed: { stepM: 34, offsetM: -3600 },
      thickestIce: { metres: 4757, lon: 118.378, lat: -76.052 },
      deepestBedUnderGroundedIce: { metres: -2973, lon: 155.582, lat: -80.708 },
      meanThicknessM: 1954,
    };
    expect(extremeLabel('thickness', data)).toEqual({ text: 'Thickest ice · 4,757 m', lon: 118.378, lat: -76.052 });
    expect(extremeLabel('bed', data).text).toBe('Deepest bed under grounded ice · −2,973 m');
    expect(metresText(0)).toBe('0 m');
  });
});

describe('glacier labels', () => {
  it('give areas to two significant figures', () => {
    expect(areaText(12_059_453)).toBe('12 million km²');
    expect(areaText(1_771_070)).toBe('1.8 million km²');
    expect(areaText(501_088)).toBe('500,000 km²');
    expect(areaText(8492)).toBe('8,500 km²');
    expect(areaText(143)).toBe('140 km²');
    expect(areaText(999_600)).toBe('1 million km²');
  });

  it('name the body and its area', () => {
    expect(iceLabelText({ name: 'Vatnajökull', kind: 'glacier', lon: -16.55, lat: 64.37, areaKm2: 8492 })).toBe('Vatnajökull · 8,500 km²');
  });

  it('write a CSS colour as a GLSL vec3 of floats', () => {
    expect(glslColor('#ff8000')).toBe('vec3(1.0000, 0.5020, 0.0000)');
  });
});

describe('pickDay', () => {
  it('shows the baked day nearest the clock', () => {
    expect(pickDay(DAYS, at('2026-11-08T03:00:00Z'))).toEqual({ day: DAYS[5], ageDays: 0 });
    expect(pickDay(DAYS, at('2026-11-03T12:00:00Z'))).toEqual({ day: DAYS[4], ageDays: 2 });
    expect(pickDay(DAYS, at('2026-01-22T12:00:00Z'))).toEqual({ day: DAYS[2], ageDays: 7 });
    expect(pickDay(DAYS, at('2026-01-25T12:00:00Z'))).toEqual({ day: DAYS[3], ageDays: -7 });
  });

  it('keeps the newest day once the clock has passed it, with its age', () => {
    expect(pickDay(DAYS, at('2026-12-25T12:00:00Z'))).toEqual({ day: DAYS[5], ageDays: 47 });
  });

  it('shows nothing before the first baked day, or in a hole between days', () => {
    expect(pickDay(DAYS, at('2025-10-01T12:00:00Z'))).toBeNull();
    expect(pickDay(DAYS, at('2026-06-01T12:00:00Z'))).toBeNull();
    expect(pickDay([], at('2026-06-01T12:00:00Z'))).toBeNull();
    // The first day reaches back as far as any other reaches.
    expect(pickDay(DAYS, at('2025-11-15T12:00:00Z') - MAX_GAP_DAYS * 86_400_000)?.day).toBe(DAYS[0]);
  });
});

describe('seaIceStatus', () => {
  it('always names the baked day and never says live', () => {
    expect(seaIceStatus({ day: DAYS[5], ageDays: 0 }, DAYS)).toEqual({ text: 'snapshot · 8 Nov 2026', tone: 'stale' });
    expect(seaIceStatus({ day: DAYS[4], ageDays: -3 }, DAYS)).toEqual({ text: 'snapshot · 1 Nov 2026', tone: 'stale' });
  });

  it('owns up to the age of a day the clock has left behind', () => {
    expect(seaIceStatus({ day: DAYS[5], ageDays: 47 }, DAYS)).toEqual({ text: 'snapshot · 8 Nov 2026 · 47 d old', tone: 'stale' });
  });

  it('says which days it has when it has none for the date', () => {
    expect(seaIceStatus(null, DAYS)).toEqual({ text: 'no data for this date · baked 15 Nov 2025 – 8 Nov 2026', tone: 'error' });
  });
});

describe('labels and lines', () => {
  it('write the extent with its median and day', () => {
    expect(dayText('2026-11-08')).toBe('8 Nov 2026');
    expect(poleLabelText('Arctic', pole(), '2026-11-08')).toBe('Arctic sea ice 8.58 M km² · 1981–2010 median 10.19 · 8 Nov 2026');
    expect(poleLabelText('Antarctic', pole(null, null), '2026-11-08')).toBe('Antarctic sea ice · 8 Nov 2026');
  });

  it('turn encoded polylines into segments on the sphere', () => {
    // Two lines: three vertices (two segments) and two vertices (one segment).
    const positions = lineSegmentPositions([
      [0, 9000, 0, 0, 9000, 0],
      [18000, 0, -9000, 0],
    ]);
    expect(positions.length).toBe(3 * 6);
    const point = (i: number): number[] => Array.from(positions.slice(i * 3, i * 3 + 3)).map((v) => v / EARTH_RADIUS_M);
    const expectPoint = (i: number, xyz: number[]): void => point(i).forEach((v, k) => expect(v).toBeCloseTo(xyz[k], 6));
    expectPoint(0, [0, 0, 1]);
    expectPoint(1, [1, 0, 0]);
    expectPoint(2, [1, 0, 0]);
    expectPoint(3, [0, 1, 0]);
    expectPoint(4, [-1, 0, 0]);
    expectPoint(5, [0, -1, 0]);
  });
});
