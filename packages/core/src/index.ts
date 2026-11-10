// Core package entry point — platform-agnostic geodesy and utilities
// No DOM or Three.js imports here

export * from './geodesy';
export * from './heading';
export * from './magnetic';
export * from './seismic';
export * from './tiles';
export * from './gfs';
export * from './terminator';
export * from './astro';
export * from './astro/ephemeris';
export * from './astro/planet-discs';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}
