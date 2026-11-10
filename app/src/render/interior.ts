/**
 * The Earth below the surface: subducting slabs, mantle plumes and
 * earthquake hypocentres, each at its real depth.
 *
 * Like the surface lines they draw over the raymarched globe without a
 * depth test - the globe is see-through - so depth reads from colour:
 * slabs and quakes share one ramp (DEPTH_RAMP), so a quake sitting on a
 * slab is the slab's colour. Data comes from tools/pipeline/
 * generate_seismicity.py (slabs.json, quakes.json), generate_geology.py
 * (the plumes of geology.json) and generate_mantle_flow.py
 * (mantle-flow.json).
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { outlineSegmentPositions } from './outlines';

/** Depth (km) to colour, seismology's usual shallow-red to deep-violet. */
export const DEPTH_RAMP: readonly { readonly depthKm: number; readonly color: number }[] = [
  { depthKm: 0, color: 0xff453a },
  { depthKm: 70, color: 0xff9f0a },
  { depthKm: 150, color: 0xffd60a },
  { depthKm: 300, color: 0x32d74b },
  { depthKm: 500, color: 0x0a84ff },
  { depthKm: 700, color: 0xbf5af2 },
];

/** DEPTH_RAMP's stops as display (sRGB) channels, 0..1. */
const rampSrgb: readonly (readonly [number, number, number])[] = DEPTH_RAMP.map((stop) => [
  ((stop.color >> 16) & 0xff) / 255,
  ((stop.color >> 8) & 0xff) / 255,
  (stop.color & 0xff) / 255,
]);

/**
 * Colour for a depth on DEPTH_RAMP, written into `target`. Clamps past either end.
 *
 * Between stops it blends the display values, as the CSS gradient of the
 * legend does (depthRampGradient): a quake, a slab and the legend bar show
 * one colour for one depth. Blending THREE.Color's linear-light channels
 * instead would match at the stops only, and be up to 28/255 brighter between.
 */
export function depthColor(depthKm: number, target: THREE.Color): THREE.Color {
  const last = DEPTH_RAMP.length - 1;
  let i = 1;
  while (i < last && DEPTH_RAMP[i].depthKm < depthKm) i++;
  const span = DEPTH_RAMP[i].depthKm - DEPTH_RAMP[i - 1].depthKm;
  const t = Math.min(Math.max((depthKm - DEPTH_RAMP[i - 1].depthKm) / span, 0), 1);
  const a = rampSrgb[i - 1];
  const b = rampSrgb[i];
  return target.setRGB(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, THREE.SRGBColorSpace);
}

/**
 * GLSL `vec3 depthRampSrgb(float depthKm)`: DEPTH_RAMP as display values,
 * for a shader that writes its colour to the screen as it is (no
 * colorspace_fragment). The same blend as depthColor and the legend.
 */
export const DEPTH_RAMP_GLSL = `
  vec3 depthRampSrgb(float depthKm) {
    vec3 color = vec3(${rampSrgb[0].map((c) => c.toFixed(5)).join(', ')});
${DEPTH_RAMP.slice(1)
  .map(
    (stop, i) =>
      `    color = mix(color, vec3(${rampSrgb[i + 1].map((c) => c.toFixed(5)).join(', ')}), ` +
      `clamp((depthKm - ${DEPTH_RAMP[i].depthKm.toFixed(1)}) / ${(stop.depthKm - DEPTH_RAMP[i].depthKm).toFixed(1)}, 0.0, 1.0));`
  )
  .join('\n')}
    return color;
  }
`;

/** CSS linear-gradient of DEPTH_RAMP, left = surface, for a legend 0..maxKm wide. */
export function depthRampGradient(maxKm: number): string {
  const stops = DEPTH_RAMP.map(
    (stop) => `#${stop.color.toString(16).padStart(6, '0')} ${((stop.depthKm / maxKm) * 100).toFixed(1)}%`
  );
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** ECEF point at a geodetic-sphere position and depth below the surface. */
export function ecefAtDepth(lonDeg: number, latDeg: number, depthKm: number, target: THREE.Vector3): THREE.Vector3 {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const r = EARTH_RADIUS_M - depthKm * 1000;
  return target.set(r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat));
}

/** Draw after the globe (order 0) and the surface lines (1). */
const INTERIOR_RENDER_ORDER = 2;

function fatLines(positions: Float32Array, colors: Float32Array | null, material: LineMaterial, name: string): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  if (colors) geometry.setColors(colors);
  const lines = new LineSegments2(geometry, material);
  lines.name = name;
  lines.frustumCulled = false;
  lines.renderOrder = INTERIOR_RENDER_ORDER;
  return lines;
}

