/**
 * Surface lines - coastlines, borders, state lines, plate boundaries and
 * active faults - drawn as screen-width lines over the see-through globe.
 *
 * The camera stands at the surface, so every other surface point is seen
 * through the planet; lines therefore project straight onto the far side
 * and need no depth test against the raymarched globe. Data comes from
 * tools/pipeline/generate_geo.py (outlines.json, Natural Earth) and
 * generate_geology.py (tectonics.json, PB2002 and GEM faults) and
 * generate_plate_motion.py (plate-motion.json, NNR-MORVEL56 arrows).
 *
 * Two kinds of plate boundary are more than a line. A spreading ridge is
 * drawn with the seafloor it has made: a ribbon as wide as the crust of
 * the last SPREADING_RIBBON_MYR at the ridge's present rate, coloured by
 * that rate, with arrows showing the plates parting - so the slow
 * Mid-Atlantic Ridge is a thin dark-red band and the fast East Pacific
 * Rise a broad pale one. A subduction zone carries teeth on the overriding
 * plate, pointing the way the slab goes down, as on a geological map.
 * Ribbon, arrows and teeth have real sizes on the ground, not screen
 * sizes: they grow as the view nears them.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { RENDER_ORDER } from './order';
import { DETAIL_MIN_SEGMENTS, DetailSwitch, buildOutlineCells } from './outline-detail';

export type OutlineLayerName =
  | 'coastline'
  | 'borders'
  | 'states'
  | 'ridge'
  | 'transform'
  | 'collision'
  | 'subduction'
  /** Ridge ribbons and spreading arrows; built from the ridge lines and `ridgeSteps`. */
  | 'spreading'
  | 'fault-normal'
  | 'fault-reverse'
  | 'fault-strike-slip'
  | 'plate-motion';

/** The shape of app/public/geo/outlines.json and tectonics.json; each carries some of the layers. */
export interface OutlineData {
  readonly encoding: 'delta';
  readonly quantumPerDegree: number;
  readonly layers: Readonly<Partial<Record<OutlineLayerName, readonly (readonly number[])[]>>>;
  /** PB2002's plate motion across each step of each `ridge` polyline. */
  readonly ridgeSteps?: RidgeSteps;
  /** Per `subduction` polyline: +1 if the overriding plate is on the left of its direction, -1 if on the right. */
  readonly subductionOverriding?: readonly number[];
}

export interface RidgeSteps {
  /** Relative speed of the two plates, tenths of mm/yr: the full spreading rate. */
  readonly rate10: readonly (readonly number[])[];
  /** Direction of that motion, degrees east of north. */
  readonly azimuth: readonly (readonly number[])[];
}

export interface OutlineStyle {
  readonly color: number;
  /** CSS pixels. */
  readonly width: number;
  readonly opacity: number;
}

export const OUTLINE_STYLES: Readonly<Record<OutlineLayerName, OutlineStyle>> = {
  coastline: { color: 0x9fdcff, width: 1.6, opacity: 0.95 },
  borders: { color: 0xffd27a, width: 1.3, opacity: 0.9 },
  states: { color: 0xffffff, width: 1.0, opacity: 0.45 },
  // Plate boundaries: bold, one hue per kind.
  ridge: { color: 0xff9f1a, width: 1.8, opacity: 0.9 },
  transform: { color: 0x2ed573, width: 1.5, opacity: 0.9 },
  collision: { color: 0xb05cff, width: 2.0, opacity: 0.9 },
  // The trench is the top edge of a slab: DEPTH_RAMP's surface red, a little wider than the rest.
  subduction: { color: 0xff453a, width: 2.6, opacity: 0.95 },
  // Spreading arrows; the ribbon under them takes its colour from SPREADING_RAMP.
  spreading: { color: 0xfff1d6, width: 1.2, opacity: 0.9 },
  // Active faults: thin, so they read as texture under the boundaries.
  'fault-normal': { color: 0x00d2d3, width: 1.0, opacity: 0.75 },
  'fault-reverse': { color: 0xff6bcb, width: 1.0, opacity: 0.75 },
  'fault-strike-slip': { color: 0x5f8bff, width: 1.0, opacity: 0.75 },
  // Arrows: white, so they read as motion over every coloured line.
  'plate-motion': { color: 0xffffff, width: 1.4, opacity: 0.85 },
};

