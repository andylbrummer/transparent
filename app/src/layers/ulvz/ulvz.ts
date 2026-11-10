/**
 * Ultra-low velocity zones: the thin patches on the core-mantle boundary
 * where seismic waves slow by tens of per cent, drawn where they are,
 * 2,891 km down (app/public/geo/ulvz.json, from
 * tools/pipeline/generate_ulvz.py; Yu & Garnero 2018).
 *
 * The data is not a map of ULVZs but a record of where people have
 * looked: each study sampled a few patches of the boundary with one kind
 * of wave and reported a ULVZ, none, or something unclear. So all three
 * answers are drawn, in three colours, as what the study gave: the point
 * where a ray met the core, the path of a wave along it, or the outline
 * of the region studied. What is empty has not been looked at.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { GeoMarkers, type GeoMarker, type MarkerShape } from '../../render/geo-markers';
import { ecefAtDepth } from '../../render/interior';
import { LABEL_KIND_ORDER, type GroupLabel } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import type { LayerContext, LayerInstance } from '../types';
import { ULVZ_COLORS } from './layer';

export type UlvzResult = 'yes' | 'no' | 'may';

/** Drawn in this order, so what was found lies over what was not. */
export const ULVZ_RESULTS: readonly UlvzResult[] = ['no', 'may', 'yes'];

export interface MegaUlvz {
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
  /** Across, km on the core; null where the paper gives the size in words (`size`). */
  readonly widthKm: number | null;
  readonly heightKm: number;
  /** Shear-wave speed against the surrounding mantle, per cent: negative. */
  readonly dVsPercent: number;
  readonly size: string | null;
  /** The study, e.g. "Thorne et al. 2013". */
  readonly cite: string;
}

/** The shape of app/public/geo/ulvz.json; coordinates are lon, lat, ... in 1 / quantumPerDegree degree. */
export interface UlvzData {
  readonly depthKm: number;
  readonly quantumPerDegree: number;
  readonly studies: number;
  readonly points: Readonly<Record<UlvzResult, readonly number[]>>;
  /** Each: lon, lat, lon, lat - the two ends of a path along the boundary. */
  readonly lines: Readonly<Record<UlvzResult, readonly (readonly number[])[]>>;
  /** Each: the vertices of a closed outline. */
  readonly areas: Readonly<Record<UlvzResult, readonly (readonly number[])[]>>;
  readonly mega: readonly MegaUlvz[];
}

const MARKS: Readonly<Record<UlvzResult, { shape: MarkerShape; sizePx: number; alpha: number }>> = {
  yes: { shape: 'disc', sizePx: 5, alpha: 0.95 },
  may: { shape: 'ring', sizePx: 6, alpha: 0.8 },
  no: { shape: 'cross', sizePx: 5, alpha: 0.75 },
};

/** A line is drawn as chords no longer than this, degrees, so it follows the core's curve. */
const MAX_CHORD_DEG = 2;
/** Steps round the ring of a mega-ULVZ known only by its centre and width. */
const RING_STEPS = 48;

/** One marker per pierce point: not found first, found last and on top. */
export function ulvzMarkers(data: UlvzData): GeoMarker[] {
  const q = data.quantumPerDegree;
  return ULVZ_RESULTS.flatMap((result) => {
    const flat = data.points[result];
    const mark = MARKS[result];
    const markers: GeoMarker[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      markers.push({ lon: flat[i] / q, lat: flat[i + 1] / q, altitudeM: -data.depthKm * 1000, color: ULVZ_COLORS[result], ...mark });
    }
    return markers;
  });
}

const DEG = Math.PI / 180;

function unitVector(lonDeg: number, latDeg: number, target: THREE.Vector3): THREE.Vector3 {
  const cosLat = Math.cos(latDeg * DEG);
  return target.set(cosLat * Math.cos(lonDeg * DEG), cosLat * Math.sin(lonDeg * DEG), Math.sin(latDeg * DEG));
}

/** Append the great-circle arc a → b on the sphere of `radiusM` as segments no longer than MAX_CHORD_DEG. */
function pushArc(a: THREE.Vector3, b: THREE.Vector3, radiusM: number, out: number[]): number {
  const angle = a.angleTo(b);
  const steps = Math.max(1, Math.ceil(angle / (MAX_CHORD_DEG * DEG)));
  const sin = Math.sin(angle);
  let px = a.x * radiusM;
  let py = a.y * radiusM;
  let pz = a.z * radiusM;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Slerp; two points on top of each other are one point.
    const wa = sin < 1e-9 ? 1 - t : Math.sin((1 - t) * angle) / sin;
    const wb = sin < 1e-9 ? t : Math.sin(t * angle) / sin;
    const x = (wa * a.x + wb * b.x) * radiusM;
    const y = (wa * a.y + wb * b.y) * radiusM;
    const z = (wa * a.z + wb * b.z) * radiusM;
    out.push(px, py, pz, x, y, z);
    px = x;
    py = y;
    pz = z;
  }
  return steps;
}

export interface UlvzSegments {
  /** x0,y0,z0, x1,y1,z1 per segment, ECEF metres on the core-mantle boundary. */
  readonly positions: Float32Array;
  /** r,g,b at either end of each segment, display values 0..1. */
  readonly colors: Float32Array;
}

