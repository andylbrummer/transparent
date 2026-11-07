/**
 * The Earth below the surface: subducting slabs, mantle plumes and
 * earthquake hypocentres, each at its real depth.
 *
 * Like the surface lines they draw over the raymarched globe without a
 * depth test - the globe is see-through - so depth reads from colour:
 * slabs and quakes share one ramp (DEPTH_RAMP), so a quake sitting on a
 * slab is the slab's colour. Data comes from tools/pipeline/
 * generate_seismicity.py (slabs.json, quakes.json) and generate_geology.py
 * (the plumes of geology.json).
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

const rampColors = DEPTH_RAMP.map((stop) => new THREE.Color(stop.color));

/** Colour for a depth on DEPTH_RAMP, written into `target`. Clamps past either end. */
export function depthColor(depthKm: number, target: THREE.Color): THREE.Color {
  const last = DEPTH_RAMP.length - 1;
  if (depthKm <= DEPTH_RAMP[0].depthKm) return target.copy(rampColors[0]);
  if (depthKm >= DEPTH_RAMP[last].depthKm) return target.copy(rampColors[last]);
  let i = 1;
  while (DEPTH_RAMP[i].depthKm < depthKm) i++;
  const t = (depthKm - DEPTH_RAMP[i - 1].depthKm) / (DEPTH_RAMP[i].depthKm - DEPTH_RAMP[i - 1].depthKm);
  return target.copy(rampColors[i - 1]).lerp(rampColors[i], t);
}

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
