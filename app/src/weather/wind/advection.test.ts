import { describe, it, expect } from 'vitest';
import {
  seededRandom,
  particleFromSeed,
  advectParticle,
  initParticles,
  particleToEcefUnit,
  averageParticleSpeed,
  buildParticleAttributes,
  DEFAULT_PARTICLE_CONFIG,
} from './advection';
import { createEmptyGrid, buildGridFromFn } from '@transparent-earth/core/gfs';

describe('seededRandom', () => {
  it('returns values in [0, 1]', () => {
    for (let i = 0; i < 100; i++) {
      const r = seededRandom(i);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });

  it('is deterministic for the same seed', () => {
    expect(seededRandom(42)).toBe(seededRandom(42));
  });
});

describe('particleFromSeed', () => {
  it('produces lat in [-90, 90]', () => {
    const p = particleFromSeed(0);
    expect(p.lat).toBeGreaterThanOrEqual(-90);
    expect(p.lat).toBeLessThanOrEqual(90);
  });

  it('produces lon in [-180, 180]', () => {
    const p = particleFromSeed(0);
    expect(p.lon).toBeGreaterThanOrEqual(-180);
    expect(p.lon).toBeLessThanOrEqual(180);
  });

  it('produces life in [0, 1]', () => {
    const p = particleFromSeed(0);
    expect(p.life).toBeGreaterThanOrEqual(0);
    expect(p.life).toBeLessThanOrEqual(1);
  });
});

describe('advectParticle', () => {
  it('moves eastward with pure u-wind', () => {
    const grid = buildGridFromFn(4, 3, () => ({ u: 10, v: 0 }));
    const p = { lat: 0, lon: 0, life: 1, speed: 0 };
    const next = advectParticle(grid, p, 1, 1);
    expect(next.lon).toBeGreaterThan(p.lon);
    expect(next.lat).toBeCloseTo(p.lat, 5);
  });

  it('moves northward with pure v-wind', () => {
    const grid = buildGridFromFn(4, 3, () => ({ u: 0, v: 10 }));
    const p = { lat: 0, lon: 0, life: 1, speed: 0 };
    const next = advectParticle(grid, p, 1, 1);
    expect(next.lat).toBeGreaterThan(p.lat);
  });

  it('respawns when life reaches zero', () => {
    const grid = createEmptyGrid(4, 3);
    const p = { lat: 0, lon: 0, life: 0.01, speed: 0 };
    const next = advectParticle(grid, p, 1, 1); // large dt to force death
    expect(next.life).toBeGreaterThan(0);
    expect(next.life).toBeLessThanOrEqual(1);
  });

  it('speedScale amplifies motion', () => {
    const grid = buildGridFromFn(4, 3, () => ({ u: 10, v: 0 }));
    const p = { lat: 0, lon: 0, life: 1, speed: 0 };
    const slow = advectParticle(grid, p, 1, 0.5);
    const fast = advectParticle(grid, p, 1, 2.0);
    expect(fast.lon).toBeGreaterThan(slow.lon);
  });
});

describe('initParticles', () => {
  it('creates the requested count', () => {
    const particles = initParticles(100);
    expect(particles.length).toBe(100);
  });

  it('all particles have valid ranges', () => {
    const particles = initParticles(50);
    for (const p of particles) {
      expect(p.lat).toBeGreaterThanOrEqual(-90);
      expect(p.lat).toBeLessThanOrEqual(90);
      expect(p.lon).toBeGreaterThanOrEqual(-180);
      expect(p.lon).toBeLessThanOrEqual(180);
      expect(p.life).toBeGreaterThanOrEqual(0);
      expect(p.life).toBeLessThanOrEqual(1);
    }
  });
});

describe('particleToEcefUnit', () => {
  it('equator/prime meridian points to +x', () => {
    const ecef = particleToEcefUnit({ lat: 0, lon: 0, life: 1, speed: 0 });
    expect(ecef.x).toBeCloseTo(1, 5);
    expect(ecef.y).toBeCloseTo(0, 5);
    expect(ecef.z).toBeCloseTo(0, 5);
  });

  it('north pole points to +z', () => {
    const ecef = particleToEcefUnit({ lat: 90, lon: 0, life: 1, speed: 0 });
    expect(ecef.x).toBeCloseTo(0, 5);
    expect(ecef.y).toBeCloseTo(0, 5);
    expect(ecef.z).toBeCloseTo(1, 5);
  });

  it('unit length for random particles', () => {
    for (let i = 0; i < 20; i++) {
      const p = particleFromSeed(i);
      const ecef = particleToEcefUnit(p);
      const len = Math.sqrt(ecef.x * ecef.x + ecef.y * ecef.y + ecef.z * ecef.z);
      expect(len).toBeCloseTo(1, 5);
    }
  });
});

describe('averageParticleSpeed', () => {
  it('returns 0 for empty array', () => {
    expect(averageParticleSpeed([])).toBe(0);
  });

  it('computes average correctly', () => {
    const particles = [
      { lat: 0, lon: 0, life: 1, speed: 10 },
      { lat: 0, lon: 0, life: 1, speed: 20 },
      { lat: 0, lon: 0, life: 1, speed: 30 },
    ];
    expect(averageParticleSpeed(particles)).toBe(20);
  });
});

describe('buildParticleAttributes', () => {
  it('produces arrays of correct length', () => {
    const particles = initParticles(10);
    const attrs = buildParticleAttributes(particles);
    expect(attrs.positions.length).toBe(10 * 3);
    expect(attrs.lives.length).toBe(10);
  });

  it('positions are unit length', () => {
    const particles = initParticles(10);
    const attrs = buildParticleAttributes(particles);
    for (let i = 0; i < 10; i++) {
      const x = attrs.positions[i * 3];
      const y = attrs.positions[i * 3 + 1];
      const z = attrs.positions[i * 3 + 2];
      const len = Math.sqrt(x * x + y * y + z * z);
      expect(len).toBeCloseTo(1, 5);
    }
  });
});

describe('DEFAULT_PARTICLE_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_PARTICLE_CONFIG.count).toBe(8192);
    expect(DEFAULT_PARTICLE_CONFIG.speedScale).toBe(1.0);
    expect(DEFAULT_PARTICLE_CONFIG.dt).toBe(0.016);
  });
});
