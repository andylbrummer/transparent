import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { depthColor } from './interior';
import { QuakeMarkers, buildQuakeMarkerBuffers, type QuakeMarker } from './quake-markers';

const T0 = Date.parse('2026-11-09T00:00:00Z');
// us7000tx16 (Solomon Islands, M6.4, 17 km) and us7000tw8r (Fiji, M6.1, 535 km) as
// their USGS event pages gave them on 2026-11-10, and an event above sea level.
const MARKERS: readonly QuakeMarker[] = [
  { lon: 165.5616, lat: -10.8669, depthKm: 17, mag: 6.4, timeMs: T0 + 3600000 },
  { lon: -178.7145, lat: -21.1984, depthKm: 535, mag: 6.1, timeMs: T0 },
  { lon: -109.886, lat: 41.565, depthKm: -1.97, mag: 3.1, timeMs: T0 + 7200000 },
];
const size = (magnitude: number): number => magnitude * 2;

describe('buildQuakeMarkerBuffers', () => {
  const buffers = buildQuakeMarkerBuffers(MARKERS, size);
  const at = (i: number): THREE.Vector3 => new THREE.Vector3().fromArray(buffers.positions, i * 3);

  it('orders by magnitude, the greatest last', () => {
    expect([...buffers.sizes]).toEqual([size(3.1), size(6.1), size(6.4)].map(Math.fround));
  });

  it('places each at its hypocentre on the 6371 km sphere', () => {
    // Worked outside the app (Python): r = 6371000 − 17000; r·cosφ·cosλ, r·cosφ·sinλ, r·sinφ.
    expect(at(2).x).toBeCloseTo(-6042974.4, -0.5);
    expect(at(2).y).toBeCloseTo(1555889.9, -0.5);
    expect(at(2).z).toBeCloseTo(-1197907.7, -0.5);
    expect((6371000 - at(1).length()) / 1000).toBeCloseTo(535, 2);
  });

  it('draws an event above sea level at the surface, in the surface colour', () => {
    expect(at(0).length()).toBeCloseTo(6371000, -1);
    const red = depthColor(0, new THREE.Color());
    expect(buffers.colors[0]).toBeCloseTo(red.r, 6);
    expect(buffers.colors[1]).toBeCloseTo(red.g, 6);
  });

  it('colours by depth on the catalogue ramp', () => {
    const deep = depthColor(535, new THREE.Color());
    expect([...buffers.colors.subarray(3, 6)]).toEqual([deep.r, deep.g, deep.b].map(Math.fround));
  });

  it('keeps times as seconds after the earliest event', () => {
    expect(buffers.epochMs).toBe(T0);
    expect([...buffers.times]).toEqual([7200, 0, 3600]);
  });

  it('copes with no markers', () => {
    const empty = buildQuakeMarkerBuffers([], size);
    expect(empty.positions).toHaveLength(0);
    expect(empty.epochMs).toBe(0);
  });
});

describe('QuakeMarkers', () => {
  const options = { name: 'test', sizePx: size, pulseWindowS: 86400, fadeOverS: Infinity, oldestAlpha: 1, ringWidthPx: 1.5, pixelRatio: { value: 2 } };

  it('draws over the catalogue dots without a depth test, sharing the pixel ratio', () => {
    const markers = new QuakeMarkers(options);
    const material = markers.object.material as THREE.ShaderMaterial;
    expect(markers.object.renderOrder).toBeGreaterThan(3);
    expect(markers.object.renderOrder).toBeLessThan(4);
    expect(material.depthTest).toBe(false);
    expect(material.uniforms.uPixelRatio).toBe(options.pixelRatio);
    expect(material.fragmentShader).toContain('#include <colorspace_fragment>');
    markers.dispose();
  });

  it('tells the shader the app clock relative to the data, so future events hide', () => {
    const markers = new QuakeMarkers(options);
    markers.setMarkers(MARKERS);
    const uniforms = (markers.object.material as THREE.ShaderMaterial).uniforms;
    markers.update(T0 + 1800000, 16);
    // Half an hour in: the first event has happened (age > 0), the other two have not.
    expect(uniforms.uNow.value).toBe(1800);
    expect(markers.object.geometry.getAttribute('aTime').count).toBe(3);
    markers.update(T0 - 1000, 16);
    expect(uniforms.uNow.value).toBe(-1);
    markers.dispose();
  });

  it('advances the ripple by wall time, bounded after a stall', () => {
    const markers = new QuakeMarkers(options);
    const uniforms = (markers.object.material as THREE.ShaderMaterial).uniforms;
    markers.update(T0, 100);
    expect(uniforms.uPulseClock.value).toBeCloseTo(0.1, 6);
    markers.update(T0, 60000);
    expect(uniforms.uPulseClock.value).toBeCloseTo(0.35, 6);
    markers.dispose();
  });
});
