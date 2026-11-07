import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { OutlineLayer, outlineSegmentPositions } from './outlines';

function point(positions: Float32Array, index: number): THREE.Vector3 {
  return new THREE.Vector3(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
}

describe('outlineSegmentPositions', () => {
  it('decodes delta polylines into ECEF segment endpoints on the surface', () => {
    // LA (-118.24, 34.05) -> San Diego (-117.16, 32.72), hundredths of a degree.
    const positions = outlineSegmentPositions([[-11824, 3405, 108, -133]], 100);
    expect(positions).toHaveLength(6);

    const la = point(positions, 0);
    expect(la.length()).toBeCloseTo(EARTH_RADIUS_M, -1);
    expect((Math.atan2(la.y, la.x) * 180) / Math.PI).toBeCloseTo(-118.24, 4);
    expect((Math.asin(la.z / la.length()) * 180) / Math.PI).toBeCloseTo(34.05, 4);
    const sanDiego = point(positions, 1);
    expect((Math.atan2(sanDiego.y, sanDiego.x) * 180) / Math.PI).toBeCloseTo(-117.16, 4);
  });

  it('chains a polyline into consecutive segments', () => {
    const positions = outlineSegmentPositions([[0, 0, 100, 0, 100, 0]], 100);
    expect(positions).toHaveLength(12);
    // The second segment starts where the first ended.
    expect(point(positions, 2).toArray()).toEqual(point(positions, 1).toArray());
  });

  it('drops a step across the antimeridian instead of cutting a chord through the planet', () => {
    const positions = outlineSegmentPositions([[17990, 0, -35980, 0, -10, 0]], 100);
    expect(positions).toHaveLength(6);
  });
});

describe('OutlineLayer', () => {
  it('draws every layer after the globe, without frustum culling', () => {
    const layer = new OutlineLayer({
      encoding: 'delta',
      quantumPerDegree: 100,
      layers: { coastline: [[0, 0, 10, 10]], borders: [[0, 0, 10, 10]], states: [[0, 0, 10, 10]] },
    });
    const children = layer.getObject().children;
    expect(children.map((c) => c.name)).toEqual(['states', 'borders', 'coastline']);
    for (const child of children) {
      expect(child.frustumCulled).toBe(false);
      expect(child.renderOrder).toBeGreaterThan(0);
    }
    layer.dispose();
  });
});