/** Draw order within a layer set: faults, then political lines, then plate boundaries, then motion arrows on top. */
const LAYER_ORDER: readonly OutlineLayerName[] = [
  'fault-normal',
  'fault-reverse',
  'fault-strike-slip',
  'states',
  'borders',
  'coastline',
  'ridge',
  'transform',
  'collision',
  'subduction',
  'plate-motion',
];

/** A ridge's ribbon covers the seafloor it makes in this long at its present rate. */
export const SPREADING_RIBBON_MYR = 3;
/**
 * Half the least width a ribbon is drawn, CSS px: from across the planet a
 * slow ridge's few million years of seafloor are a pixel or two, and it is
 * widened to this so it still shows as a band with two sides.
 */
export const SPREADING_RIBBON_MIN_HALF_PX = 4.5;

/** Full spreading rate (mm/yr) to colour: dull red where plates barely part, pale yellow at the fastest ridges. */
export const SPREADING_RAMP: readonly { readonly mmPerYr: number; readonly color: number }[] = [
  { mmPerYr: 0, color: 0xc4304a },
  { mmPerYr: 25, color: 0xff5a36 },
  { mmPerYr: 60, color: 0xff8a1f },
  { mmPerYr: 110, color: 0xffd23f },
  { mmPerYr: 160, color: 0xfff6c9 },
];

/** CSS linear-gradient of SPREADING_RAMP, slowest on the left. */
export function spreadingRampGradient(): string {
  const max = SPREADING_RAMP[SPREADING_RAMP.length - 1].mmPerYr;
  const stops = SPREADING_RAMP.map(
    (stop) => `#${stop.color.toString(16).padStart(6, '0')} ${((stop.mmPerYr / max) * 100).toFixed(1)}%`
  );
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Teeth along a trench: how far apart, how wide at the trench, how far they reach onto the overriding plate. */
export const TRENCH_TOOTH_KM = { spacing: 220, base: 110, height: 100 } as const;

/** Spreading arrows: a pair about this far apart along a ridge. */
const ARROW_SPACING_KM = 600;
/** No arrows on a ridge piece shorter than this. */
const ARROW_MIN_RIDGE_KM = 120;
const ARROW_HEAD_FRACTION = 0.4;
const ARROW_HEAD_ANGLE_RAD = (26 * Math.PI) / 180;
const EARTH_RADIUS_KM = EARTH_RADIUS_M / 1000;

/** Unit vectors of a delta-encoded polyline's points. */
function polylineUnits(encoded: readonly number[], quantumPerDegree: number): THREE.Vector3[] {
  const units: THREE.Vector3[] = [];
  const degToRad = Math.PI / 180 / quantumPerDegree;
  let lon = encoded[0];
  let lat = encoded[1];
  for (let i = 0; i < encoded.length; i += 2) {
    if (i > 0) {
      lon += encoded[i];
      lat += encoded[i + 1];
    }
    const cosLat = Math.cos(lat * degToRad);
    units[units.length] = new THREE.Vector3(
      cosLat * Math.cos(lon * degToRad),
      cosLat * Math.sin(lon * degToRad),
      Math.sin(lat * degToRad)
    );
  }
  return units;
}

/** Lengths of a polyline's steps over the ground, km. */
function stepLengthsKm(units: readonly THREE.Vector3[]): number[] {
  return units.slice(1).map((unit, i) => unit.angleTo(units[i]) * EARTH_RADIUS_KM);
}

/** The step holding the point `km` along a polyline, and how far into that step it lies (0..1). */
function locate(lengths: readonly number[], km: number): { step: number; t: number } {
  let step = 0;
  let rest = km;
  while (step < lengths.length - 1 && rest > lengths[step]) rest -= lengths[step++];
  return { step, t: lengths[step] > 0 ? Math.min(rest / lengths[step], 1) : 0 };
}

/** Unit vector along the ground at `unit`, `azimuthDeg` east of north. */
function azimuthDirection(unit: THREE.Vector3, azimuthDeg: number, target: THREE.Vector3): THREE.Vector3 {
  const horizontal = Math.hypot(unit.x, unit.y) || 1;
  const azimuth = (azimuthDeg * Math.PI) / 180;
  // north = d(unit)/d(lat), east = d(unit)/d(lon), both unit length.
  const nx = (-unit.z * unit.x) / horizontal;
  const ny = (-unit.z * unit.y) / horizontal;
  const nz = horizontal;
  const ex = -unit.y / horizontal;
  const ey = unit.x / horizontal;
  return target.set(
    nx * Math.cos(azimuth) + ex * Math.sin(azimuth),
    ny * Math.cos(azimuth) + ey * Math.sin(azimuth),
    nz * Math.cos(azimuth)
  );
}

/** The surface point `km` along the ground from `unit` in direction `dir`, in ECEF metres. */
function offsetPoint(unit: THREE.Vector3, dir: THREE.Vector3, km: number, target: THREE.Vector3): THREE.Vector3 {
  return target.copy(unit).addScaledVector(dir, Math.tan(km / EARTH_RADIUS_KM)).normalize().multiplyScalar(EARTH_RADIUS_M);
}

export interface RidgeRibbon {
  /** ECEF metres: the ridge point, three times over - for its left edge, the axis and its right edge. */
  readonly positions: Float32Array;
  /** ECEF metres from the ridge point to that vertex's place on the ground: zero on the axis. */
  readonly offsets: Float32Array;
  /** -1 on the left edge, 0 on the axis, +1 on the right. */
  readonly across: Float32Array;
  /** Full spreading rate, mm/yr. */
  readonly rates: Float32Array;
  readonly indices: Uint32Array;
}

/** Spreading rate (mm/yr) and direction at a point of a ridge polyline: the mean of the steps either side. */
function ridgePointMotion(rate10: readonly number[], azimuth: readonly number[], point: number): { rate: number; azimuth: number } {
  const before = Math.max(point - 1, 0);
  const after = Math.min(point, rate10.length - 1);
  // Neighbouring steps differ by a degree or two; average through sines and cosines all the same.
  const a = (azimuth[before] * Math.PI) / 180;
  const b = (azimuth[after] * Math.PI) / 180;
  return {
    rate: (rate10[before] + rate10[after]) / 20,
    azimuth: (Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b)) * 180) / Math.PI,
  };
}

