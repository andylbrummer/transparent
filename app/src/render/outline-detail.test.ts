import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import {
  CELL_COUNT,
  DETAIL_MIN_SEGMENTS,
  DetailSwitch,
  SIMPLIFY_MAX_ERROR_PX,
  SIMPLIFY_TOLERANCE_M,
  buildOutlineCells,
  cellOf,
  simplifyPolyline,
  useSimplified,
} from './outline-detail';
import { OutlineLayer, outlineSegmentPositions } from './outlines';

/** A wiggling line along the equator from lon0, `steps` steps of `stepDeg`, wandering `wiggleDeg` north and south. */
function wiggle(lon0: number, steps: number, stepDeg: number, wiggleDeg: number): number[] {
  const encoded = [Math.round(lon0 * 100), 0];
  let lat = 0;
  for (let i = 1; i <= steps; i++) {
    const next = i % 2 === 0 ? 0 : wiggleDeg;
    encoded.push(Math.round(stepDeg * 100), Math.round((next - lat) * 100));
    lat = next;
  }
  return encoded;
}

describe('cellOf', () => {
  it('gives every direction one of 24 cells, and near directions the same one', () => {
    const seen = new Set<number>();
    for (let lat = -85; lat <= 85; lat += 10) {
      for (let lon = -175; lon <= 175; lon += 10) {
        const c = Math.cos((lat * Math.PI) / 180);
        seen.add(cellOf(c * Math.cos((lon * Math.PI) / 180), c * Math.sin((lon * Math.PI) / 180), Math.sin((lat * Math.PI) / 180)));
      }
    }
    expect(seen.size).toBe(CELL_COUNT);
    expect(Math.max(...seen)).toBe(CELL_COUNT - 1);
    expect(cellOf(1, 0.2, 0.2)).toBe(cellOf(1, 0.21, 0.19));
    expect(cellOf(1, 0.2, 0.2)).not.toBe(cellOf(1, -0.2, 0.2));
    expect(cellOf(1, 0.2, 0.2)).not.toBe(cellOf(-1, 0.2, 0.2));
  });
});

describe('simplifyPolyline', () => {
  it('drops points within the tolerance of the line and keeps the corner that is not', () => {
    // An L: along x, a small bump, then up y.
    const points = [0, 0, 0, 5, 0.5, 0, 10, 0, 0, 10, 10, 0];
    expect(simplifyPolyline(points, 0, 4, 1)).toEqual([0, 2, 3]);
    expect(simplifyPolyline(points, 0, 4, 0.1)).toEqual([0, 1, 2, 3]);
  });

  it('keeps a mark for a closed ring smaller than the tolerance', () => {
    const ring = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0];
    const kept = simplifyPolyline(ring, 0, 5, 10);
    // Both ends (the same point) and the corner farthest from it.
    expect(kept).toEqual([0, 2, 4]);
  });

  it('never strays further than the tolerance from the line it replaces', () => {
    const segments = outlineSegmentPositions([wiggle(0, 400, 0.05, 0.02)], 100);
    const points: number[] = [segments[0], segments[1], segments[2]];
    for (let i = 3; i < segments.length; i += 6) points.push(segments[i], segments[i + 1], segments[i + 2]);
    const count = points.length / 3;
    const tolerance = 3000;
    const kept = simplifyPolyline(points, 0, count, tolerance);
    // 0.02° of wiggle is 2.2 km: all of it is under the tolerance.
    expect(kept.length).toBeLessThan(count / 20);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const p = new THREE.Vector3();
    const line = new THREE.Line3();
    const nearest = new THREE.Vector3();
    for (let k = 1; k < kept.length; k++) {
      line.set(a.fromArray(points, kept[k - 1] * 3), b.fromArray(points, kept[k] * 3));
      for (let i = kept[k - 1] + 1; i < kept[k]; i++) {
        p.fromArray(points, i * 3);
        expect(line.closestPointToPoint(p, true, nearest).distanceTo(p)).toBeLessThanOrEqual(tolerance + 1);
      }
    }
  });
});

