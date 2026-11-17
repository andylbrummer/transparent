import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { EARTH_RADIUS_M, PLANET_NAMES, enuBasis } from '@transparent-earth/core';
import { HORIZONS } from '@transparent-earth/core/astro/ephemeris.fixture';
import { createLookController } from '../input/look';
import { earthPoint } from '../render/earth-point';
import type { LabelData, PlaceLabel } from '../render/labels';
import type { SurfacePosition } from '../sensors';
import type { Target } from './actions';
import { indexLabels, targetDirection, type LabelIndex } from './targets';

const austin: SurfacePosition = HORIZONS.site;
const instants = HORIZONS.instants.map((iso, index) => ({ iso, index, date: new Date(iso) }));
const noLabels: LabelIndex = new Map();
const when = new Date('2026-11-09T06:00:00Z');

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

describe('targetDirection: bad values', () => {
  it.each<Target>([
    { kind: 'horizon', azDeg: NaN, altDeg: 0 },
    { kind: 'sky', raDeg: Infinity, decDeg: 0 },
    { kind: 'ground', lat: NaN, lon: 0 },
  ])('has no direction for $kind with a value that is not a finite number', (target) => {
    expect(targetDirection(target, austin, when, noLabels)).toEqual({ ok: false, code: 'target-unresolved', message: 'target has no direction' });
  });
});
