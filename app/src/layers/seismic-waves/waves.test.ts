import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { paramProblems } from '../params';
import type { NotableQuakeData } from '../quakes-notable/notable';
import type { WaveManifest } from './data';
import { presetEvents } from './events';
import { parseUrlPlayback, spanFor, urlParams } from './waves';
import seismicWaves, { SEISMIC_WAVE_PARAMS } from './layer';

const json = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

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

describe('urlParams', () => {
  const keys = ['tohoku2011', 'sumatra2004'];
  it('asks for the earthquake, the speed and the tints, and pauses at a time given', () => {
    expect(urlParams(parseUrlPlayback('?quake=sumatra2004&t=600&speed=120&shadows=0'), keys, 'tohoku2011')).toEqual({
      quake: 'sumatra2004',
      t: 600,
      playing: false,
      speed: 120,
      shadows: false,
    });
  });

  it('plays the first earthquake when the URL names none, or one not to hand', () => {
    expect(urlParams(parseUrlPlayback(''), keys, 'tohoku2011')).toEqual({ quake: 'tohoku2011', shadows: true });
    expect(urlParams(parseUrlPlayback('?quake=atlantis'), keys, 'tohoku2011')).toEqual({ quake: 'tohoku2011', shadows: true });
    // The latest waits for the feed: the layer chooses it when it comes.
    expect(urlParams(parseUrlPlayback('?quake=latest'), keys, 'tohoku2011').quake).toBe('tohoku2011');
  });

  it('asks only for what the layer takes, so the link and a guide go one way', () => {
    const values = urlParams(parseUrlPlayback('?quake=tohoku2011&t=10800&speed=600'), ['tohoku2011'], 'tohoku2011');
    expect(paramProblems('seismic-waves', SEISMIC_WAVE_PARAMS, values)).toEqual([]);
  });
});

describe('the settings', () => {
  it('offers every fixed earthquake the baked data have, and only those', () => {
    const events = presetEvents(json<NotableQuakeData>('public/geo/quakes-notable.json'), json<WaveManifest>('public/geo/seismic-waves.json').deepEvents);
    expect(SEISMIC_WAVE_PARAMS.quake.values).toEqual(events.map((event) => event.key));
    expect(SEISMIC_WAVE_PARAMS.quake.values).toContain('tohoku2011');
  });

  it('are the definition\'s, and the latest earthquake is not one of them: it is a different one every week', () => {
    expect(seismicWaves.params).toBe(SEISMIC_WAVE_PARAMS);
    expect(SEISMIC_WAVE_PARAMS.quake.values).not.toContain('latest');
    expect(paramProblems('seismic-waves', seismicWaves.params, { quake: 'tohoku2011', t: 0, speed: 120, playing: true, shadows: true })).toEqual([]);
    expect(paramProblems('seismic-waves', seismicWaves.params, { speed: 61 })).toEqual(['seismic-waves speed is one of 30, 60, 120, 600']);
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
