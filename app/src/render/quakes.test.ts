import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { depthColor } from './interior';
import { QuakeLayer, quakePointSizePx } from './quakes';

describe('quakePointSizePx', () => {
  it('grows by magnitude, star-map style', () => {
    expect(quakePointSizePx(5)).toBeCloseTo(1.6, 9);
    expect(quakePointSizePx(9.1)).toBeGreaterThan(9);
    expect(quakePointSizePx(9.1)).toBeLessThan(10);
  });
});

describe('QuakeLayer', () => {
  it('places each quake at its hypocentre, coloured by depth and sized by magnitude', () => {
    const layer = new QuakeLayer({
      quantumPerDegree: 100,
      lon: [-17800, 14240],
      lat: [-2000, 3830],
      depthKm: [600, 29],
      magnitude10: [55, 91],
      labels: [],
    });
    const geometry = (layer.getObject() as THREE.Points).geometry;
    const position = geometry.getAttribute('position');
    const tohoku = new THREE.Vector3(position.getX(1), position.getY(1), position.getZ(1));
    expect((EARTH_RADIUS_M - tohoku.length()) / 1000).toBeCloseTo(29, 3);
    expect((Math.atan2(tohoku.y, tohoku.x) * 180) / Math.PI).toBeCloseTo(142.4, 4);

    const color = geometry.getAttribute('aColor');
    const deep = depthColor(600, new THREE.Color());
    expect(color.getX(0)).toBeCloseTo(deep.r, 6);
    expect(color.getZ(0)).toBeCloseTo(deep.b, 6);
    expect(geometry.getAttribute('aSize').getX(1)).toBeCloseTo(quakePointSizePx(9.1), 5);
    layer.dispose();
  });
});