describe('buildOutlineCells', () => {
  // A line right round the equator, in steps of 0.05° wiggling 0.02°: 7200 segments through eight cells.
  const segments = outlineSegmentPositions([wiggle(-179.9, 7190, 0.05, 0.02)], 100);
  const cells = buildOutlineCells(segments);

  it('keeps every segment, each in the cell of its midpoint, about that cell centre', () => {
    expect(cells.reduce((n, cell) => n + cell.fine.length / 6, 0)).toBe(segments.length / 6);
    expect(cells.length).toBe(8);
    for (const cell of cells) {
      const centre = new THREE.Vector3(...cell.centre);
      for (let i = 0; i < cell.fine.length; i += 3) {
        const point = new THREE.Vector3(cell.fine[i], cell.fine[i + 1], cell.fine[i + 2]);
        expect(point.length()).toBeLessThanOrEqual(cell.radiusM + 1);
        // Back on the sphere once the centre is added.
        expect(Math.abs(point.add(centre).length() - EARTH_RADIUS_M)).toBeLessThan(2);
      }
    }
  });

  it('simplifies each cell to a small fraction of its segments, ends meeting the next cell', () => {
    const fine = cells.reduce((n, cell) => n + cell.fine.length / 6, 0);
    const coarse = cells.reduce((n, cell) => n + cell.coarse.length / 6, 0);
    expect(coarse).toBeGreaterThan(0);
    expect(coarse).toBeLessThan(fine / 10);
    // Every simplified cell's first and last points are points of the real line: nothing is cut short at a border.
    const onRealLine = (x: number, y: number, z: number): boolean => {
      for (let i = 0; i < segments.length; i += 3) {
        if (Math.abs(segments[i] - x) < 2 && Math.abs(segments[i + 1] - y) < 2 && Math.abs(segments[i + 2] - z) < 2) return true;
      }
      return false;
    };
    for (const cell of cells) {
      for (const at of [0, cell.coarse.length - 3]) {
        expect(onRealLine(cell.coarse[at] + cell.centre[0], cell.coarse[at + 1] + cell.centre[1], cell.coarse[at + 2] + cell.centre[2])).toBe(true);
      }
    }
  });
});

describe('useSimplified', () => {
  it('shows the simplified lines across the planet in the default view, and the real ones close by or zoomed in', () => {
    // A phone in portrait, 60° field of view: 772 CSS px per radian.
    const phone = 892 / (2 * Math.tan(Math.PI / 6));
    expect(useSimplified(10_000_000, phone)).toBe(true);
    expect(useSimplified(500_000, phone)).toBe(false);
    // Zoomed to 5°, the same far coast is drawn in full.
    const zoomed = 892 / (2 * Math.tan((2.5 * Math.PI) / 180));
    expect(useSimplified(10_000_000, zoomed)).toBe(false);
    // At the switch the error is exactly the allowed fraction of a pixel.
    const switchAt = (SIMPLIFY_TOLERANCE_M * phone) / SIMPLIFY_MAX_ERROR_PX;
    expect(useSimplified(switchAt * 1.01, phone)).toBe(true);
    expect(useSimplified(switchAt * 0.99, phone)).toBe(false);
  });
});

describe('DetailSwitch', () => {
  it('chooses for the camera about to draw, by distance to the nearest of its lines and by zoom', () => {
    const fine = new THREE.Object3D();
    const coarse = new THREE.Object3D();
    const detail = new DetailSwitch(fine, coarse, 1_000_000, { value: 892 });
    detail.position.set(0, 0, -EARTH_RADIUS_M);
    const camera = new THREE.PerspectiveCamera(60, 0.5, 0.1, 1e9);
    camera.position.set(0, 0, EARTH_RADIUS_M);
    detail.update(camera);
    expect([fine.visible, coarse.visible]).toEqual([false, true]);
    camera.fov = 5;
    detail.update(camera);
    expect([fine.visible, coarse.visible]).toEqual([true, false]);
    camera.fov = 60;
    camera.position.set(0, 0, -EARTH_RADIUS_M + 1_200_000);
    detail.update(camera);
    expect([fine.visible, coarse.visible]).toEqual([true, false]);
    // What makes the renderer call update before each render.
    expect(detail.isLOD && detail.autoUpdate).toBe(true);
  });
});

describe('OutlineLayer with a dense line set', () => {
  it('draws it by culled cells of two versions under the layer name, and still switches it by name', () => {
    const steps = DETAIL_MIN_SEGMENTS + 100;
    const layer = new OutlineLayer({
      encoding: 'delta',
      quantumPerDegree: 100,
      layers: { coastline: [wiggle(-170, steps, 0.03, 0.02)], borders: [[0, 0, 10, 10]] },
    });
    const [borders, coastline] = layer.getObject().children;
    expect([borders.name, coastline.name]).toEqual(['borders', 'coastline']);
    expect(borders.children).toHaveLength(0);
    expect(coastline.children.length).toBeGreaterThan(1);
    let segments = 0;
    for (const cell of coastline.children) {
      expect(cell).toBeInstanceOf(DetailSwitch);
      const [fine, coarse] = cell.children as THREE.Mesh[];
      expect(fine.frustumCulled && coarse.frustumCulled).toBe(true);
      expect(fine.material).toBe(coarse.material);
      segments += (fine.geometry as THREE.InstancedBufferGeometry).getAttribute('instanceStart').count;
    }
    expect(segments).toBe(steps);
    layer.setLayersVisible(['coastline'], false);
    expect(coastline.visible).toBe(false);
    layer.dispose();
  });
});
