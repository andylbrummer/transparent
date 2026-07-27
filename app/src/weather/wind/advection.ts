/**
 * Simplified CPU/GPU particle advection for GFS wind fields.
 *
 * This module provides pure-math particle advection that can drive
 * a GPU particle system (e.g. Three.js Points) or be used for
 * offline trajectory computation.  It consumes the core GFS grid
 * utilities and adds particle lifecycle management.
 */

import {
  type GfsGrid,
  sampleWindAtLatLon,
  advectStep,
} from '@transparent-earth/core/gfs';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import type { Vec3 } from '@transparent-earth/core/geodesy';

/** A single wind particle with lat/lon position and visual life. */
export interface WindParticle {
  readonly lat: number;   // degrees, [-90, 90]
  readonly lon: number;   // degrees, [-180, 180]
  readonly life: number;  // [0, 1], 0 = dead, 1 = newborn
  readonly speed: number; // m/s, sampled at current position
}

/** Configuration for the particle system. */
export interface ParticleSystemConfig {
  readonly count: number;
  readonly speedScale: number; // multiplier for visual speed
  readonly dt: number;         // seconds per advection step
}

export const DEFAULT_PARTICLE_CONFIG: ParticleSystemConfig = {
  count: 8192,
  speedScale: 1.0,
  dt: 0.016, // ~60 fps
};

/** Pseudo-random number in [0, 1] from an integer seed. */
export function seededRandom(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Generate an initial particle from a seed value. */
export function particleFromSeed(seed: number): WindParticle {
  const lat = seededRandom(seed * 137) * 180 - 90;
  const lon = seededRandom(seed * 241) * 360 - 180;
  return {
    lat: Math.max(-90, Math.min(90, lat)),
    lon: ((lon + 180) % 360) - 180,
    life: seededRandom(seed * 391),
    speed: 0,
  };
}

/** Sample wind speed magnitude at a particle's position. */
export function sampleParticleSpeed(grid: GfsGrid, p: WindParticle): number {
  const wind = sampleWindAtLatLon(grid, p.lat, p.lon);
  return Math.sqrt(wind.u * wind.u + wind.v * wind.v);
}

/**
 * Advect a single particle by one Euler step.
 * The particle is reprojected onto the sphere and its life decays.
 */
export function advectParticle(
  grid: GfsGrid,
  p: WindParticle,
  dt: number,
  speedScale: number
): WindParticle {
  // Convert lat/lon to ECEF unit position
  const latRad = (p.lat * Math.PI) / 180;
  const lonRad = (p.lon * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  const cosLon = Math.cos(lonRad);
  const sinLon = Math.sin(lonRad);

  const pos: Vec3 = {
    x: EARTH_RADIUS_M * cosLat * cosLon,
    y: EARTH_RADIUS_M * cosLat * sinLon,
    z: EARTH_RADIUS_M * sinLat,
  };

  // Advect using core GFS function
  const newPos = advectStep(grid, pos, dt * speedScale);

  // Convert back to lat/lon
  const newR = Math.sqrt(newPos.x * newPos.x + newPos.y * newPos.y + newPos.z * newPos.z);
  const newLat = (Math.asin(newPos.z / newR) * 180) / Math.PI;
  const newLon = (Math.atan2(newPos.y, newPos.x) * 180) / Math.PI;

  // Decay life; respawn when dead
  const life = p.life - dt * 0.5; // half-second life at 60fps with dt=0.016
  if (life <= 0) {
    return particleFromSeed(Math.random() * 100000);
  }

  const speed = sampleParticleSpeed(grid, { lat: newLat, lon: newLon, life, speed: 0 });

  return {
    lat: newLat,
    lon: ((newLon + 180) % 360) - 180,
    life,
    speed,
  };
}

/**
 * Advect the entire particle system.
 * Returns a new array of particles (immutable update).
 */
export function advectParticles(
  grid: GfsGrid,
  particles: readonly WindParticle[],
  config: ParticleSystemConfig
): WindParticle[] {
  return particles.map((p) => advectParticle(grid, p, config.dt, config.speedScale));
}

/** Initialise a particle array with random seeds. */
export function initParticles(count: number): WindParticle[] {
  const particles: WindParticle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push(particleFromSeed(i / count));
  }
  return particles;
}

/**
 * Convert a particle's lat/lon to a normalised ECEF unit vector
 * suitable for GPU attribute buffers.
 */
export function particleToEcefUnit(p: WindParticle): Vec3 {
  const latRad = (p.lat * Math.PI) / 180;
  const lonRad = (p.lon * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  const cosLon = Math.cos(lonRad);
  const sinLon = Math.sin(lonRad);
  return {
    x: cosLat * cosLon,
    y: cosLat * sinLon,
    z: sinLat,
  };
}

/**
 * Compute the average wind speed across all particles.
 * Useful for UI gauges or adaptive speed scaling.
 */
export function averageParticleSpeed(particles: readonly WindParticle[]): number {
  if (particles.length === 0) return 0;
  let total = 0;
  for (const p of particles) {
    total += p.speed;
  }
  return total / particles.length;
}

/**
 * Build Float32 attribute arrays for GPU upload.
 * Returns { positions, lives } where positions are normalised ECEF unit vectors.
 */
export function buildParticleAttributes(
  particles: readonly WindParticle[]
): { positions: Float32Array; lives: Float32Array } {
  const count = particles.length;
  const positions = new Float32Array(count * 3);
  const lives = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const p = particles[i];
    const ecef = particleToEcefUnit(p);
    positions[i * 3] = ecef.x;
    positions[i * 3 + 1] = ecef.y;
    positions[i * 3 + 2] = ecef.z;
    lives[i] = p.life;
  }

  return { positions, lives };
}
