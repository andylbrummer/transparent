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
 *
 * A body target needs the ephemeris (body-positions.ts), which is loaded
 * with loadBodyPositions, not with the app: until then a body does not
 * resolve, and says so.
 */

import * as THREE from 'three';
import { applyMat3, enuBasis, icrsToEcefMatrix, raDecToUnit, type PlanetName, type Vec3 } from '@transparent-earth/core';
import { earthPoint } from '../render/earth-point';
import type { LabelData, LabelKind, LabelLayer, PlaceLabel } from '../render/labels';
import type { SurfacePosition } from '../sensors';
import type { Target, TargetUnresolved } from './actions';
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

/**
 * The names lazy layers have added, for a label no baked file has: the
 * label layer itself in the app (LabelLayer.find).
 */
export type LoadedLabels = Pick<LabelLayer, 'find'>;

export type TargetDirection =
  /** World unit vector from where the view stands. */
  | { readonly ok: true; readonly direction: THREE.Vector3 }
  | TargetUnresolved;

const unresolved = (message: string): TargetUnresolved => ({ ok: false, code: 'target-unresolved', message });

type BodyPositions = typeof import('./body-positions');
let bodyPositions: BodyPositions | null = null;
let bodyPositionsLoading: Promise<void> | null = null;

/**
 * Load the Sun, Moon and planet positions a body target needs. They are the
 * ephemeris and its VSOP87 tables, nearly as much code as the rest of the
 * app's first load, so they come with the first body target, not with the
 * app. Loads once; a load that fails can be asked for again.
 */
export function loadBodyPositions(): Promise<void> {
  bodyPositionsLoading ??= import('./body-positions').then(
    (module) => {
      bodyPositions = module;
    },
    (error: unknown) => {
      bodyPositionsLoading = null;
      throw error;
    }
  );
  return bodyPositionsLoading;
}

/** Whether resolving `target` waits on loadBodyPositions. */
export function needsBodyPositions(target: Target): boolean {
  return target.kind === 'body' && bodyPositions === null;
}

/**
 * Where `target` is, seen from `position` at `date`: the direction to where the app draws it. A label is looked for in
 * the baked files, then among `loaded`, the names of the lazy layers loaded so far.
 */
export function targetDirection(
  target: Target,
  position: SurfacePosition,
  date: Date,
  labels: LabelIndex,
  loaded: LoadedLabels | null = null
): TargetDirection {
  const toward = towardTarget(target, position, date, labels, loaded);
  if (!(toward instanceof THREE.Vector3)) return toward;
  // One check for every kind: a NaN or infinite input gives no direction to normalise.
  const length = toward.length();
  if (!Number.isFinite(length) || length === 0) return unresolved('target has no direction');
  return { ok: true, direction: toward.divideScalar(length) };
}

/** A world direction in the local frame at `position`: azimuth clockwise from north in [0, 360), altitude above the horizon. */
export function horizonOf(direction: THREE.Vector3, position: SurfacePosition): { readonly azDeg: number; readonly altDeg: number } {
  const { e, n, u } = enuBasis({ lat: position.lat, lon: position.lon, alt: 0 });
  const east = direction.dot(vector(e));
  const north = direction.dot(vector(n));
  const altDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(direction.dot(vector(u)), -1, 1)));
  // Straight up or down has no azimuth, and rounding would make one up: it is 0 there.
  const azRad = Math.hypot(east, north) < 1e-12 ? 0 : Math.atan2(east, north);
  // Into [0, 360): -0, and a hair west of north that rounds to 360, both come out 0.
  return { azDeg: (THREE.MathUtils.radToDeg(azRad) + 360) % 360, altDeg };
}

/**
 * A target's identity: two targets with the same key are the same thing to
 * look at, however their fields were ordered in a guide's JSON. A mark is
 * kept, replaced and removed by it.
 */
export function targetKey(target: Target): string {
  // Field by field rather than JSON.stringify, whose key follows field order.
  // A name or an extent describes a target; it does not move it.
  switch (target.kind) {
    case 'body':
      return `body:${target.body}`;
    case 'sky':
      return `sky:${target.raDeg}:${target.decDeg}`;
    case 'horizon':
      return `horizon:${target.azDeg}:${target.altDeg}`;
    case 'ground':
      return `ground:${target.lat}:${target.lon}:${target.depthKm ?? 0}`;
    case 'label':
      // The kind first: it has no colon in it, and a name may.
      return `label:${target.labelKind ?? ''}:${target.name}`;
  }
}

/** What to call a target beside a pointer; null when it is a bare direction or was given no name. */
export function targetName(target: Target): string | null {
  switch (target.kind) {
    case 'body':
      return target.body[0].toUpperCase() + target.body.slice(1);
    case 'sky':
    case 'ground':
      return target.name ?? null;
    case 'label':
      return target.name;
    case 'horizon':
      return null;
  }
}

/** A vector toward the target, any length. */
function towardTarget(
  target: Target,
  position: SurfacePosition,
  date: Date,
  labels: LabelIndex,
  loaded: LoadedLabels | null
): THREE.Vector3 | TargetUnresolved {
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
      // The baked files first, and alone when they have the name: a guide's name was checked against them, and must
      // not come to mean something else because a layer with the same name in it was switched on. A kind is only
      // known of the baked labels, so a target that gives one is never looked for further.
      if (loaded && target.labelKind === undefined && !labels.has(target.name)) return towardLoadedLabel(target.name, position, date, loaded);
      const place = labelPlace(target.name, target.labelKind, labels);
      if ('code' in place) return place;
      return earthPoint(place.lat, place.lon, place.depthKm).sub(standPoint(position));
    }
  }
}

/** Toward a name a lazy layer added, drawn where the label layer draws it: on the sky turned as main.ts turns it, or at its ECEF point. */
function towardLoadedLabel(name: string, position: SurfacePosition, date: Date, loaded: LoadedLabels): THREE.Vector3 | TargetUnresolved {
  const found = loaded.find(name);
  switch (found.found) {
    case 'none':
      return unresolved(`no label named ${name}`);
    case 'many':
      return unresolved(`label ${name} names ${found.count} places`);
    case 'one': {
      const { x, y, z } = found.position;
      if (found.frame === 'sky') return icrsToWorld([x, y, z], date);
      return new THREE.Vector3(x, y, z).sub(standPoint(position));
    }
  }
}

function towardBody(body: 'sun' | 'moon' | PlanetName, position: SurfacePosition, date: Date): THREE.Vector3 | TargetUnresolved {
  // Not loaded yet is not "no such body": say which, as a label does before its files arrive.
  if (!bodyPositions) return unresolved('the Sun, Moon and planet positions have not loaded');
  switch (body) {
    case 'sun':
      return icrsToWorld(bodyPositions.sunGeocentricAu(date), date);
    case 'moon':
      // Drawn in metres from the Earth's centre, so seen from the stand it shifts by up to a degree.
      return icrsToWorld(bodyPositions.moonGeocentricKm(date), date).multiplyScalar(1000).sub(standPoint(position));
    default:
      return icrsToWorld(bodyPositions.planetEphemeris(body, date).positionAu, date);
  }
}

/**
 * The one place a label name stands for, or why there is not one. A shared
 * name is never guessed at: the message lists the kinds to choose from.
 */
function labelPlace(name: string, labelKind: LabelKind | undefined, labels: LabelIndex): PlaceLabel | TargetUnresolved {
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
