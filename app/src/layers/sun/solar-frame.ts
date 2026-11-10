/**
 * Where the Sun is and how it is turned at an instant, in the terms the
 * Sun layers draw with: a direction on the sky, an angular radius, and the
 * two "ups" its images come in. No three.js here, so it can be tested bare.
 */

import {
  AU_KM,
  ECLIPTIC_POLE_ICRS,
  SUN_RADIUS_KM,
  sunBodyToIcrs,
  sunGeocentricAu,
  surfacePointIcrs,
  type Mat3,
} from '@transparent-earth/core';

export type Vec = readonly [number, number, number];

const ARCSEC_PER_RADIAN = 206264.806;

export interface SunState {
  /** Unit vector from the Earth's centre to the Sun, ICRS. */
  readonly direction: Vec;
  readonly distanceKm: number;
  /** The disc's angular radius, radians. */
  readonly angularRadius: number;
  readonly radiusArcsec: number;
  /** Heliographic (Carrington) axes → ICRS. */
  readonly bodyToIcrs: Mat3;
  /** Unit vector along the Sun's north pole, ICRS. */
  readonly pole: Vec;
}

export function computeSunState(date: Date): SunState {
  const position = sunGeocentricAu(date);
  const distanceAu = Math.hypot(position[0], position[1], position[2]);
  const distanceKm = distanceAu * AU_KM;
  const angularRadius = Math.asin(SUN_RADIUS_KM / distanceKm);
  const bodyToIcrs = sunBodyToIcrs(date);
  return {
    direction: [position[0] / distanceAu, position[1] / distanceAu, position[2] / distanceAu],
    distanceKm,
    angularRadius,
    radiusArcsec: angularRadius * ARCSEC_PER_RADIAN,
    bodyToIcrs,
    pole: [bodyToIcrs[2], bodyToIcrs[5], bodyToIcrs[8]],
  };
}

/**
 * The directions "up" and "right" of an image of the Sun whose top points
 * to `pole`: unit vectors on the sky at the Sun, ICRS. Right is celestial
 * west - the sky is seen from inside, so east is to the left.
 */
export function imageAxes(direction: Vec, pole: Vec): { up: [number, number, number]; right: [number, number, number] } {
  const along = pole[0] * direction[0] + pole[1] * direction[1] + pole[2] * direction[2];
  const u: [number, number, number] = [pole[0] - along * direction[0], pole[1] - along * direction[1], pole[2] - along * direction[2]];
  const n = Math.hypot(u[0], u[1], u[2]);
  const up: [number, number, number] = [u[0] / n, u[1] / n, u[2] / n];
  const right: [number, number, number] = [
    direction[1] * up[2] - direction[2] * up[1],
    direction[2] * up[0] - direction[0] * up[2],
    direction[0] * up[1] - direction[1] * up[0],
  ];
  return { up, right };
}

/** The pole a product's frames have at the top. */
export function productPole(sun: SunState, up: 'solar-north' | 'ecliptic-north'): Vec {
  return up === 'solar-north' ? sun.pole : ECLIPTIC_POLE_ICRS;
}

/**
 * Where a point of the Sun's surface appears on the sky: a unit ICRS
 * direction, or null when the Sun's rotation has carried it to the far side.
 * Latitude and Carrington longitude in degrees.
 */
export function surfacePointOnSky(sun: SunState, latDeg: number, carringtonLonDeg: number): [number, number, number] | null {
  const outward = surfacePointIcrs(sun.bodyToIcrs, latDeg, carringtonLonDeg);
  // Facing us when it leans against the Sun's direction from here.
  const facing = -(outward[0] * sun.direction[0] + outward[1] * sun.direction[1] + outward[2] * sun.direction[2]);
  if (facing <= 0) return null;
  const k = SUN_RADIUS_KM / sun.distanceKm;
  const v = [sun.direction[0] + k * outward[0], sun.direction[1] + k * outward[1], sun.direction[2] + k * outward[2]];
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}