/**
 * The ribbon of young seafloor along every ridge: at each point of the
 * axis it reaches, along the direction the plates part, as far as they
 * part in `myr` at the present rate - half to either side.
 */
export function ridgeRibbon(
  polylines: readonly (readonly number[])[],
  steps: RidgeSteps,
  quantumPerDegree: number,
  myr: number = SPREADING_RIBBON_MYR
): RidgeRibbon {
  let points = 0;
  for (const encoded of polylines) points += encoded.length / 2;
  const positions = new Float32Array(points * 9);
  const offsets = new Float32Array(points * 9);
  const across = new Float32Array(points * 3);
  const rates = new Float32Array(points * 3);
  const indices = new Uint32Array((points - polylines.length) * 12);
  let vertex = 0;
  let index = 0;
  const dir = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const left = new THREE.Vector3();
  const point = new THREE.Vector3();
  const axis = new THREE.Vector3();
  polylines.forEach((encoded, line) => {
    const units = polylineUnits(encoded, quantumPerDegree);
    units.forEach((unit, i) => {
      const motion = ridgePointMotion(steps.rate10[line], steps.azimuth[line], i);
      azimuthDirection(unit, motion.azimuth, dir);
      // Keep "left" on the left of the line's direction, so the ribbon never crosses itself.
      tangent.copy(units[Math.min(i + 1, units.length - 1)]).sub(units[Math.max(i - 1, 0)]);
      left.crossVectors(unit, tangent);
      if (dir.dot(left) < 0) dir.negate();
      // mm/yr times Myr is km.
      const halfKm = (motion.rate * myr) / 2;
      axis.copy(unit).multiplyScalar(EARTH_RADIUS_M);
      // Left edge (dir points left), axis, right edge; the axis vertex keeps a zero offset.
      for (const place of [-1, 0, 1]) {
        axis.toArray(positions, vertex * 3);
        if (place !== 0) offsetPoint(unit, dir, -place * halfKm, point).sub(axis).toArray(offsets, vertex * 3);
        across[vertex] = place;
        rates[vertex] = motion.rate;
        vertex++;
      }
      if (i === 0) return;
      const here = vertex - 3;
      const prev = here - 3;
      indices.set(
        [prev, here, here + 1, prev, here + 1, prev + 1, prev + 1, here + 1, here + 2, prev + 1, here + 2, prev + 2],
        index
      );
      index += 12;
    });
  });
  return { positions, offsets, across, rates, indices };
}

