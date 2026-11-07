/**
 * Coastlines, country borders and state/province lines on the surface,
 * drawn as screen-width lines over the see-through globe.
 *
 * The camera stands at the surface, so every other surface point is seen
 * through the planet; lines therefore project straight onto the far side
 * and need no depth test against the raymarched globe. Data comes from
 * tools/pipeline/generate_geo.py (Natural Earth, public domain).
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EARTH_RADIUS_M } from '@transparent-earth/core';

export type OutlineLayerName = 'coastline' | 'borders' | 'states';

/** The shape of app/public/geo/outlines.json. */
export interface OutlineData {
  readonly encoding: 'delta';
  readonly quantumPerDegree: number;
  readonly layers: Readonly<Record<OutlineLayerName, readonly (readonly number[])[]>>;
}

interface OutlineStyle {
  readonly color: number;
  /** CSS pixels. */
  readonly width: number;
  readonly opacity: number;
}

const OUTLINE_STYLES: Readonly<Record<OutlineLayerName, OutlineStyle>> = {
  coastline: { color: 0x9fdcff, width: 1.6, opacity: 0.95 },
  borders: { color: 0xffd27a, width: 1.3, opacity: 0.9 },
  states: { color: 0xffffff, width: 1.0, opacity: 0.45 },
};

/** Draw order: states under borders under coastline. */
const LAYER_ORDER: readonly OutlineLayerName[] = ['states', 'borders', 'coastline'];

/** Place the outlines after the globe quad, which renders at order 0. */
const OUTLINE_RENDER_ORDER = 1;

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

  constructor(data: OutlineData) {
    for (const name of LAYER_ORDER) {
      const style = OUTLINE_STYLES[name];
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(outlineSegmentPositions(data.layers[name], data.quantumPerDegree));
      const material = new LineMaterial({
        color: style.color,
        linewidth: style.width,
        transparent: style.opacity < 1,
        opacity: style.opacity,
        depthTest: false,
        depthWrite: false,
      });
      const lines = new LineSegments2(geometry, material);
      lines.name = name;
      // Bounds of a planet-wide line set always contain the view; skip the test.
      lines.frustumCulled = false;
      lines.renderOrder = OUTLINE_RENDER_ORDER;
      this.materials.push(material);
      this.group.add(lines);
    }
  }

  getObject(): THREE.Object3D {
    return this.group;
  }

  /** Line widths are in CSS pixels, so the material needs the CSS viewport size. */
  setResolution(widthCss: number, heightCss: number): void {
    for (const material of this.materials) material.resolution.set(widthCss, heightCss);
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
