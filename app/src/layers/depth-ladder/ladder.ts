/**
 * The depth ladder of spec/ux.md: rings down the line from the user's
 * feet through the centre of the Earth to the antipode, each labelled
 * with how far down it is and what it is like there.
 *
 * Pressure and density are PREM's and temperature Anderson's (1982)
 * geotherm (app/public/geo/depth-ladder.json, from
 * tools/pipeline/generate_depth_ladder.py). At a discontinuity the values
 * on both sides are shown: "5.57→9.90 g/cm³" is rock sitting on liquid
 * iron.
 *
 * Seen from the top every point of the line is the same point on the
 * screen, so the rings are what spreads the rungs out: each is sized to
 * look RING_STEP_DEG wider than the one beyond it, the antipode's
 * innermost - a target whose rings are distances, not structures. Names
 * sit under each ring and its numbers above, wherever the screen's "down"
 * happens to point.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { GeoMarkers } from '../../render/geo-markers';
import { LABEL_KIND_ORDER, type GroupLabel, type LabelData } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import type { SurfacePosition } from '../../sensors';
import type { LayerContext, LayerInstance } from '../types';
import { LADDER_COLOR } from './layer';

export interface Rung {
  readonly depthKm: number;
  readonly name?: string;
  readonly pressureGPa: number;
  /** One value, or [just above, just below] a discontinuity. */
  readonly densityGcm3: readonly number[];
  readonly temperatureK: readonly number[];
}

/** The shape of app/public/geo/depth-ladder.json: rungs shallowest first. */
export interface LadderData {
  readonly earthRadiusKm: number;
  readonly rungs: readonly Rung[];
}

/** Angular radius, seen from the user, of the innermost ring (the antipode's) and the step to each nearer one, degrees. */
export const RING_FIRST_DEG = 2.5;
export const RING_STEP_DEG = 2.6;
const RING_STEPS = 72;
const DEG = Math.PI / 180;

/** Radius, km, of the ring `distanceKm` down that is the `fromFarthest`-th counting from the antipode's (0). */
export function ringRadiusKm(distanceKm: number, fromFarthest: number): number {
  return distanceKm * Math.tan((RING_FIRST_DEG + RING_STEP_DEG * fromFarthest) * DEG);
}

/** Unit vector from the Earth's centre through a surface position. */
export function upVector(position: SurfacePosition, target: THREE.Vector3): THREE.Vector3 {
  const lat = position.lat * DEG;
  const lon = position.lon * DEG;
  return target.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
}

/** The point `distanceKm` straight down from the user: past the centre it comes up the far side, to the antipode at a diameter. */
export function pointBelow(position: SurfacePosition, distanceKm: number, target: THREE.Vector3): THREE.Vector3 {
  return upVector(position, target).multiplyScalar(EARTH_RADIUS_M - distanceKm * 1000);
}

/** Segment endpoints of the level ring of `radiusKm` round the point `distanceKm` straight down. */
export function ringSegments(position: SurfacePosition, distanceKm: number, radiusKm: number, out: number[]): void {
  const centre = pointBelow(position, distanceKm, new THREE.Vector3());
  const up = upVector(position, new THREE.Vector3());
  const east = new THREE.Vector3(0, 0, 1).cross(up);
  // At a pole any level direction serves.
  if (east.lengthSq() < 1e-12) east.set(0, 1, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(up, east);
  const r = radiusKm * 1000;
  let previous: THREE.Vector3 | null = null;
  for (let i = 0; i <= RING_STEPS; i++) {
    const angle = (i / RING_STEPS) * 2 * Math.PI;
    const point = centre
      .clone()
      .addScaledVector(east, r * Math.cos(angle))
      .addScaledVector(north, r * Math.sin(angle));
    if (previous) out.push(previous.x, previous.y, previous.z, point.x, point.y, point.z);
    previous = point;
  }
}

const km = (value: number): string => `${Math.round(value).toLocaleString('en-US')} km`;
const across = (values: readonly number[], format: (value: number) => string): string => values.map(format).join('→');

/** "core–mantle boundary · 2,891 km", or just "1,000 km". */
export function rungNameText(rung: Rung): string {
  return rung.name ? `${rung.name} · ${km(rung.depthKm)}` : km(rung.depthKm);
}

/** "136 GPa · 2,937→3,637 K · 5.57→9.90 g/cm³". */
export function rungValuesText(rung: Rung): string {
  const pressure = rung.pressureGPa >= 100 ? rung.pressureGPa.toFixed(0) : rung.pressureGPa.toFixed(1);
  const temperature = across(rung.temperatureK, (k) => k.toLocaleString('en-US'));
  return `${pressure} GPa · ${temperature} K · ${across(rung.densityGcm3, (d) => d.toFixed(2))} g/cm³`;
}

/** The surface position opposite a position. */
export function antipodeOf(position: SurfacePosition): SurfacePosition {
  return { lat: -position.lat, lon: position.lon > 0 ? position.lon - 180 : position.lon + 180 };
}

/** Great-circle distance, km. */
export function distanceKm(a: SurfacePosition, b: SurfacePosition): number {
  const cos =
    Math.sin(a.lat * DEG) * Math.sin(b.lat * DEG) + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.cos((a.lon - b.lon) * DEG);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * EARTH_RADIUS_M) / 1000;
}

/** "nearest city: Perth, 2,900 km" for the antipode, from the map's own city names; null if there are none. */
export function nearestCityText(antipode: SurfacePosition, labels: LabelData): string | null {
  let best: { name: string; km: number } | null = null;
  for (const label of labels.labels) {
    if (label.kind !== 'city') continue;
    const d = distanceKm(antipode, label);
    if (!best || d < best.km) best = { name: label.name, km: d };
  }
  if (!best) return null;
  const rounded = best.km >= 100 ? Math.round(best.km / 10) * 10 : Math.round(best.km);
  return `nearest city: ${best.name}, ${rounded.toLocaleString('en-US')} km`;
}