/** Append one arrow from `from` to `to` (ECEF) as segment endpoints, its barbs lying on the ground. */
function addArrow(from: THREE.Vector3, to: THREE.Vector3, out: number[]): void {
  const shaft = to.clone().sub(from);
  const length = shaft.length();
  const along = shaft.divideScalar(length);
  const side = new THREE.Vector3().crossVectors(along, to).normalize();
  const head = length * ARROW_HEAD_FRACTION;
  out[out.length] = from.x;
  out[out.length] = from.y;
  out[out.length] = from.z;
  out[out.length] = to.x;
  out[out.length] = to.y;
  out[out.length] = to.z;
  for (const s of [-1, 1]) {
    const barb = to
      .clone()
      .addScaledVector(along, -head * Math.cos(ARROW_HEAD_ANGLE_RAD))
      .addScaledVector(side, s * head * Math.sin(ARROW_HEAD_ANGLE_RAD));
    out[out.length] = to.x;
    out[out.length] = to.y;
    out[out.length] = to.z;
    out[out.length] = barb.x;
    out[out.length] = barb.y;
    out[out.length] = barb.z;
  }
}

/** A slow ridge's arrows are at least this long, so they can be seen at all. */
const ARROW_MIN_LENGTH_KM = 110;

/**
 * Paired arrows along the ridges, one each side, pointing the way that
 * side's plate leaves: from the ribbon's edge outward, as long again as
 * the ribbon's half-width. Returns line-segment endpoints, ECEF metres.
 */
export function spreadingArrows(
  polylines: readonly (readonly number[])[],
  steps: RidgeSteps,
  quantumPerDegree: number,
  myr: number = SPREADING_RIBBON_MYR
): Float32Array {
  const out: number[] = [];
  const dir = new THREE.Vector3();
  const unit = new THREE.Vector3();
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  polylines.forEach((encoded, line) => {
    const units = polylineUnits(encoded, quantumPerDegree);
    const lengths = stepLengthsKm(units);
    const total = lengths.reduce((sum, km) => sum + km, 0);
    if (total < ARROW_MIN_RIDGE_KM) return;
    const count = Math.max(1, Math.round(total / ARROW_SPACING_KM));
    for (let k = 0; k < count; k++) {
      // Evenly along the piece: a single pair sits at its middle.
      const { step, t } = locate(lengths, ((k + 0.5) / count) * total);
      unit.copy(units[step]).lerp(units[step + 1], t).normalize();
      azimuthDirection(unit, steps.azimuth[line][step], dir);
      const halfKm = (steps.rate10[line][step] / 10) * (myr / 2);
      const lengthKm = Math.max(halfKm, ARROW_MIN_LENGTH_KM);
      for (const side of [-1, 1]) {
        offsetPoint(unit, dir, side * halfKm, from);
        offsetPoint(unit, dir, side * (halfKm + lengthKm), to);
        addArrow(from, to, out);
      }
    }
  });
  return new Float32Array(out);
}

/**
 * Triangles (ECEF metres, three vertices each) for the teeth along every
 * trench: bases on the trench, points on the overriding plate.
 */
