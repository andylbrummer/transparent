/**
 * Where the view stands. For now that is one thing: the point in the world
 * the camera sits at. The camera is placed with it and a guide's pointer
 * aims from it, so the two cannot drift apart.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';

/** Camera height above the surface shell, in metres. */
export const EYE_HEIGHT_M = 1.5;

/**
 * The world point the view stands at: eye height above the drawn sphere,
 * along `up`, the local up as a unit vector. It takes the up, not a
 * position, because the camera works out its local frame every frame and
 * must not do so twice. Written into `out`.
 */
export function standingPoint(up: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(up).multiplyScalar(EARTH_RADIUS_M + EYE_HEIGHT_M);
}