/**
 * The level direction that points down the screen: the camera's own
 * "down", flattened onto the plane of the rings. Null when the camera's
 * up is the line itself (looking at the horizon, the rings are out of
 * view anyway).
 */
export function screenDown(camera: THREE.Camera, up: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 | null {
  const e = camera.matrixWorld.elements;
  target.set(-e[4], -e[5], -e[6]);
  target.addScaledVector(up, -target.dot(up));
  return target.lengthSq() < 1e-6 ? null : target.normalize();
}

export async function createDepthLadderLayer(context: LayerContext): Promise<LayerInstance> {
  const [data, places] = await Promise.all([
    context.fetchJson<LadderData>(context.assetUrl('geo/depth-ladder.json')),
    context.fetchJson<LabelData>(context.assetUrl('geo/labels.json')),
  ]);
  const diameterKm = 2 * data.earthRadiusKm;
  // Every ring, the antipode's first: [distance down, name under it, numbers over it].
  const count = data.rungs.length + 1;
  const distances = [diameterKm, ...[...data.rungs].reverse().map((rung) => rung.depthKm)];
  const radiiM = distances.map((distance, k) => ringRadiusKm(distance, k) * 1000);

  const geometry = new LineSegmentsGeometry();
  const material = new LineMaterial({
    color: LADDER_COLOR,
    linewidth: 1.3,
    transparent: true,
    opacity: 0.75,
    depthTest: false,
    depthWrite: false,
  });
  const rings = new LineSegments2(geometry, material);
  rings.name = 'depth-ladder-rings';
  rings.frustumCulled = false;
  rings.renderOrder = RENDER_ORDER.interior + 0.2;
  const markers = new GeoMarkers('depth-ladder-marks', context.skyUniforms.uPixelRatio);
  const group = new THREE.Group();
  group.add(rings, markers.object);
  context.earthRoot.add(group);

  const centres = distances.map(() => new THREE.Vector3());
  const namePoints = distances.map(() => new THREE.Vector3());
  const valuePoints = distances.map(() => new THREE.Vector3());
  const rank = LABEL_KIND_ORDER.indexOf('country') - 0.9;
  const style = { fontPx: 11, color: '#e6f1ff' };
  const rungLabels: GroupLabel[] = [...data.rungs].reverse().flatMap((rung, i) => [
    // Deepest first: where the view is crowded the far rungs keep their names.
    { text: rungNameText(rung), priority: i + 1, position: namePoints[i + 1] },
    { text: rungValuesText(rung), priority: i + 1.5, position: valuePoints[i + 1] },
  ]);
  const rungGroup = context.addLabels({ rank, style, frame: 'earth', labels: rungLabels });
  // The antipode's texts depend on where the user stands: its group is rebuilt on a move.
  let antipodeGroup = context.addLabels({ rank, style, frame: 'earth', labels: [] });

  let visible = false;
  let placedAt: SurfacePosition | null = null;
  const up = new THREE.Vector3();
  const down = new THREE.Vector3(1, 0, 0);
  const scratch = new THREE.Vector3();
  const place = (position: SurfacePosition): void => {
    if (placedAt && Math.abs(placedAt.lat - position.lat) < 1e-3 && Math.abs(placedAt.lon - position.lon) < 1e-3) return;
    placedAt = { lat: position.lat, lon: position.lon };
    upVector(position, up);
    const segments: number[] = [];
    distances.forEach((distance, k) => {
      ringSegments(position, distance, radiiM[k] / 1000, segments);
      pointBelow(position, distance, centres[k]);
    });
    geometry.setPositions(segments);
    const antipode = antipodeOf(position);
    markers.setMarkers([
      { lon: antipode.lon, lat: antipode.lat, shape: 'cross', color: LADDER_COLOR, sizePx: 11 },
      { lon: position.lon, lat: position.lat, altitudeM: -EARTH_RADIUS_M, shape: 'diamond', color: LADDER_COLOR, sizePx: 8 },
    ]);
    const city = nearestCityText(antipode, places);
    antipodeGroup.remove();
    antipodeGroup = context.addLabels({
      rank,
      style: { ...style, bold: true },
      frame: 'earth',
      labels: [
        { text: `antipode · ${km(diameterKm)}`, priority: 0, position: namePoints[0] },
        ...(city ? [{ text: city, priority: 0.5, position: valuePoints[0] }] : []),
      ],
    });
    antipodeGroup.setVisible(visible);
  };
  /** Hang each ring's name from its lower edge and set its numbers on its upper, as the screen now lies. */
  const aim = (camera: THREE.Camera): void => {
    const direction = screenDown(camera, up, scratch);
    if (direction) down.copy(direction);
    for (let k = 0; k < count; k++) {
      namePoints[k].copy(centres[k]).addScaledVector(down, radiiM[k]);
      valuePoints[k].copy(centres[k]).addScaledVector(down, -radiiM[k]);
    }
  };
  const position = context.getPosition();
  if (position) place(position);

  return {
    setVisible(next) {
      visible = next;
      group.visible = next;
      rungGroup.setVisible(next);
      antipodeGroup.setVisible(next);
    },
    update(frame) {
      place(frame.position);
      aim(frame.camera);
    },
    setResolution(widthCss, heightCss) {
      material.resolution.set(widthCss, heightCss);
    },
    dispose() {
      rungGroup.remove();
      antipodeGroup.remove();
      group.removeFromParent();
      markers.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