export function trenchTeeth(
  polylines: readonly (readonly number[])[],
  overriding: readonly number[],
  quantumPerDegree: number
): Float32Array {
  const out: number[] = [];
  const tangent = new THREE.Vector3();
  const inward = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  polylines.forEach((encoded, line) => {
    const units = polylineUnits(encoded, quantumPerDegree);
    const lengths = stepLengthsKm(units);
    const total = lengths.reduce((sum, km) => sum + km, 0);
    const count = Math.floor(total / TRENCH_TOOTH_KM.spacing);
    for (let k = 0; k < count; k++) {
      const { step, t } = locate(lengths, ((k + 0.5) / count) * total);
      centre.copy(units[step]).lerp(units[step + 1], t).normalize();
      tangent.copy(units[step + 1]).sub(units[step]).normalize();
      // up x forward is left.
      inward.crossVectors(centre, tangent).normalize().multiplyScalar(overriding[line]);
      offsetPoint(centre, tangent, -TRENCH_TOOTH_KM.base / 2, vertex).toArray(out, out.length);
      offsetPoint(centre, tangent, TRENCH_TOOTH_KM.base / 2, vertex).toArray(out, out.length);
      offsetPoint(centre, inward, TRENCH_TOOTH_KM.height, vertex).toArray(out, out.length);
    }
  });
  return new Float32Array(out);
}

const srgbVec3 = (color: number): string =>
  `vec3(${[(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff].map((c) => (c / 255).toFixed(5)).join(', ')})`;

/**
 * Each vertex sits on the ground at its real distance from the axis,
 * unless that is under uMinHalfPx on screen: then it is pushed out to it,
 * along the same direction.
 */
const RIBBON_VERTEX_SHADER = `
  attribute vec3 aOffset;
  attribute float aAcross;
  attribute float aRate;
  uniform vec2 uResolution;
  uniform float uMinHalfPx;
  varying float vAcross;
  varying float vRate;
  void main() {
    vAcross = aAcross;
    vRate = aRate;
    vec4 axis = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec4 edge = projectionMatrix * modelViewMatrix * vec4(position + aOffset, 1.0);
    gl_Position = edge;
    // Behind the eye there is no screen distance to widen.
    if (aAcross != 0.0 && axis.w > 0.0 && edge.w > 0.0) {
      vec2 px = (edge.xy / edge.w - axis.xy / axis.w) * 0.5 * uResolution;
      float lengthPx = length(px);
      if (lengthPx < uMinHalfPx && lengthPx > 1.0e-4) {
        vec2 ndc = axis.xy / axis.w + px / lengthPx * uMinHalfPx * 2.0 / uResolution;
        gl_Position = vec4(ndc * axis.w, axis.z, axis.w);
      }
    }
  }
`;

/**
 * The ribbon: brightest on the axis where the crust is new, fading to its
 * edges, each of which is a line - so even a ribbon a few pixels wide
 * reads as a rift with two sides. Colours are SPREADING_RAMP's display
 * values, written to the screen as they are, as the legend shows them.
 */
const RIBBON_FRAGMENT_SHADER = `
  uniform float uOpacity;
  varying float vAcross;
  varying float vRate;
  vec3 spreadingRamp(float rate) {
    vec3 color = ${srgbVec3(SPREADING_RAMP[0].color)};
${SPREADING_RAMP.slice(1)
  .map(
    (stop, i) =>
      `    color = mix(color, ${srgbVec3(stop.color)}, clamp((rate - ${SPREADING_RAMP[i].mmPerYr.toFixed(1)}) / ` +
      `${(stop.mmPerYr - SPREADING_RAMP[i].mmPerYr).toFixed(1)}, 0.0, 1.0));`
  )
  .join('\n')}
    return color;
  }
  void main() {
    float across = abs(vAcross);
    float edgePx = (1.0 - across) / max(fwidth(vAcross), 1.0e-6);
    float edge = 1.0 - smoothstep(0.5, 1.5, edgePx);
    float fill = mix(0.58, 0.10, smoothstep(0.0, 1.0, across));
    gl_FragColor = vec4(spreadingRamp(vRate), max(fill, edge * 0.8) * uOpacity);
  }
`;

