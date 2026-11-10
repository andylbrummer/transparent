import { describe, it, expect } from 'vitest';
import { parseUrlPlayback, spanFor } from './waves';
import seismicWaves from './layer';

describe('parseUrlPlayback', () => {
  it('reads the earthquake, the time and the speed', () => {
    expect(parseUrlPlayback('?quake=tohoku2011&t=600&speed=120')).toEqual({ quake: 'tohoku2011', timeS: 600, speed: 120, shadows: true });
  });

  it('asks for nothing when the URL says nothing', () => {
    expect(parseUrlPlayback('')).toEqual({ quake: null, timeS: null, speed: null, shadows: true });
    expect(parseUrlPlayback('?time=2026-11-09T06:00:00Z')).toEqual({ quake: null, timeS: null, speed: null, shadows: true });
  });

  it('ignores what it cannot use', () => {
    expect(parseUrlPlayback('?t=-5').timeS).toBeNull();
    expect(parseUrlPlayback('?t=soon').timeS).toBeNull();
    expect(parseUrlPlayback('?t=').timeS).toBeNull();
    // Only the speeds the control offers.
    expect(parseUrlPlayback('?speed=61').speed).toBeNull();
    expect(parseUrlPlayback('?t=0').timeS).toBe(0);
  });

  it('can leave the shadow tints off', () => {
    expect(parseUrlPlayback('?shadows=0').shadows).toBe(false);
  });
});

describe('spanFor', () => {
  it('keeps the span when the time fits, else takes the shortest that holds it', () => {
    expect(spanFor(600, 3600)).toBe(3600);
    expect(spanFor(600, 1800)).toBe(1800);
    expect(spanFor(5000, 3600)).toBe(10800);
    expect(spanFor(99999, 3600)).toBe(10800);
  });
});

describe('the layer definition', () => {
  it('is off by default, inside the Earth, and says what it leaves out', () => {
    expect(seismicWaves.id).toBe('seismic-waves');
    expect(seismicWaves.section).toBe('Inside the Earth');
    expect(seismicWaves.defaultOn).toBeUndefined();
    expect(seismicWaves.caption).toMatch(/ak135/);
    expect(seismicWaves.caption).toMatch(/no amplitudes or attenuation/);
    expect(seismicWaves.caption).toMatch(/approximate/);
  });

  it('credits the model, the surface-wave speeds and the catalogue', () => {
    const sources = seismicWaves.credits.map((credit) => credit.source).join(' | ');
    expect(sources).toMatch(/Kennett, Engdahl & Buland \(1995\)/);
    expect(sources).toMatch(/Dziewonski & Anderson \(1981\)/);
    expect(sources).toMatch(/USGS/);
    expect(sources).toMatch(/ISC-GEM/);
  });
});
