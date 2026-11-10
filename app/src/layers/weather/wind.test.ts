import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { GFS_NI, GFS_NJ } from './gfs';
import WEATHER_LAYERS from './layer';
import { particleBudget, trailWidthCss, WIND_STYLES, WindTrails, setsToDraw } from './wind';
import { POINT_STRIDE, WindParticles } from './wind-field';

const field = { u: new Float32Array(GFS_NI * GFS_NJ).fill(10), v: new Float32Array(GFS_NI * GFS_NJ) };
const options = { count: 40, slots: 5, slotSeconds: 0.1, radiansPerMsPerSecond: 0.001, lifeSeconds: [50, 60] as const };

function trails() {
  const particles = new WindParticles(field, options);
  const mesh = new WindTrails(particles, WIND_STYLES['wind-10m'], { value: new THREE.Vector3(0, 0, 1) }, 'test');
  const geometry = mesh.object.geometry as THREE.InstancedBufferGeometry;
  const material = mesh.object.material as THREE.ShaderMaterial;
  return { particles, mesh, geometry, material };
}

describe('WindTrails', () => {
  it('draws one quad per trail segment, pairing each point with the next slot', () => {
    const { geometry } = trails();
    expect(geometry.instanceCount).toBe(options.slots * options.count);
    const start = geometry.getAttribute('aStart') as THREE.InterleavedBufferAttribute;
    const end = geometry.getAttribute('aEnd') as THREE.InterleavedBufferAttribute;
    // The same buffer read twice, the second time one slot further on.
    expect(end.data).toBe(start.data);
    expect(start.offset).toBe(0);
    expect(end.offset).toBe(options.count * POINT_STRIDE);
    // The last instance's end point is the last point in the buffer: nothing reads past it.
    expect(end.offset / POINT_STRIDE + geometry.instanceCount).toBe(start.data.count);
    const slotOf = geometry.getAttribute('aSlot');
    expect(slotOf.getX(0)).toBe(0);
    expect(slotOf.getX(options.count)).toBe(1);
    expect(slotOf.getX(options.slots * options.count - 1)).toBe(options.slots - 1);
  });

  it('never depth-tests, is never culled, and draws over the other weather', () => {
    const { mesh, material } = trails();
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(mesh.object.frustumCulled).toBe(false);
  });

  it('sends the GPU only the slot that changed each frame', () => {
    const { mesh, geometry } = trails();
    const points = (geometry.getAttribute('aStart') as THREE.InterleavedBufferAttribute).data;
    const size = options.count * POINT_STRIDE;
    mesh.update(0.03);
    // Head still slot 0, which is also kept after the last slot.
    expect(points.updateRanges).toEqual([
      { start: 0, count: size },
      { start: options.slots * size, count: size },
    ]);
    points.clearUpdateRanges();
    mesh.update(0.03);
    mesh.update(0.03);
    mesh.update(0.03);
    expect(points.updateRanges[points.updateRanges.length - 1]).toEqual({ start: size, count: size });
  });

  it('tells the shader where the head is and how far into its slot', () => {
    const { mesh, material, particles } = trails();
    for (let i = 0; i < 5; i++) mesh.update(0.03);
    expect(material.uniforms.uHead.value).toBe(particles.head);
    expect(material.uniforms.uHead.value).toBe(1);
    expect(material.uniforms.uPhase.value).toBeCloseTo(0.5, 5);
    expect(material.uniforms.uSlots.value).toBe(options.slots);
  });

  it('caps the time step of a long frame', () => {
    const { mesh, particles } = trails();
    mesh.update(3);
    expect(particles.head).toBe(0);
    expect(particles.sinceSlot).toBeCloseTo(0.05, 5);
  });

  it('draws each level at its height and scales the colour ramp to its speeds', () => {
    const jet = new WindTrails(new WindParticles(field, options), WIND_STYLES['wind-250hpa'], { value: new THREE.Vector3(0, 0, 1) }, 'jet');
    const uniforms = (jet.object.material as THREE.ShaderMaterial).uniforms;
    expect(uniforms.uRadius.value).toBe(EARTH_RADIUS_M + 10_400);
    expect((uniforms.uSpeedRange.value as THREE.Vector2).toArray()).toEqual([0, 110]);
  });

  it('takes the viewport size for its screen-space width', () => {
    const { mesh, material } = trails();
    mesh.setResolution(412, 892);
    expect((material.uniforms.uResolution.value as THREE.Vector2).toArray()).toEqual([412, 892]);
  });
});

describe('trailWidthCss', () => {
  it('narrows trails on a dense screen, where the same CSS width costs twice the pixels', () => {
    expect(trailWidthCss(2.2, 1)).toBe(2.2);
    // At least three device pixels across either way.
    expect(trailWidthCss(2.2, 2) * 2).toBeGreaterThanOrEqual(2.9);
    expect(trailWidthCss(2.2, 2)).toBeLessThan(2.2);
    expect(trailWidthCss(2.2, 3) * 3).toBeGreaterThan(trailWidthCss(2.2, 1));
  });
});

describe('particleBudget', () => {
  it('keeps to the 8,000-particle phone budget on touch devices', () => {
    expect(particleBudget(true)).toBe(8000);
    expect(particleBudget(false)).toBeGreaterThan(8000);
  });
});

describe('the wind legends', () => {
  /** How many times faster than the air the trails run, from the style's animation speed. */
  const exaggeration = (degreesPerSecondAt10Ms: number): number => (degreesPerSecondAt10Ms * (Math.PI / 180) * EARTH_RADIUS_M) / 10;

  it.each([
    ['wind-10m', 24_000],
    ['wind-250hpa', 7_000],
  ] as const)('%s states its true time exaggeration', (id, stated) => {
    const caption = WEATHER_LAYERS.find((layer) => layer.id === id)?.caption ?? '';
    expect(caption).toContain(`${stated.toLocaleString('en-US')}× faster`);
    // To the two significant figures the caption gives.
    expect(exaggeration(WIND_STYLES[id].degreesPerSecondAt10Ms) / stated).toBeCloseTo(1, 1);
  });

  it.each(['wind-10m', 'wind-250hpa'] as const)('%s states the top of its colour scale', (id) => {
    const ramp = WIND_STYLES[id].ramp;
    const caption = WEATHER_LAYERS.find((layer) => layer.id === id)?.caption ?? '';
    expect(caption).toContain(`0 – ${ramp[ramp.length - 1][0]} m/s`);
  });
});

describe('setsToDraw', () => {
  it('draws what the load governor allows on one screen', () => {
    expect(setsToDraw(4, 1, 1)).toBe(4);
    expect(setsToDraw(4, 0.5, 1)).toBe(2);
    expect(setsToDraw(4, 0.25, 1)).toBe(1);
  });

  it('draws at most half the sets in stereo, where each is drawn twice', () => {
    expect(setsToDraw(4, 1, 2)).toBe(2);
    expect(setsToDraw(4, 0.75, 2)).toBe(2);
    // The governor's own limit still holds below that.
    expect(setsToDraw(4, 0.25, 2)).toBe(1);
  });
});