/** The ribbon's fragment shader, for the test that it carries the legend's colours. */
export const RIDGE_RIBBON_FRAGMENT_SHADER = RIBBON_FRAGMENT_SHADER;

/** Place the outlines after the globe quad, which renders at order 0. */
const OUTLINE_RENDER_ORDER = RENDER_ORDER.outlines;
/**
 * Trenches draw after the slabs (RENDER_ORDER.interior): from inside the
 * Earth a slab lies in front of its own trench, and would hide the line
 * and teeth that mark where it starts down.
 */
const TRENCH_RENDER_ORDER = RENDER_ORDER.interior + 0.5;

/**
 * ECEF segment endpoints (x0,y0,z0, x1,y1,z1, ...) for delta-encoded
 * polylines on a sphere of `radius`. A step of more than 180° of longitude
 * would cut a chord through the planet, so it is dropped rather than drawn.
 */
export function outlineSegmentPositions(
  polylines: readonly (readonly number[])[],
  quantumPerDegree: number,
  radius: number = EARTH_RADIUS_M
): Float32Array {
  let segmentCount = 0;
  for (const encoded of polylines) segmentCount += encoded.length / 2 - 1;
  const positions = new Float32Array(segmentCount * 6);
  const degToRad = Math.PI / 180 / quantumPerDegree;
  let written = 0;

  for (const encoded of polylines) {
    let lon = encoded[0];
    let lat = encoded[1];
    let x0 = 0;
    let y0 = 0;
    let z0 = 0;
    for (let i = 0; i < encoded.length; i += 2) {
      if (i > 0) {
        lon += encoded[i];
        lat += encoded[i + 1];
      }
      const lonRad = lon * degToRad;
      const latRad = lat * degToRad;
      const cosLat = Math.cos(latRad);
      const x = radius * cosLat * Math.cos(lonRad);
      const y = radius * cosLat * Math.sin(lonRad);
      const z = radius * Math.sin(latRad);
      if (i > 0 && Math.abs(encoded[i]) <= 180 * quantumPerDegree) {
        positions[written++] = x0;
        positions[written++] = y0;
        positions[written++] = z0;
        positions[written++] = x;
        positions[written++] = y;
        positions[written++] = z;
      }
      x0 = x;
      y0 = y;
      z0 = z;
    }
  }
  return written === positions.length ? positions : positions.slice(0, written);
}

export class OutlineLayer {
  private readonly group = new THREE.Group();
  private readonly materials: LineMaterial[] = [];
  /** CSS-pixel viewport, shared with the ribbon's shader. */
  private readonly ribbonResolution = new THREE.Vector2(1, 1);
  /** CSS-pixel height of the viewport, for the dense sets' choice of detail. */
  private readonly viewportHeight = { value: 800 };

  constructor(data: OutlineData) {
    for (const name of LAYER_ORDER) {
      const polylines = data.layers[name];
      if (!polylines) continue;
      const style = OUTLINE_STYLES[name];
      const positions = outlineSegmentPositions(polylines, data.quantumPerDegree);
      const material = new LineMaterial({
        color: style.color,
        linewidth: style.width,
        transparent: style.opacity < 1,
        opacity: style.opacity,
        depthTest: false,
        depthWrite: false,
      });
      const renderOrder = name === 'subduction' ? TRENCH_RENDER_ORDER : OUTLINE_RENDER_ORDER;
      const drawLines = (segments: Float32Array, culled: boolean): LineSegments2 => {
        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(segments);
        const lines = new LineSegments2(geometry, material);
        lines.name = name;
        lines.frustumCulled = culled;
        lines.renderOrder = renderOrder;
        return lines;
      };
      this.materials.push(material);
      if (positions.length / 6 < DETAIL_MIN_SEGMENTS) {
        // Bounds of a planet-wide line set always contain the view; skip the test.
        this.group.add(drawLines(positions, false));
      } else {
        // A dense set: by cells, each culled when out of view and simplified when far (see outline-detail.ts).
        const cells = new THREE.Group();
        cells.name = name;
        for (const cell of buildOutlineCells(positions)) {
          const detail = new DetailSwitch(drawLines(cell.fine, true), drawLines(cell.coarse, true), cell.radiusM, this.viewportHeight);
          detail.position.set(cell.centre[0], cell.centre[1], cell.centre[2]);
          cells.add(detail);
        }
        this.group.add(cells);
      }
      if (name === 'ridge' && data.ridgeSteps) this.addSpreading(polylines, data.ridgeSteps, data.quantumPerDegree);
      if (name === 'subduction' && data.subductionOverriding) {
        this.addTeeth(polylines, data.subductionOverriding, data.quantumPerDegree);
      }
    }
  }