function lineMaterial(params: { color?: number; vertexColors?: boolean; width: number; opacity: number }): LineMaterial {
  return new LineMaterial({
    color: params.color ?? 0xffffff,
    vertexColors: params.vertexColors ?? false,
    linewidth: params.width,
    transparent: true,
    opacity: params.opacity,
    depthTest: false,
    depthWrite: false,
  });
}

/** Line layers drawn in CSS-pixel widths: share resolution and disposal. */
abstract class InteriorLines {
  protected readonly group = new THREE.Group();
  protected readonly materials: LineMaterial[] = [];

  getObject(): THREE.Object3D {
    return this.group;
  }

  setResolution(widthCss: number, heightCss: number): void {
    for (const material of this.materials) material.resolution.set(widthCss, heightCss);
  }

  protected add(lines: LineSegments2): void {
    this.materials.push(lines.material as LineMaterial);
    this.group.add(lines);
  }

  dispose(): void {
    for (const child of this.group.children) {
      const lines = child as LineSegments2;
      lines.geometry.dispose();
      (lines.material as LineMaterial).dispose();
    }
    this.group.clear();
  }
}

/** The shape of app/public/geo/slabs.json. */
export interface SlabData {
  readonly encoding: 'delta';
  readonly quantumPerDegree: number;
  readonly contours: readonly { readonly depthKm: number; readonly polylines: readonly (readonly number[])[] }[];
}

/** Slab2 depth contours, each at its depth and in its DEPTH_RAMP colour. */
export class SlabLayer extends InteriorLines {
  constructor(data: SlabData) {
    super();
    const parts: Float32Array[] = [];
    for (const contour of data.contours) {
      parts.push(outlineSegmentPositions(contour.polylines, data.quantumPerDegree, EARTH_RADIUS_M - contour.depthKm * 1000));
    }
    const positions = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    const colors = new Float32Array(positions.length);
    const color = new THREE.Color();
    let offset = 0;
    data.contours.forEach((contour, i) => {
      positions.set(parts[i], offset);
      depthColor(contour.depthKm, color);
      for (let v = offset; v < offset + parts[i].length; v += 3) {
        colors[v] = color.r;
        colors[v + 1] = color.g;
        colors[v + 2] = color.b;
      }
      offset += parts[i].length;
    });
    this.add(fatLines(positions, colors, lineMaterial({ vertexColors: true, width: 1.4, opacity: 0.8 }), 'slabs'));
  }
}

/** A conduit from geology.json's plumes. */
export interface Plume {
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
  /** Where the conduit ends, at its deepest depth (possibleDepthKm ?? depthKm). */
  readonly rootLon: number;
  readonly rootLat: number;
  /** Depth the plume is imaged to. */
  readonly depthKm: number;
  /** Depth it may reach beyond that, drawn faint. */
  readonly possibleDepthKm?: number;
}

export const PLUME_COLOR = 0xffb15c;

/**
 * Plume conduits: solid from the hotspot down to the depth tomography
 * images them to, faint beyond to where they may reach. A conduit with an
 * imaged root off-axis leans toward it.
 */
export class PlumeLayer extends InteriorLines {
  constructor(plumes: readonly Plume[]) {
    super();
    const imaged: number[] = [];
    const possible: number[] = [];
    const top = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const bottom = new THREE.Vector3();
    for (const plume of plumes) {
      const deepest = plume.possibleDepthKm ?? plume.depthKm;
      const t = plume.depthKm / deepest;
      ecefAtDepth(plume.lon, plume.lat, 0, top);
      ecefAtDepth(plume.rootLon, plume.rootLat, deepest, bottom);
      ecefAtDepth(
        plume.lon + (plume.rootLon - plume.lon) * t,
        plume.lat + (plume.rootLat - plume.lat) * t,
        plume.depthKm,
        mid
      );
      imaged.push(top.x, top.y, top.z, mid.x, mid.y, mid.z);
      if (plume.possibleDepthKm !== undefined) possible.push(mid.x, mid.y, mid.z, bottom.x, bottom.y, bottom.z);
    }
    this.add(fatLines(new Float32Array(imaged), null, lineMaterial({ color: PLUME_COLOR, width: 3, opacity: 0.9 }), 'plumes'));
    if (possible.length > 0) {
      this.add(
        fatLines(new Float32Array(possible), null, lineMaterial({ color: PLUME_COLOR, width: 2, opacity: 0.3 }), 'plumes-possible')
      );
    }
  }
}

/** The shape of app/public/geo/mantle-flow.json: per shell, columns of flow velocity. */
export interface MantleFlowData {
  readonly quantumPerDegree: number;
  /** Arrows show this many Myr of travel. */
  readonly arrowMyr: number;
  readonly shells: readonly {
    readonly depthKm: number;
    readonly lon: readonly number[];
    readonly lat: readonly number[];
    /** Velocity in tenths of mm/yr (0.1 km/Myr). */
    readonly east10: readonly number[];
    readonly north10: readonly number[];
    readonly up10: readonly number[];
  }[];
}