/**
 * The paths, the outlines (closed) and a ring for each mega-ULVZ that the
 * data gives only as a centre and a width, as line segments on the core.
 */
export function ulvzSegments(data: UlvzData): UlvzSegments {
  const radiusM = EARTH_RADIUS_M - data.depthKm * 1000;
  const q = data.quantumPerDegree;
  const positions: number[] = [];
  const colors: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const paint = (segments: number, color: number): void => {
    const rgb = [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255];
    for (let i = 0; i < segments * 2; i++) colors.push(rgb[0], rgb[1], rgb[2]);
  };
  for (const result of ULVZ_RESULTS) {
    const color = ULVZ_COLORS[result];
    for (const line of data.lines[result]) {
      paint(pushArc(unitVector(line[0] / q, line[1] / q, a), unitVector(line[2] / q, line[3] / q, b), radiusM, positions), color);
    }
    for (const ring of data.areas[result]) {
      const count = ring.length / 2;
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        unitVector(ring[2 * i] / q, ring[2 * i + 1] / q, a);
        unitVector(ring[2 * j] / q, ring[2 * j + 1] / q, b);
        paint(pushArc(a, b, radiusM, positions), color);
      }
    }
  }
  // A mega-ULVZ without an outline in the data: a circle of its stated width.
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  for (const mega of data.mega) {
    if (mega.widthKm === null || megaHasOutline(data, mega)) continue;
    const centre = unitVector(mega.lon, mega.lat, new THREE.Vector3());
    const angular = (mega.widthKm * 500) / radiusM;
    east.set(-centre.y, centre.x, 0).normalize();
    north.crossVectors(centre, east);
    const at = (k: number, target: THREE.Vector3): THREE.Vector3 => {
      const turn = (2 * Math.PI * k) / RING_STEPS;
      return target
        .copy(centre)
        .multiplyScalar(Math.cos(angular))
        .addScaledVector(east, Math.sin(angular) * Math.cos(turn))
        .addScaledVector(north, Math.sin(angular) * Math.sin(turn));
    };
    for (let k = 0; k < RING_STEPS; k++) paint(pushArc(at(k, a), at(k + 1, b), radiusM, positions), ULVZ_COLORS.yes);
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) };
}

/** Whether an outline of a found ULVZ has a vertex within the mega-ULVZ's own half-width of its centre (or 8° if it has none). */
export function megaHasOutline(data: UlvzData, mega: MegaUlvz): boolean {
  const q = data.quantumPerDegree;
  const radiusM = EARTH_RADIUS_M - data.depthKm * 1000;
  const reach = mega.widthKm === null ? 8 * DEG : (1.25 * mega.widthKm * 500) / radiusM;
  const centre = unitVector(mega.lon, mega.lat, new THREE.Vector3());
  const vertex = new THREE.Vector3();
  return data.areas.yes.some((ring) => {
    for (let i = 0; i + 1 < ring.length; i += 2) {
      if (unitVector(ring[i] / q, ring[i + 1] / q, vertex).angleTo(centre) <= reach) return true;
    }
    return false;
  });
}

/** "Hawaiian mega-ULVZ · ~910 km wide, 20 km high · S waves −20 %". */
export function megaLabelText(mega: MegaUlvz): string {
  const size = mega.size ?? `~${mega.widthKm} km wide, ${mega.heightKm} km high`;
  return `${mega.name} · ${size} · S waves −${Math.abs(mega.dVsPercent)} %`;
}

export async function createUlvzLayer(context: LayerContext): Promise<LayerInstance> {
  const data = await context.fetchJson<UlvzData>(context.assetUrl('geo/ulvz.json'));

  // Under the earthquakes and what else is drawn in the mantle; over the depth slices and the 3-D bodies.
  const markers = new GeoMarkers('ulvz-points', context.skyUniforms.uPixelRatio, RENDER_ORDER.interior - 0.1);
  markers.setMarkers(ulvzMarkers(data));

  const segments = ulvzSegments(data);
  const lineGeometry = new LineSegmentsGeometry();
  lineGeometry.setPositions(segments.positions);
  lineGeometry.setColors(segments.colors);
  const lineMaterial = new LineMaterial({
    vertexColors: true,
    linewidth: 1.5,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
  });
  const lines = new LineSegments2(lineGeometry, lineMaterial);
  lines.name = 'ulvz-lines';
  lines.frustumCulled = false;
  lines.renderOrder = RENDER_ORDER.interior - 0.15;

  const group = new THREE.Group();
  group.name = 'ulvz';
  group.add(lines, markers.object);
  context.earthRoot.add(group);

  const names: GroupLabel[] = data.mega.map((mega, i) => ({
    text: megaLabelText(mega),
    priority: i,
    position: ecefAtDepth(mega.lon, mega.lat, data.depthKm, new THREE.Vector3()),
  }));
  const labels = context.addLabels({
    rank: LABEL_KIND_ORDER.indexOf('deep') - 0.4,
    style: { fontPx: 11, color: '#ffc2ee', italic: true, bold: true },
    frame: 'earth',
    labels: names,
  });

  return {
    setVisible(visible) {
      group.visible = visible;
      labels.setVisible(visible);
    },
    setResolution(widthCss, heightCss) {
      lineMaterial.resolution.set(widthCss, heightCss);
    },
    dispose() {
      labels.remove();
      group.removeFromParent();
      markers.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
    },
  };
}