  /** The ribbon under the ridge lines, and the arrows over it. */
  private addSpreading(polylines: readonly (readonly number[])[], steps: RidgeSteps, quantumPerDegree: number): void {
    const ribbon = ridgeRibbon(polylines, steps, quantumPerDegree);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(ribbon.positions, 3));
    geometry.setAttribute('aOffset', new THREE.BufferAttribute(ribbon.offsets, 3));
    geometry.setAttribute('aAcross', new THREE.BufferAttribute(ribbon.across, 1));
    geometry.setAttribute('aRate', new THREE.BufferAttribute(ribbon.rates, 1));
    geometry.setIndex(new THREE.BufferAttribute(ribbon.indices, 1));
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: RIBBON_VERTEX_SHADER,
        fragmentShader: RIBBON_FRAGMENT_SHADER,
        uniforms: {
          uOpacity: { value: 1 },
          uResolution: { value: this.ribbonResolution },
          uMinHalfPx: { value: SPREADING_RIBBON_MIN_HALF_PX },
        },
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      })
    );
    mesh.name = 'spreading';
    mesh.frustumCulled = false;
    // Under every line, over the images draped on the surface.
    mesh.renderOrder = OUTLINE_RENDER_ORDER - 0.1;
    this.group.add(mesh);

    const style = OUTLINE_STYLES.spreading;
    const arrowGeometry = new LineSegmentsGeometry();
    arrowGeometry.setPositions(spreadingArrows(polylines, steps, quantumPerDegree));
    const arrowMaterial = new LineMaterial({
      color: style.color,
      linewidth: style.width,
      transparent: true,
      opacity: style.opacity,
      depthTest: false,
      depthWrite: false,
    });
    const arrows = new LineSegments2(arrowGeometry, arrowMaterial);
    arrows.name = 'spreading';
    arrows.frustumCulled = false;
    arrows.renderOrder = OUTLINE_RENDER_ORDER;
    this.materials.push(arrowMaterial);
    this.group.add(arrows);
  }

  private addTeeth(polylines: readonly (readonly number[])[], overriding: readonly number[], quantumPerDegree: number): void {
    const style = OUTLINE_STYLES.subduction;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(trenchTeeth(polylines, overriding, quantumPerDegree), 3));
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: style.color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: style.opacity,
        depthTest: false,
        depthWrite: false,
      })
    );
    mesh.name = 'subduction';
    mesh.frustumCulled = false;
    mesh.renderOrder = TRENCH_RENDER_ORDER;
    this.group.add(mesh);
  }

  getObject(): THREE.Object3D {
    return this.group;
  }

  /** Show or hide the named layers; names this data does not carry are ignored. */
  setLayersVisible(names: readonly OutlineLayerName[], visible: boolean): void {
    for (const child of this.group.children) {
      if ((names as readonly string[]).includes(child.name)) child.visible = visible;
    }
  }

  /** Line widths are in CSS pixels, so the material needs the CSS viewport size. */
  setResolution(widthCss: number, heightCss: number): void {
    for (const material of this.materials) material.resolution.set(widthCss, heightCss);
    this.ribbonResolution.set(widthCss, heightCss);
    this.viewportHeight.value = heightCss;
  }

  dispose(): void {
    this.group.traverse((object) => {
      const drawn = object as Partial<THREE.Mesh<THREE.BufferGeometry, THREE.Material>>;
      drawn.geometry?.dispose();
      drawn.material?.dispose();
    });
    this.group.clear();
  }
}
