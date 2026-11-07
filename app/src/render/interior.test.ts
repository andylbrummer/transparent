import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { DEPTH_RAMP, PlumeLayer, SlabLayer, depthColor, depthRampGradient, ecefAtDepth } from './interior';

/** Segment endpoints of a fat-line object, as [start, end] vectors. */
function segments(lines: THREE.Object3D): [THREE.Vector3, THREE.Vector3][] {
  const geometry = (lines as LineSegments2).geometry;
  const start = geometry.getAttribute('instanceStart');
  const end = geometry.getAttribute('instanceEnd');
  const out: [THREE.Vector3, THREE.Vector3][] = [];
  for (let i = 0; i < start.count; i++) {
    out.push([
      new THREE.Vector3(start.getX(i), start.getY(i), start.getZ(i)),
      new THREE.Vector3(end.getX(i), end.getY(i), end.getZ(i)),
    ]);
  }
  return out;
}

const lonOf = (v: THREE.Vector3): number => (Math.atan2(v.y, v.x) * 180) / Math.PI;
const depthKmOf = (v: THREE.Vector3): number => (EARTH_RADIUS_M - v.length()) / 1000;

describe('depthColor', () => {
  it('hits each ramp stop and blends between them', () => {
    const color = new THREE.Color();
    for (const stop of DEPTH_RAMP) expect(depthColor(stop.depthKm, color).getHex()).toBe(stop.color);
    const red = new THREE.Color(DEPTH_RAMP[0].color);
    const orange = new THREE.Color(DEPTH_RAMP[1].color);
    expect(depthColor(35, color).g).toBeCloseTo((red.g + orange.g) / 2, 6);
  });

  it('clamps above and below the ramp', () => {
    const color = new THREE.Color();
    expect(depthColor(-5, color).getHex()).toBe(DEPTH_RAMP[0].color);
    expect(depthColor(2000, color).getHex()).toBe(DEPTH_RAMP[DEPTH_RAMP.length - 1].color);
  });

  it('draws the same ramp as a CSS legend', () => {
    expect(depthRampGradient(700)).toBe(
      'linear-gradient(to right, #ff453a 0.0%, #ff9f0a 10.0%, #ffd60a 21.4%, #32d74b 42.9%, #0a84ff 71.4%, #bf5af2 100.0%)'
    );
  });
});

describe('SlabLayer', () => {
  it('draws each contour at its depth, in its depth colour', () => {
    const layer = new SlabLayer({
      encoding: 'delta',
      quantumPerDegree: 100,
      contours: [
        { depthKm: 40, polylines: [[14000, 3800, 100, 0]] },
        { depthKm: 600, polylines: [[13500, 4000, 0, 100]] },
      ],
    });
    const lines = layer.getObject().children[0] as LineSegments2;
    const segs = segments(lines);
    expect(segs).toHaveLength(2);
    expect(depthKmOf(segs[0][0])).toBeCloseTo(40, 3);
    expect(lonOf(segs[0][1])).toBeCloseTo(141, 4);
    expect(depthKmOf(segs[1][1])).toBeCloseTo(600, 3);

    const colors = lines.geometry.getAttribute('instanceColorStart');
    const deep = depthColor(600, new THREE.Color());
    expect(colors.getX(1)).toBeCloseTo(deep.r, 6);
    expect(colors.getZ(1)).toBeCloseTo(deep.b, 6);
    layer.dispose();
  });
});

describe('PlumeLayer', () => {
  it('draws the imaged conduit solid and its possible reach faint, below the hotspot', () => {
    const layer = new PlumeLayer([
      { name: 'Reunion', lon: 56, lat: -21, rootLon: 56, rootLat: -21, depthKm: 1000, possibleDepthKm: 2891 },
      { name: 'Eifel', lon: 4, lat: 50, rootLon: 4, rootLat: 50, depthKm: 660 },
    ]);
    const [imaged, possible] = layer.getObject().children as LineSegments2[];
    const solid = segments(imaged);
    expect(solid).toHaveLength(2);
    expect(depthKmOf(solid[0][0])).toBeCloseTo(0, 3);
    expect(depthKmOf(solid[0][1])).toBeCloseTo(1000, 3);
    expect(depthKmOf(solid[1][1])).toBeCloseTo(660, 3);
    expect(lonOf(solid[0][1])).toBeCloseTo(56, 4);

    const faint = segments(possible);
    expect(faint).toHaveLength(1);
    expect(depthKmOf(faint[0][0])).toBeCloseTo(1000, 3);
    expect(depthKmOf(faint[0][1])).toBeCloseTo(2891, 3);
    expect((possible.material as { opacity: number }).opacity).toBeLessThan(
      (imaged.material as { opacity: number }).opacity
    );
    layer.dispose();
  });

  it('leans a conduit toward an off-axis root', () => {
    const layer = new PlumeLayer([
      { name: 'Hawaii', lon: -155, lat: 19, rootLon: -162, rootLat: 20, depthKm: 2891 },
    ]);
    const [[top, bottom]] = segments(layer.getObject().children[0]);
    expect(lonOf(top)).toBeCloseTo(-155, 4);
    expect(lonOf(bottom)).toBeCloseTo(-162, 4);
    expect(bottom.distanceTo(ecefAtDepth(-162, 20, 2891, new THREE.Vector3()))).toBeLessThan(1);
    expect(layer.getObject().children).toHaveLength(1);
    layer.dispose();
  });
});