/** Arrow colours by vertical motion: away from the depth ramp's reds and blues. */
export const FLOW_RISING_COLOR = 0xff8c42;
export const FLOW_LEVEL_COLOR = 0xd8d8d8;
export const FLOW_SINKING_COLOR = 0x40c8ff;
/** Vertical speed (mm/yr) at which an arrow takes the full rising or sinking colour. */
export const FLOW_FULL_COLOR_MM_YR = 10;
const FLOW_HEAD_FRACTION = 0.3;
const FLOW_HEAD_ANGLE_RAD = (28 * Math.PI) / 180;

const flowColors = {
  rising: new THREE.Color(FLOW_RISING_COLOR),
  level: new THREE.Color(FLOW_LEVEL_COLOR),
  sinking: new THREE.Color(FLOW_SINKING_COLOR),
};

/** Arrow colour for a vertical speed in mm/yr, written into `target`. */
export function flowColor(upMmYr: number, target: THREE.Color): THREE.Color {
  const t = Math.min(Math.abs(upMmYr) / FLOW_FULL_COLOR_MM_YR, 1);
  return target.copy(flowColors.level).lerp(upMmYr >= 0 ? flowColors.rising : flowColors.sinking, t);
}

/** CSS legend for the flow colours, sinking on the left. */
export function flowGradient(): string {
  const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
  return `linear-gradient(to right, ${hex(FLOW_SINKING_COLOR)}, ${hex(FLOW_LEVEL_COLOR)}, ${hex(FLOW_RISING_COLOR)})`;
}

/**
 * Segment endpoints of one 3D arrow from `base` along `displacement`, its
 * head's barbs in the plane of the arrow and the local horizontal
 * perpendicular to it, so a rising arrow's head reads from above.
 */
export function flowArrowSegments(base: THREE.Vector3, displacement: THREE.Vector3, out: number[]): void {
  const length = displacement.length();
  if (length === 0) return;
  const tip = base.clone().add(displacement);
  const dir = displacement.clone().divideScalar(length);
  const side = new THREE.Vector3().crossVectors(dir, base).normalize();
  if (side.lengthSq() === 0) side.set(-base.y, base.x, 0).normalize();
  const head = length * FLOW_HEAD_FRACTION;
  out.push(base.x, base.y, base.z, tip.x, tip.y, tip.z);
  for (const s of [-1, 1]) {
    const barb = tip
      .clone()
      .addScaledVector(dir, -head * Math.cos(FLOW_HEAD_ANGLE_RAD))
      .addScaledVector(side, s * head * Math.sin(FLOW_HEAD_ANGLE_RAD));
    out.push(tip.x, tip.y, tip.z, barb.x, barb.y, barb.z);
  }
}

/**
 * Modelled mantle flow: on each depth shell an arrow per point, the path a
 * parcel takes in `arrowMyr`, coloured by whether it rises or sinks.
 */
export class MantleFlowLayer extends InteriorLines {
  constructor(data: MantleFlowData) {
    super();
    const positions: number[] = [];
    const colors: number[] = [];
    const base = new THREE.Vector3();
    const displacement = new THREE.Vector3();
    const east = new THREE.Vector3();
    const north = new THREE.Vector3();
    const up = new THREE.Vector3();
    const color = new THREE.Color();
    // 0.1 mm/yr = 0.1 km/Myr = 100 m/Myr.
    const metresPerUnit = 100 * data.arrowMyr;
    for (const shell of data.shells) {
      for (let i = 0; i < shell.lon.length; i++) {
        const lon = ((shell.lon[i] / data.quantumPerDegree) * Math.PI) / 180;
        const lat = ((shell.lat[i] / data.quantumPerDegree) * Math.PI) / 180;
        ecefAtDepth(shell.lon[i] / data.quantumPerDegree, shell.lat[i] / data.quantumPerDegree, shell.depthKm, base);
        east.set(-Math.sin(lon), Math.cos(lon), 0);
        north.set(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat));
        up.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
        displacement
          .set(0, 0, 0)
          .addScaledVector(east, shell.east10[i] * metresPerUnit)
          .addScaledVector(north, shell.north10[i] * metresPerUnit)
          .addScaledVector(up, shell.up10[i] * metresPerUnit);
        const before = positions.length;
        flowArrowSegments(base, displacement, positions);
        flowColor(shell.up10[i] / 10, color);
        for (let v = before; v < positions.length; v += 3) colors.push(color.r, color.g, color.b);
      }
    }
    this.add(
      fatLines(
        new Float32Array(positions),
        new Float32Array(colors),
        lineMaterial({ vertexColors: true, width: 1.3, opacity: 0.85 }),
        'mantle-flow'
      )
    );
  }
}
