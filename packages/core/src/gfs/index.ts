/**
 * GFS wind grid sampling and particle advection.
 * Pure functions — no DOM or Three.js imports here.
 *
 * Grid: downsampled ~1° global wind field stored as a 2D texture
 * (360 x 180, lon x lat, 1° resolution). Each texel stores (u, v)
 * wind components in m/s at a specific pressure level.
 */

import type { Vec3 } from '../geodesy';
import { EARTH_RADIUS_M } from '../terminator';
export { subsolarEcef, computeTerminator, isDaylight, type TerminatorGeometry } from '../terminator';

/** Pressure levels selectable for wind advection. */
export interface WindVector {
  readonly u: number; // eastward component, m/s
  readonly v: number; // northward component, m/s
}

/** GFS grid descriptor. */
export interface GfsGrid {
  readonly width: number;   // lon cells (360 for 1°)
  readonly height: number;   // lat cells (180 for 1°)
  readonly data: Float32Array; // width*height*2  [u0,v0, u1,v1, ...]
}

/** Pressure levels selectable for wind advection. */
export type PressureLevel = 10 | 500 | 250;

/**
 * Wrap longitude to [-180, 180).
 */
export function wrapLon(lon: number): number {
  let wrapped = ((lon + 180) % 360) - 180;
  if (wrapped < -180) wrapped += 360;
  if (wrapped >= 180) wrapped -= 360;
  return wrapped;
}

/**
 * Clamp latitude to [-90, 90].
 */
export function clampLat(lat: number): number {
  return Math.max(-90, Math.min(90, lat));
}

/**
 * Convert continuous lat/lon to grid fractional indices.
 * Grid origin: lon=-180, lat=-90 (south-west corner).
 * Returns {fx, fy} where fx in [0, width), fy in [0, height).
 */
export function latLonToGridFrac(grid: GfsGrid, lat: number, lon: number): { fx: number; fy: number } {
  const wrappedLon = wrapLon(lon);
  const clampedLat = clampLat(lat);

  // Map lon [-180, 180) -> [0, width)
  const fx = ((wrappedLon + 180) / 360) * grid.width;
  // Map lat [-90, 90] -> [0, height] (south to north)
  const fy = ((clampedLat + 90) / 180) * (grid.height - 1);

  return { fx, fy };
}

/**
 * Sample wind at fractional grid coordinates using bilinear interpolation.
 * Handles antimeridian wrapping and poles by clamping.
 */
export function sampleBilinear(grid: GfsGrid, fx: number, fy: number): WindVector {
  const x0 = Math.floor(fx) % grid.width;
  const x1 = (x0 + 1) % grid.width;
  const y0 = Math.max(0, Math.min(grid.height - 1, Math.floor(fy)));
  const y1 = Math.max(0, Math.min(grid.height - 1, y0 + 1));

  const wx = fx - Math.floor(fx);
  const wy = fy - Math.floor(fy);

  // Clamp wy to [0,1] at poles
  const clampedWy = Math.max(0, Math.min(1, wy));

  const i00 = (y0 * grid.width + x0) * 2;
  const i10 = (y0 * grid.width + x1) * 2;
  const i01 = (y1 * grid.width + x0) * 2;
  const i11 = (y1 * grid.width + x1) * 2;

  const u00 = grid.data[i00];
  const v00 = grid.data[i00 + 1];
  const u10 = grid.data[i10];
  const v10 = grid.data[i10 + 1];
  const u01 = grid.data[i01];
  const v01 = grid.data[i01 + 1];
  const u11 = grid.data[i11];
  const v11 = grid.data[i11 + 1];

  const u =
    u00 * (1 - wx) * (1 - clampedWy) +
    u10 * wx * (1 - clampedWy) +
    u01 * (1 - wx) * clampedWy +
    u11 * wx * clampedWy;

  const v =
    v00 * (1 - wx) * (1 - clampedWy) +
    v10 * wx * (1 - clampedWy) +
    v01 * (1 - wx) * clampedWy +
    v11 * wx * clampedWy;

  return { u, v };
}

