import { beforeAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { EARTH_RADIUS_M, PLANET_NAMES, enuBasis, raDecToUnit } from '@transparent-earth/core';
import { HORIZONS } from '@transparent-earth/core/astro/ephemeris.fixture';
import { createLookController } from '../input/look';
import { earthPoint } from '../render/earth-point';
import { LabelLayer, type LabelData, type PlaceLabel } from '../render/labels';
import type { SurfacePosition } from '../sensors';
import type { Target } from './actions';
import { horizonOf, indexLabels, loadBodyPositions, targetDirection, targetKey, targetName, type LabelIndex } from './targets';

const austin: SurfacePosition = HORIZONS.site;
const instants = HORIZONS.instants.map((iso, index) => ({ iso, index, date: new Date(iso) }));
const noLabels: LabelIndex = new Map();
const when = new Date('2026-11-09T06:00:00Z');

// The body targets wait on the ephemeris, loaded with the first of them in the app; body-positions.test.ts covers before.
beforeAll(() => loadBodyPositions());

/** The direction to `target`, failing the test if it does not resolve; checks it is a unit vector. */
function direction(target: Target, position: SurfacePosition = austin, date: Date = when, labels: LabelIndex = noLabels): THREE.Vector3 {
  const result = targetDirection(target, position, date, labels);
  if (!result.ok) throw new Error(result.message);
  expect(Math.abs(result.direction.length() - 1)).toBeLessThan(1e-12);
  return result.direction;
}

const degreesBetween = (a: THREE.Vector3, b: THREE.Vector3): number => THREE.MathUtils.radToDeg(a.angleTo(b));
const enu = (position: SurfacePosition) => {
  const { e, n, u } = enuBasis({ lat: position.lat, lon: position.lon, alt: 0 });
  return { e: new THREE.Vector3(e.x, e.y, e.z), n: new THREE.Vector3(n.x, n.y, n.z), u: new THREE.Vector3(u.x, u.y, u.z) };
};

describe('targetDirection: horizon', () => {
  it.each([
    { where: 'on the equator at the prime meridian', position: { lat: 0, lon: 0 } },
    { where: 'at Austin', position: austin },
  ])('points north, east, up and down along the local frame $where', ({ position }) => {
    const { e, n, u } = enu(position);
    expect(direction({ kind: 'horizon', azDeg: 0, altDeg: 0 }, position).distanceTo(n)).toBeLessThan(1e-9);
    expect(direction({ kind: 'horizon', azDeg: 90, altDeg: 0 }, position).distanceTo(e)).toBeLessThan(1e-9);
    expect(direction({ kind: 'horizon', azDeg: 0, altDeg: 90 }, position).distanceTo(u)).toBeLessThan(1e-9);
    expect(direction({ kind: 'horizon', azDeg: 0, altDeg: -90 }, position).distanceTo(u.clone().negate())).toBeLessThan(1e-9);
  });
});

describe('horizonOf', () => {
  /** How far apart two azimuths are round the circle, degrees. */
  const azGap = (a: number, b: number): number => Math.abs(((((a - b + 180) % 360) + 360) % 360) - 180);

  it.each([0, 90, 270, 359.5].flatMap((azDeg) => [-60, 0, 45].map((altDeg) => ({ azDeg, altDeg }))))(
    'gives back the azimuth $azDeg and altitude $altDeg a horizon target was made from',
    ({ azDeg, altDeg }) => {
      const back = horizonOf(direction({ kind: 'horizon', azDeg, altDeg }), austin);
      expect(azGap(back.azDeg, azDeg)).toBeLessThan(1e-9);
      expect(Math.abs(back.altDeg - altDeg)).toBeLessThan(1e-9);
    }
  );

  it.each([
    { way: 'up', altDeg: 90 },
    { way: 'down', altDeg: -90 },
  ])('gives straight $way an azimuth of 0, not -0', ({ altDeg }) => {
    const back = horizonOf(direction({ kind: 'horizon', azDeg: 123, altDeg }), austin);
    expect(Object.is(back.azDeg, 0)).toBe(true);
    expect(back.altDeg).toBeCloseTo(altDeg, 9);
  });

  it('keeps an azimuth a hair west of north in [0, 360)', () => {
    for (const azDeg of [359.999999, 360 - 1e-12]) {
      const back = horizonOf(direction({ kind: 'horizon', azDeg, altDeg: 0 }), austin);
      expect(back.azDeg).toBeGreaterThanOrEqual(0);
      expect(back.azDeg).toBeLessThan(360);
      expect(azGap(back.azDeg, azDeg)).toBeLessThan(1e-9);
    }
  });
});

describe('targetDirection against JPL Horizons, from Austin', () => {
  // Horizons gives apparent places (aberration, nutation); the app draws astrometric ones on the mean sky, about 0.01° apart.
  it.each(instants)('puts the Sun where Horizons sees it at $iso, within 0.02°', ({ date, index }) => {
    const want = HORIZONS.topocentric.sun[index];
    const seen = direction({ kind: 'horizon', azDeg: want.azimuth, altDeg: want.elevation }, austin, date);
    expect(degreesBetween(direction({ kind: 'body', body: 'sun' }, austin, date), seen)).toBeLessThan(0.02);
  });

  it.each(instants)('puts the Moon where Horizons sees it from Austin at $iso, parallax and all, within 0.02°', ({ date, index }) => {
    const want = HORIZONS.topocentric.moon[index];
    const seen = direction({ kind: 'horizon', azDeg: want.azimuth, altDeg: want.elevation }, austin, date);
    expect(degreesBetween(direction({ kind: 'body', body: 'moon' }, austin, date), seen)).toBeLessThan(0.02);
  });

  it('shifts the Moon from where the Earth’s centre sees it', () => {
    const { index, date } = instants[7];
    const geocentric = HORIZONS.geocentric.moon[index];
    const fromCentre = direction({ kind: 'sky', raDeg: geocentric.ra, decDeg: geocentric.dec }, austin, date);
    expect(degreesBetween(direction({ kind: 'body', body: 'moon' }, austin, date), fromCentre)).toBeGreaterThan(0.1);
  });

  it.each(PLANET_NAMES.flatMap((planet) => instants.map((instant) => ({ planet, ...instant }))))(
    'puts $planet where the Earth’s centre sees it at $iso, within 0.01°',
    ({ planet, date, index }) => {
      const want = HORIZONS.geocentric[planet][index];
      const fromCentre = direction({ kind: 'sky', raDeg: want.ra, decDeg: want.dec }, austin, date);
      expect(degreesBetween(direction({ kind: 'body', body: planet }, austin, date), fromCentre)).toBeLessThan(0.01);
    }
  );

  it.each(instants)('turns a place on the sky into the world as Horizons sees it at $iso, within 0.02°', ({ date, index }) => {
    const geocentric = HORIZONS.geocentric.sun[index];
    const want = HORIZONS.topocentric.sun[index];
    const seen = direction({ kind: 'horizon', azDeg: want.azimuth, altDeg: want.elevation }, austin, date);
    expect(degreesBetween(direction({ kind: 'sky', raDeg: geocentric.ra, decDeg: geocentric.dec }, austin, date), seen)).toBeLessThan(0.02);
  });
});

describe('targetDirection: ground', () => {
  it('looks straight down at the ground underfoot, the antipode and the centre', () => {
    const down = enu(austin).u.negate();
    const ground = (lat: number, lon: number, depthKm?: number): THREE.Vector3 => direction({ kind: 'ground', lat, lon, depthKm });
    expect(ground(austin.lat, austin.lon).distanceTo(down)).toBeLessThan(1e-6);
    expect(ground(-austin.lat, austin.lon + 180).distanceTo(down)).toBeLessThan(1e-6);
    expect(ground(austin.lat, austin.lon, EARTH_RADIUS_M / 1000).distanceTo(down)).toBeLessThan(1e-6);
  });

  it('looks 45° below the horizon at a place a quarter of the way round', () => {
    const down = enu({ lat: 0, lon: 0 }).u.negate();
    expect(degreesBetween(direction({ kind: 'ground', lat: 0, lon: 90 }, { lat: 0, lon: 0 }), down)).toBeCloseTo(45, 2);
  });

  it('points at the very spot a label is drawn on, from where the camera stands', () => {
    const camera = new THREE.PerspectiveCamera();
    createLookController().updateCamera(camera, austin, null, 0);
    const drawn = earthPoint(-15, 15, 2600).sub(camera.position).normalize();
    expect(direction({ kind: 'ground', lat: -15, lon: 15, depthKm: 2600 }).distanceTo(drawn)).toBeLessThan(1e-9);
  });
});

describe('targetDirection: label', () => {
  const label = (name: string, kind: PlaceLabel['kind'], lat: number, lon: number, depthKm?: number): PlaceLabel => ({ name, kind, lat, lon, priority: 1, depthKm });
  const labels = indexLabels([
    { labels: [label('Tuzo', 'deep', -15, 15, 2600), label('Georgia', 'country', 42.3, 43.4)] },
    { labels: [label('Georgia', 'state', 32.7, -83.4), label('Flores', 'volcano', -8.7, 121.7), label('Flores', 'volcano', 39.4, -31.2)] },
  ]);
  const resolve = (target: Target) => targetDirection(target, austin, when, labels);

  it('resolves a name that stands for one place, with or without its kind, as the ground there', () => {
    const ground = direction({ kind: 'ground', lat: -15, lon: 15, depthKm: 2600 });
    expect(direction({ kind: 'label', name: 'Tuzo' }, austin, when, labels).distanceTo(ground)).toBeLessThan(1e-12);
    expect(direction({ kind: 'label', name: 'Tuzo', labelKind: 'deep' }, austin, when, labels).distanceTo(ground)).toBeLessThan(1e-12);
  });

  it('tells a shared name apart by its kind', () => {
    const state = direction({ kind: 'label', name: 'Georgia', labelKind: 'state' }, austin, when, labels);
    expect(state.distanceTo(direction({ kind: 'ground', lat: 32.7, lon: -83.4 }))).toBeLessThan(1e-12);
    expect(state.distanceTo(direction({ kind: 'label', name: 'Georgia', labelKind: 'country' }, austin, when, labels))).toBeGreaterThan(0.1);
  });

  it('does not resolve a name that is missing, shared, or not of the kind asked for', () => {
    const failed = (message: string) => ({ ok: false, code: 'target-unresolved', message });
    expect(resolve({ kind: 'label', name: 'Atlantis' })).toEqual(failed('no label named Atlantis'));
    expect(resolve({ kind: 'label', name: 'Georgia' })).toEqual(failed('label Georgia names 2 places: country, state'));
    expect(resolve({ kind: 'label', name: 'Georgia', labelKind: 'city' })).toEqual(failed('no city label named Georgia: it is country, state'));
    expect(resolve({ kind: 'label', name: 'Tuzo', labelKind: 'hotspot' })).toEqual(failed('no hotspot label named Tuzo: it is deep'));
    expect(resolve({ kind: 'label', name: 'Flores', labelKind: 'volcano' })).toEqual(failed('label Flores names 2 volcano places'));
    expect(resolve({ kind: 'label', name: 'Flores' })).toEqual(failed('label Flores names 2 volcano places'));
  });

  it('resolves a label from the baked geology file where it is drawn', () => {
    const geology = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/geology.json'))) as LabelData;
    const tuzo = direction({ kind: 'label', name: 'Tuzo (African LLSVP)' }, austin, when, indexLabels([geology]));
    expect(tuzo.distanceTo(direction({ kind: 'ground', lat: -15, lon: 15, depthKm: 2600 }))).toBeLessThan(1e-12);
  });
});

describe('targetDirection: a label a lazy layer added', () => {
  const baked = indexLabels([{ labels: [{ kind: 'deep', name: 'Tuzo', lat: -15, lon: 15, depthKm: 2600, priority: 1 }] }]);
  const style = { fontPx: 10, color: '#fff' };
  /** A label layer with a sky name and Earth-fixed names, as a deep-sky and a landmark layer would add them. */
  function loaded(): LabelLayer {
    const layer = new LabelLayer(document.createElement('div'), []);
    // M31's place, ICRS.
    const m31 = new THREE.Vector3(...raDecToUnit(10.68, 41.27));
    layer.addGroup({ rank: 1, style, frame: 'sky', labels: [{ text: 'M31 Andromeda Galaxy', priority: 0, position: m31 }] });
    layer.addGroup({ rank: 1, style, frame: 'earth', labels: [{ text: '△ Everest · 8,849 m', priority: 0, position: earthPoint(27.99, 86.93) }] });
    layer.addGroup({ rank: 1, style, frame: 'earth', labels: [{ text: 'Tuzo', priority: 0, position: earthPoint(60, 60) }] });
    return layer;
  }

  it('points along a sky name as the sky target at its place does, and at an Earth-fixed name as the ground there', () => {
    const layer = loaded();
    const m31 = direction({ kind: 'sky', raDeg: 10.68, decDeg: 41.27 });
    const found = targetDirection({ kind: 'label', name: 'M31' }, austin, when, baked, layer);
    expect(found.ok && found.direction.distanceTo(m31)).toBeLessThan(1e-12);
    const everest = direction({ kind: 'ground', lat: 27.99, lon: 86.93 });
    const peak = targetDirection({ kind: 'label', name: 'Everest' }, austin, when, baked, layer);
    expect(peak.ok && peak.direction.distanceTo(everest)).toBeLessThan(1e-12);
    layer.dispose();
  });

  it('keeps to the baked name where there is one, and to the baked labels for a target that gives a kind', () => {
    const layer = loaded();
    const tuzo = direction({ kind: 'ground', lat: -15, lon: 15, depthKm: 2600 });
    const found = targetDirection({ kind: 'label', name: 'Tuzo' }, austin, when, baked, layer);
    expect(found.ok && found.direction.distanceTo(tuzo)).toBeLessThan(1e-12);
    expect(targetDirection({ kind: 'label', name: 'M31', labelKind: 'deep' }, austin, when, baked, layer)).toEqual({
      ok: false,
      code: 'target-unresolved',
      message: 'no label named M31',
    });
    layer.dispose();
  });

  it('says so of a name no layer has, or one at two places', () => {
    const layer = loaded();
    layer.addGroup({ rank: 1, style, frame: 'earth', labels: [{ text: 'Everest', priority: 0, position: earthPoint(0, 0) }] });
    const failed = (message: string) => ({ ok: false, code: 'target-unresolved', message });
    expect(targetDirection({ kind: 'label', name: 'Atlantis' }, austin, when, baked, layer)).toEqual(failed('no label named Atlantis'));
    // An exact "Everest" beats the one that only starts with it.
    expect(targetDirection({ kind: 'label', name: 'Everest' }, austin, when, baked, layer).ok).toBe(true);
    layer.addGroup({ rank: 1, style, frame: 'earth', labels: [{ text: 'Everest', priority: 0, position: earthPoint(10, 10) }] });
    expect(targetDirection({ kind: 'label', name: 'Everest' }, austin, when, baked, layer)).toEqual(failed('label Everest names 2 places'));
    layer.dispose();
  });
});

describe('targetDirection: bad values', () => {
  it.each<Target>([
    { kind: 'horizon', azDeg: NaN, altDeg: 0 },
    { kind: 'sky', raDeg: Infinity, decDeg: 0 },
    { kind: 'ground', lat: NaN, lon: 0 },
  ])('has no direction for $kind with a value that is not a finite number', (target) => {
    expect(targetDirection(target, austin, when, noLabels)).toEqual({ ok: false, code: 'target-unresolved', message: 'target has no direction' });
  });
});

describe('targetKey', () => {
  it('gives one target one key, whatever order a guide wrote its fields in', () => {
    expect(targetKey({ kind: 'sky', raDeg: 83.8, decDeg: -5.4 })).toBe(targetKey({ decDeg: -5.4, raDeg: 83.8, kind: 'sky' }));
    expect(targetKey({ kind: 'ground', lat: 19.4, lon: -155.3, depthKm: 30 })).toBe(
      targetKey({ depthKm: 30, lon: -155.3, lat: 19.4, kind: 'ground' })
    );
  });

  it('leaves names and extents out, and takes a missing depth as the surface', () => {
    const orion: Target = { kind: 'sky', raDeg: 83.8, decDeg: -5.4 };
    expect(targetKey({ ...orion, name: 'Orion Nebula', extentDeg: 1 })).toBe(targetKey(orion));
    const kilauea: Target = { kind: 'ground', lat: 19.4, lon: -155.3 };
    expect(targetKey({ ...kilauea, name: 'Kilauea' })).toBe(targetKey(kilauea));
    expect(targetKey({ ...kilauea, depthKm: 0 })).toBe(targetKey(kilauea));
  });

  it('tells apart a shared name by its kind, and every kind from every other', () => {
    expect(targetKey({ kind: 'label', name: 'Flores', labelKind: 'volcano' })).not.toBe(targetKey({ kind: 'label', name: 'Flores' }));
    const keys = [
      targetKey({ kind: 'body', body: 'sun' }),
      targetKey({ kind: 'sky', raDeg: 0, decDeg: 0 }),
      targetKey({ kind: 'horizon', azDeg: 0, altDeg: 0 }),
      targetKey({ kind: 'ground', lat: 0, lon: 0 }),
      targetKey({ kind: 'label', name: '0' }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('targetName', () => {
  it('names a body, a named place or label, and not a bare direction', () => {
    expect(targetName({ kind: 'body', body: 'sun' })).toBe('Sun');
    expect(targetName({ kind: 'body', body: 'moon' })).toBe('Moon');
    expect(targetName({ kind: 'body', body: 'jupiter' })).toBe('Jupiter');
    expect(targetName({ kind: 'sky', raDeg: 83.8, decDeg: -5.4, name: 'Orion Nebula' })).toBe('Orion Nebula');
    expect(targetName({ kind: 'sky', raDeg: 83.8, decDeg: -5.4 })).toBeNull();
    expect(targetName({ kind: 'ground', lat: 19.4, lon: -155.3, name: 'Kilauea' })).toBe('Kilauea');
    expect(targetName({ kind: 'ground', lat: 19.4, lon: -155.3 })).toBeNull();
    expect(targetName({ kind: 'label', name: 'Tuzo' })).toBe('Tuzo');
    expect(targetName({ kind: 'horizon', azDeg: 90, altDeg: 0 })).toBeNull();
  });
});
