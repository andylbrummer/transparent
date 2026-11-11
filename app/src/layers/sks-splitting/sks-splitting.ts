/**
 * SKS splitting: at each seismic station that has measured it, a bar along
 * the direction in which shear waves from the core travelled fastest on
 * their way up, its length the delay between the fast and slow waves. Bars
 * and rings are screen-width lines on the surface, over the draped maps.
 */

import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { RENDER_ORDER } from '../../render/order';
import { createLineLayer } from '../line-layer';
import type { LayerContext, LayerInstance } from '../types';
import { NULL_COLOR, barGeometry, decodeStations, nullRingPositions, type SksFile } from './stations';

class SksLines {
  private readonly group = new THREE.Group();
  private readonly materials: LineMaterial[] = [];
  private readonly geometries: LineSegmentsGeometry[] = [];

  constructor(file: SksFile) {
    const stations = decodeStations(file);
    const bars = barGeometry(stations);
    this.add('sks-bars', bars.positions, bars.colors, new LineMaterial({ vertexColors: true, linewidth: 1.6, transparent: true, opacity: 0.95 }));
    this.add('sks-nulls', nullRingPositions(stations), null, new LineMaterial({ color: NULL_COLOR, linewidth: 1.2, transparent: true, opacity: 0.8 }));
  }

  private add(name: string, positions: Float32Array, colors: Float32Array | null, material: LineMaterial): void {
    if (positions.length === 0) return;
    material.depthTest = false;
    material.depthWrite = false;
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    if (colors) geometry.setColors(colors);
    const lines = new LineSegments2(geometry, material);
    lines.name = name;
    lines.frustumCulled = false;
    lines.renderOrder = RENDER_ORDER.outlines + 0.1;
    this.group.add(lines);
    this.materials.push(material);
    this.geometries.push(geometry);
  }

  getObject(): THREE.Object3D {
    return this.group;
  }

  setResolution(widthCss: number, heightCss: number): void {
    for (const material of this.materials) material.resolution.set(widthCss, heightCss);
  }

  dispose(): void {
    for (const material of this.materials) material.dispose();
    for (const geometry of this.geometries) geometry.dispose();
  }
}

export function createSksLayer(context: LayerContext): Promise<LayerInstance> {
  return createLineLayer<SksFile>(context, 'geo/sks-splitting.json', (file) => new SksLines(file));
}