/**
 * Sample wind at a given lat/lon using bilinear interpolation.
 */
export function sampleWindAtLatLon(grid: GfsGrid, lat: number, lon: number): WindVector {
  const { fx, fy } = latLonToGridFrac(grid, lat, lon);
  return sampleBilinear(grid, fx, fy);
}

/**
 * Convert (u, v) wind components at a lat/lon to a 3D ECEF velocity vector (m/s).
 * u is eastward, v is northward. The result is a tangent vector on the sphere.
 */
export function windToEcefVelocity(lat: number, lon: number, wind: WindVector): Vec3 {
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  const cosLon = Math.cos(lonRad);
  const sinLon = Math.sin(lonRad);

  // East unit vector (tangent to parallel)
  const eEast = { x: -sinLon, y: cosLon, z: 0 };
  // North unit vector (tangent to meridian)
  const eNorth = { x: -sinLat * cosLon, y: -sinLat * sinLon, z: cosLat };

  return {
    x: wind.u * eEast.x + wind.v * eNorth.x,
    y: wind.u * eEast.y + wind.v * eNorth.y,
    z: wind.u * eEast.z + wind.v * eNorth.z,
  };
}

/**
 * Advect a particle on the sphere surface by one Euler step.
 * Position is given as a unit vector (ECEF normalized to Earth radius).
 * dt is in seconds. Returns the new position (still on the sphere).
 */
export function advectStep(
  grid: GfsGrid,
  pos: Vec3,
  dt: number
): Vec3 {
  // Convert ECEF to lat/lon
  const r = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
  const lat = (Math.asin(pos.z / r) * 180) / Math.PI;
  const lon = (Math.atan2(pos.y, pos.x) * 180) / Math.PI;

  // Sample wind
  const wind = sampleWindAtLatLon(grid, lat, lon);

  // Convert to ECEF velocity
  const vel = windToEcefVelocity(lat, lon, wind);

  // Euler step: newPos = pos + vel * dt
  let newX = pos.x + vel.x * dt;
  let newY = pos.y + vel.y * dt;
  let newZ = pos.z + vel.z * dt;

  // Reproject onto sphere to keep |r| = EARTH_RADIUS_M
  const newR = Math.sqrt(newX * newX + newY * newY + newZ * newZ);
  const scale = EARTH_RADIUS_M / newR;
  newX *= scale;
  newY *= scale;
  newZ *= scale;

  return { x: newX, y: newY, z: newZ };
}

/**
 * Create an empty GFS grid with the given dimensions.
 * Useful for testing.
 */
export function createEmptyGrid(width: number, height: number): GfsGrid {
  return {
    width,
    height,
    data: new Float32Array(width * height * 2),
  };
}

/**
 * Build a GFS grid from a function f(lat, lon) -> WindVector.
 */
export function buildGridFromFn(
  width: number,
  height: number,
  fn: (lat: number, lon: number) => WindVector
): GfsGrid {
  const data = new Float32Array(width * height * 2);
  for (let y = 0; y < height; y++) {
    const lat = -90 + (y / (height - 1)) * 180;
    for (let x = 0; x < width; x++) {
      const lon = -180 + (x / width) * 360;
      const wind = fn(lat, lon);
      const i = (y * width + x) * 2;
      data[i] = wind.u;
      data[i + 1] = wind.v;
    }
  }
  return { width, height, data };
}

/**
 * Compute the maximum wind speed in the grid (for normalization).
 */
export function maxWindSpeed(grid: GfsGrid): number {
  let max = 0;
  for (let i = 0; i < grid.data.length; i += 2) {
    const u = grid.data[i];
    const v = grid.data[i + 1];
    const speed = Math.sqrt(u * u + v * v);
    if (speed > max) max = speed;
  }
  return max;
}
