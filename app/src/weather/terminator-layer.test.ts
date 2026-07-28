import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TerminatorLayer } from './terminator-layer';

/**
 * Real Three.js throughout: geometry, materials, and meshes are CPU-side
 * objects that need no GL context, so mocking them would only assert that the
 * mock was called rather than that the layer shades the right hemisphere.
 */

/** Geodetic latitude of a direction vector, in degrees. */
function latitudeOf(v: THREE.Vector3): number {
  return (Math.asin(v.z / v.length()) * 180) / Math.PI;
}

/** Longitude of a direction vector, in degrees. */
function longitudeOf(v: THREE.Vector3): number {
  return (Math.atan2(v.y, v.x) * 180) / Math.PI;
}

describe('TerminatorLayer', () => {
  it('adds its mesh to the scene and removes it on dispose', () => {
    const scene = new THREE.Scene();
    const layer = new TerminatorLayer(scene);

    expect(scene.children).toHaveLength(1);
    expect(layer.visible).toBe(true);

    layer.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('tolerates a second dispose', () => {
    const scene = new THREE.Scene();
    const layer = new TerminatorLayer(scene);
    layer.dispose();
    expect(() => layer.dispose()).not.toThrow();
    expect(scene.children).toHaveLength(0);
  });

  it('setVisible toggles visibility', () => {
    const layer = new TerminatorLayer(new THREE.Scene());
    layer.setVisible(false);
    expect(layer.visible).toBe(false);
    layer.setVisible(true);
    expect(layer.visible).toBe(true);
    layer.dispose();
  });

  it('clamps night intensity into [0, 1] and keeps values inside it', () => {
    const layer = new TerminatorLayer(new THREE.Scene());

    layer.setNightIntensity(1.5);
    expect(layer.nightIntensity).toBe(1);

    layer.setNightIntensity(-0.5);
    expect(layer.nightIntensity).toBe(0);

    layer.setNightIntensity(0.35);
    expect(layer.nightIntensity).toBeCloseTo(0.35, 6);

    layer.dispose();
  });

  it('shades from the sun over the Tropic of Cancer at the June solstice', () => {
    const layer = new TerminatorLayer(new THREE.Scene());
    layer.updateTerminator(new Date('2024-06-21T12:00:00Z'));

    const sun = layer.subsolarDirection;
    expect(sun.length()).toBeGreaterThan(0);
    // Peak northern declination — the sun stands over 23.44 deg N.
    expect(latitudeOf(sun)).toBeCloseTo(23.44, 0);
    // Solar noon on the Greenwich meridian, give or take the equation of time.
    expect(Math.abs(longitudeOf(sun))).toBeLessThan(5);

    layer.dispose();
  });

  it('puts the sun over the southern tropic at the December solstice', () => {
    const layer = new TerminatorLayer(new THREE.Scene());
    layer.updateTerminator(new Date('2024-12-21T12:00:00Z'));

    expect(latitudeOf(layer.subsolarDirection)).toBeCloseTo(-23.44, 0);
    layer.dispose();
  });

  it('swings the subsolar point halfway round the globe over twelve hours', () => {
    const layer = new TerminatorLayer(new THREE.Scene());

    layer.updateTerminator(new Date('2024-03-20T00:00:00Z'));
    const midnight = layer.subsolarDirection.normalize();

    layer.updateTerminator(new Date('2024-03-20T12:00:00Z'));
    const noon = layer.subsolarDirection.normalize();

    // Opposite sides of the Earth: the directions should very nearly invert.
    expect(midnight.dot(noon)).toBeLessThan(-0.99);

    layer.dispose();
  });
});
