/**
 * Where a target is, as a direction from where the view stands, now. Pure
 * maths with no renderer, so it is checked against JPL Horizons directly.
 *
 * Each kind points where the app draws its thing, not where a textbook
 * puts it: a pointer that lands beside the thing on screen is worse than
 * none. The world is ECEF metres from the Earth's centre. The view stands
 * where the camera does (standingPoint, in standing-place.ts). The ground
 * is on the drawn sphere (earthPoint, which the labels use too). The sky
 * turns into the world by icrsToEcefMatrix, as main.ts turns it. The Sun
 * and planets are drawn as seen from the Earth's centre, so they have no
 * parallax; the Moon is drawn at its distance, so it does.
 */

import * as THREE from 'three';
import {
  applyMat3,
  enuBasis,
  icrsToEcefMatrix,
  moonGeocentricKm,
  planetEphemeris,
  raDecToUnit,
  sunGeocentricAu,
  type PlanetName,
  type Vec3,
} from '@transparent-earth/core';
import { earthPoint } from '../render/earth-point';
import type { LabelData, LabelKind, PlaceLabel } from '../render/labels';
import type { SurfacePosition } from '../sensors';
import type { Target } from './actions';
import { standingPoint } from './standing-place';

/** The baked labels by name: what a `label` target is looked up in. */
export type LabelIndex = ReadonlyMap<string, readonly PlaceLabel[]>;

/** Index the baked label files (geo/labels.json, geology.json, quakes.json) by name. */
export function indexLabels(sources: readonly LabelData[]): LabelIndex {
  const index = new Map<string, PlaceLabel[]>();
  for (const source of sources) {
    for (const label of source.labels) {
      const named = index.get(label.name);
      if (named) named.push(label);
      else index.set(label.name, [label]);
    }
  }
  return index;
}

export type TargetDirection =
  /** World unit vector from where the view stands. */
  | { readonly ok: true; readonly direction: THREE.Vector3 }
  | { readonly ok: false; readonly code: 'target-unresolved'; readonly message: string };

type Unresolved = Extract<TargetDirection, { ok: false }>;

const unresolved = (message: string): Unresolved => ({ ok: false, code: 'target-unresolved', message });

/** Where `target` is, seen from `position` at `date`: the direction to where the app draws it. */
export function targetDirection(target: Target, position: SurfacePosition, date: Date, labels: LabelIndex): TargetDirection {
  const toward = towardTarget(target, position, date, labels);
  if (!(toward instanceof THREE.Vector3)) return toward;
  // One check for every kind: a NaN or infinite input gives no direction to normalise.
  const length = toward.length();
  if (!Number.isFinite(length) || length === 0) return unresolved('target has no direction');
  return { ok: true, direction: toward.divideScalar(length) };
}

/** A vector toward the target, any length. */
function towardTarget(target: Target, position: SurfacePosition, date: Date, labels: LabelIndex): THREE.Vector3 | Unresolved {
  switch (target.kind) {
    case 'horizon': {
      const { e, n, u } = enuBasis({ lat: position.lat, lon: position.lon, alt: 0 });
      const az = THREE.MathUtils.degToRad(target.azDeg);
      const alt = THREE.MathUtils.degToRad(target.altDeg);
      return vector(e)
        .multiplyScalar(Math.cos(alt) * Math.sin(az))
        .addScaledVector(vector(n), Math.cos(alt) * Math.cos(az))
        .addScaledVector(vector(u), Math.sin(alt));
    }
    case 'sky':
      return icrsToWorld(raDecToUnit(target.raDeg, target.decDeg), date);
    case 'body':
      return towardBody(target.body, position, date);
    case 'ground':
      return earthPoint(target.lat, target.lon, target.depthKm).sub(standPoint(position));
    case 'label': {
      const place = labelPlace(target.name, target.labelKind, labels);
      if ('code' in place) return place;
      return earthPoint(place.lat, place.lon, place.depthKm).sub(standPoint(position));
    }
  }
}

function towardBody(body: 'sun' | 'moon' | PlanetName, position: SurfacePosition, date: Date): THREE.Vector3 {
  switch (body) {
    case 'sun':
      return icrsToWorld(sunGeocentricAu(date), date);
    case 'moon':
      // Drawn in metres from the Earth's centre, so seen from the stand it shifts by up to a degree.
      return icrsToWorld(moonGeocentricKm(date), date).multiplyScalar(1000).sub(standPoint(position));
    default:
      return icrsToWorld(planetEphemeris(body, date).positionAu, date);
  }
}

/**
 * The one place a label name stands for, or why there is not one. A shared
 * name is never guessed at: the message lists the kinds to choose from.
 */
function labelPlace(name: string, labelKind: LabelKind | undefined, labels: LabelIndex): PlaceLabel | Unresolved {
  const named = labels.get(name);
  if (!named) return unresolved(`no label named ${name}`);
  const kinds = named.map((label) => label.kind).join(', ');
  if (labelKind === undefined) {
    if (named.length > 1) {
      // All of one kind: naming the kind would not tell them apart, so say that now.
      if (named.every((label) => label.kind === named[0].kind)) return unresolved(`label ${name} names ${named.length} ${named[0].kind} places`);
      return unresolved(`label ${name} names ${named.length} places: ${kinds}`);
    }
    return named[0];
  }
  const ofKind = named.filter((label) => label.kind === labelKind);
  if (ofKind.length === 0) return unresolved(`no ${labelKind} label named ${name}: it is ${kinds}`);
  if (ofKind.length > 1) return unresolved(`label ${name} names ${ofKind.length} ${labelKind} places`);
  return ofKind[0];
}

/** Where the view stands at `position`, as the camera stands there (standing-place.ts). */
function standPoint(position: SurfacePosition): THREE.Vector3 {
  const { u } = enuBasis({ lat: position.lat, lon: position.lon, alt: 0 });
  return standingPoint(vector(u));
}

/** An ICRS vector turned into the world as the sky is turned (main.ts). */
function icrsToWorld(icrs: readonly [number, number, number], date: Date): THREE.Vector3 {
  return new THREE.Vector3(...applyMat3(icrsToEcefMatrix(date), icrs));
}

function vector(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}
