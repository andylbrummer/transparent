import { describe, it, expect } from 'vitest';
import { GFS_NI, GFS_NJ } from './gfs';
import { advect, BREAK, LoadGovernor, POINT_STRIDE, sampleWind, segmentAge, WindParticles, type WindField } from './wind-field';

const DEG = Math.PI / 180;

/** A field from formulas of latitude and longitude in degrees (longitude 0..359). */
function fieldOf(u: (lat: number, lon: number) => number, v: (lat: number, lon: number) => number): WindField {
  const field = { u: new Float32Array(GFS_NI * GFS_NJ), v: new Float32Array(GFS_NI * GFS_NJ) };
  for (let j = 0; j < GFS_NJ; j++) {
    for (let i = 0; i < GFS_NI; i++) {
      field.u[j * GFS_NI + i] = u(90 - j, i);
      field.v[j * GFS_NI + i] = v(90 - j, i);
    }
  }
  return field;
}

const unit = (lat: number, lon: number): Float32Array =>
  Float32Array.of(Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG));
const latOf = (p: Float32Array, offset = 0): number => Math.asin(p[offset + 2]) / DEG;
const lonOf = (p: Float32Array, offset = 0): number => Math.atan2(p[offset + 1], p[offset]) / DEG;

/** A repeatable stand-in for Math.random. */
function lcg(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe('sampleWind', () => {
  // u is the latitude, v the longitude: a sample reads back where it was taken.
  const field = fieldOf(
    (lat) => lat,
    (_lat, lon) => lon
  );
  const out = new Float32Array(2);

  it('returns the grid value at a grid point', () => {
    sampleWind(field, 40, 100, out);
    expect([out[0], out[1]]).toEqual([40, 100]);
  });

  it('interpolates between grid points', () => {
    sampleWind(field, 40.25, 100.5, out);
    expect(out[0]).toBeCloseTo(40.25, 5);
    expect(out[1]).toBeCloseTo(100.5, 5);
  });

  it('takes longitude in either convention', () => {
    sampleWind(field, 0, -90, out);
    expect(out[1]).toBeCloseTo(270, 5);
    sampleWind(field, 0, 450, out);
    expect(out[1]).toBeCloseTo(90, 5);
  });

  it('interpolates across the seam between 359°E and 0°E', () => {
    const seam = fieldOf(
      (_lat, lon) => (lon === 359 ? 10 : lon === 0 ? 20 : 0),
      () => 0
    );
    sampleWind(seam, 0, 359.5, out);
    expect(out[0]).toBeCloseTo(15, 5);
    sampleWind(seam, 0, -0.25, out);
    expect(out[0]).toBeCloseTo(17.5, 5);
  });

  it('reaches both poles without reading off the grid', () => {
    sampleWind(field, 90, 10, out);
    expect(out[0]).toBe(90);
    sampleWind(field, -90, 10, out);
    expect(out[0]).toBe(-90);
    sampleWind(field, 95, 10, out);
    expect(out[0]).toBe(90);
  });
});

describe('advect', () => {
  it('carries a particle east along its parallel in a westerly', () => {
    const westerly = fieldOf(
      () => 20,
      () => 0
    );
    const p = unit(45, 10);
    // 0.001 rad of arc per m/s, 20 m/s: 0.02 rad along the 45th parallel.
    const speed = advect(westerly, p, 0, 0.001);
    expect(speed).toBeCloseTo(20, 5);
    expect(lonOf(p)).toBeCloseTo(10 + 0.02 / Math.cos(45 * DEG) / DEG, 2);
    // A straight step along the tangent leaves the parallel only in second order.
    expect(latOf(p)).toBeCloseTo(45, 1);
    expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(1, 6);
  });

  it('carries a particle toward the pole in a southerly, and west in an easterly', () => {
    const southerly = fieldOf(
      () => 0,
      () => 10
    );
    const p = unit(-30, 200);
    advect(southerly, p, 0, 0.001);
    expect(latOf(p)).toBeCloseTo(-30 + 0.01 / DEG, 3);
    expect(lonOf(p)).toBeCloseTo(-160, 4);

    const easterly = fieldOf(
      () => -5,
      () => 0
    );
    const q = unit(10, 0);
    advect(easterly, q, 0, 0.001);
    expect(lonOf(q)).toBeLessThan(0);
  });

  it('keeps solid-body rotation on its parallel over many small steps', () => {
    // u = U cos(lat): the whole atmosphere turning as one about the axis.
    const solid = fieldOf(
      (lat) => 30 * Math.cos(lat * DEG),
      () => 0
    );
    const p = unit(60, 0);
    for (let i = 0; i < 1000; i++) advect(solid, p, 0, 1e-5);
    // 1000 steps × 30 cos(60°) m/s × 1e-5 rad = 0.15 rad of arc, 0.3 rad of longitude at 60°.
    expect(latOf(p)).toBeCloseTo(60, 1);
    expect(lonOf(p)).toBeCloseTo(0.3 / DEG, 0);
  });

  it('leaves a particle at the pole where it is, and still reports the wind', () => {
    const windy = fieldOf(
      () => 7,
      () => 0
    );
    const p = Float32Array.of(0, 0, 1);
    expect(advect(windy, p, 0, 0.01)).toBeCloseTo(7, 5);
    expect(Array.from(p)).toEqual([0, 0, 1]);
  });

  it('does not move in still air', () => {
    const calm = fieldOf(
      () => 0,
      () => 0
    );
    const p = unit(12, 34);
    const before = Array.from(p);
    expect(advect(calm, p, 0, 0.01)).toBe(0);
    expect(Array.from(p)).toEqual(before);
  });
});

describe('WindParticles', () => {
  const westerly = fieldOf(
    () => 10,
    () => 0
  );
  const options = { count: 50, slots: 6, slotSeconds: 0.1, radiansPerMsPerSecond: 0.002, lifeSeconds: [100, 200] as const, random: lcg() };
  const point = (particles: WindParticles, slot: number, i: number): Float32Array =>
    particles.buffer.subarray((slot * options.count + i) * POINT_STRIDE, (slot * options.count + i + 1) * POINT_STRIDE);

  it('starts every trail collapsed on its particle, with no line to draw', () => {
    const particles = new WindParticles(westerly, { ...options, random: lcg() });
    expect(particles.buffer).toHaveLength((options.slots + 1) * options.count * POINT_STRIDE);
    for (let i = 0; i < options.count; i++) {
      const first = point(particles, 0, i);
      expect(Math.hypot(first[0], first[1], first[2])).toBeCloseTo(1, 5);
      for (let slot = 1; slot <= options.slots; slot++) {
        expect(Array.from(point(particles, slot, i))).toEqual(Array.from(first));
      }
      expect(first[3]).toBe(BREAK);
    }
  });

  it('spreads particles over the whole sphere, evenly by area', () => {
    const particles = new WindParticles(westerly, { ...options, count: 4000, random: lcg(7) });
    let north = 0;
    let polar = 0;
    for (let i = 0; i < 4000; i++) {
      const z = particles.buffer[i * POINT_STRIDE + 2];
      if (z > 0) north++;
      if (Math.abs(z) > 0.5) polar++;
    }
    // Half the area is north of the equator; half is poleward of 30°.
    expect(north / 4000).toBeCloseTo(0.5, 1);
    expect(polar / 4000).toBeCloseTo(0.5, 1);
  });

  it('rewrites only the head slot between slot changes', () => {
    const particles = new WindParticles(westerly, { ...options, random: lcg() });
    const before = particles.buffer.slice();
    expect(particles.step(0.03)).toBe(false);
    expect(particles.head).toBe(0);
    const size = options.count * POINT_STRIDE;
    // Slots 1..5 untouched; slot 0 and its copy after the last slot moved.
    expect(particles.buffer.subarray(size, options.slots * size)).toEqual(before.subarray(size, options.slots * size));
    expect(particles.buffer.subarray(0, size)).not.toEqual(before.subarray(0, size));
    expect(particles.buffer.subarray(options.slots * size)).toEqual(particles.buffer.subarray(0, size));
  });

  it('starts a new slot every slotSeconds and marks the wind speed on real moves', () => {
    const particles = new WindParticles(westerly, { ...options, random: lcg() });
    particles.step(0.06);
    expect(particles.phase).toBeCloseTo(0.6, 5);
    expect(particles.step(0.06)).toBe(true);
    expect(particles.head).toBe(1);
    expect(particles.phase).toBeCloseTo(0.2, 5);
    for (let i = 0; i < options.count; i++) {
      // The first point after the start is still a break; the next carries the speed.
      expect(point(particles, 0, i)[3]).toBe(BREAK);
      expect(point(particles, 1, i)[3]).toBeCloseTo(10, 4);
    }
  });

  it('moves each particle downwind, so the trail runs west to east in a westerly', () => {
    const particles = new WindParticles(westerly, { ...options, random: lcg() });
    for (let i = 0; i < 4; i++) particles.step(0.1);
    expect(particles.head).toBe(4);
    for (let i = 0; i < options.count; i++) {
      const older = point(particles, 2, i);
      const newer = point(particles, 3, i);
      if (Math.abs(older[2]) > 0.98) continue;
      const turn = (((lonOf(newer) - lonOf(older) + 540) % 360) - 180) * DEG;
      expect(turn).toBeGreaterThan(0);
      // 0.1 s × 10 m/s × 0.002 rad: 0.002 rad of arc between trail points.
      expect(turn * Math.hypot(older[0], older[1])).toBeCloseTo(0.002, 3);
    }
  });

  it('wraps the ring and keeps slot 0 mirrored after the last slot', () => {
    const particles = new WindParticles(westerly, { ...options, random: lcg() });
    for (let i = 0; i < options.slots; i++) particles.step(0.1);
    expect(particles.head).toBe(0);
    const size = options.count * POINT_STRIDE;
    expect(particles.buffer.subarray(options.slots * size)).toEqual(particles.buffer.subarray(0, size));
  });

  it('breaks the trail where a particle dies and starts again', () => {
    const shortLived = new WindParticles(westerly, { ...options, count: 20, lifeSeconds: [0.25, 0.25], random: lcg(3) });
    const at = (slot: number, i: number): Float32Array => shortLived.buffer.subarray((slot * 20 + i) * POINT_STRIDE, (slot * 20 + i + 1) * POINT_STRIDE);
    // Ages start anywhere in 0..0.25 s; after 0.3 s every particle has respawned once.
    for (let i = 0; i < 3; i++) shortLived.step(0.1);
    let breaks = 0;
    for (let i = 0; i < 20; i++) {
      for (let slot = 1; slot <= 3; slot++) {
        const jump = Math.hypot(at(slot, i)[0] - at(slot - 1, i)[0], at(slot, i)[1] - at(slot - 1, i)[1], at(slot, i)[2] - at(slot - 1, i)[2]);
        // A jump across the globe is always flagged, so no line is drawn along it.
        if (jump > 0.05) {
          expect(at(slot, i)[3]).toBe(BREAK);
          breaks++;
        }
      }
    }
    expect(breaks).toBeGreaterThan(10);
  });

  it('caps a long frame at one slot, so a stalled tab cannot tear the ring', () => {
    const particles = new WindParticles(westerly, { ...options, random: lcg() });
    particles.step(5);
    expect(particles.head).toBe(1);
    expect(particles.phase).toBeLessThanOrEqual(1);
  });

  it('follows a new field without restarting', () => {
    const particles = new WindParticles(westerly, { ...options, random: lcg() });
    particles.step(0.1);
    particles.setField(
      fieldOf(
        () => -25,
        () => 0
      )
    );
    particles.step(0.1);
    expect(point(particles, particles.head, 0)[3]).toBeCloseTo(25, 4);
  });
});

describe('segmentAge', () => {
  it('is 0 for the segment ending at the head and counts back from there', () => {
    // 6 slots, head at 2: the segment from slot 1 ends at the head.
    expect(segmentAge(1, 2, 6)).toBe(0);
    expect(segmentAge(0, 2, 6)).toBe(1);
    expect(segmentAge(5, 2, 6)).toBe(2);
    expect(segmentAge(3, 2, 6)).toBe(4);
  });

  it('is slots − 1 for the segment that would join oldest to newest', () => {
    for (let head = 0; head < 6; head++) expect(segmentAge(head, head, 6)).toBe(5);
  });
});

describe('LoadGovernor', () => {
  const feed = (governor: LoadGovernor, frameMs: number, frames: number): number => {
    let keep = governor.keep;
    for (let i = 0; i < frames; i++) keep = governor.sample(frameMs);
    return keep;
  };

  it('draws every particle on a device that keeps up', () => {
    const governor = new LoadGovernor(18, 10, 0.25, 0.25, 0);
    expect(feed(governor, 16.7, 500)).toBe(1);
  });

  it('thins the trails a step per window while frames run long, down to the floor', () => {
    const governor = new LoadGovernor(18, 10, 0.25, 0.25, 0);
    expect(feed(governor, 33, 9)).toBe(1);
    expect(feed(governor, 33, 1)).toBe(0.75);
    expect(feed(governor, 33, 10)).toBe(0.5);
    expect(feed(governor, 33, 200)).toBe(0.25);
  });

  it('stops thinning once the frame time is back under the target, and never thickens again', () => {
    const governor = new LoadGovernor(18, 10, 0.25, 0.25, 0);
    feed(governor, 33, 20);
    expect(feed(governor, 16.7, 300)).toBe(0.5);
  });

  it('ignores the first frames, which compile shaders', () => {
    const governor = new LoadGovernor(18, 10, 0.25, 0.25, 5);
    expect(feed(governor, 400, 5)).toBe(1);
    expect(feed(governor, 400, 10)).toBe(0.75);
  });

  it('does not thin for one stall, however long, in a window of good frames', () => {
    const governor = new LoadGovernor(18, 45, 0.25, 0.25, 0);
    feed(governor, 16.7, 20);
    governor.sample(5000);
    expect(feed(governor, 16.7, 24)).toBe(1);
    // Nor for a few dropped frames; a steady one in five does.
    expect(feed(governor, 16.7, 42)).toBe(1);
    expect(feed(governor, 33.3, 3)).toBe(1);
    for (let i = 0; i < 9; i++) {
      feed(governor, 16.7, 4);
      governor.sample(33.3);
    }
    expect(governor.keep).toBe(0.75);
  });
});
