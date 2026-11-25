/**
 * Where the view stands: the point in the world the camera sits at, and
 * the place on the ground under it. The camera is placed with it and a
 * guide's pointer aims from it, so the two cannot drift apart.
 *
 * The place is the sensor fix unless an action has set another. It lives
 * here and not in sensors/, which keep the real fix: the declination that
 * turns the real compass to true north belongs to where the phone really
 * is, wherever the view stands.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import type { SurfacePosition } from '../sensors';
import type { Place } from './actions';

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

/** The point straight through the Earth's centre from `position`. Longitude in -180 to 180, as the sensors give it. */
export function antipodeOf(position: SurfacePosition): SurfacePosition {
  return { lat: -position.lat, lon: position.lon > 0 ? position.lon - 180 : position.lon + 180 };
}

export interface StandingPlace {
  /** The place as set: `here` until an action sets another. */
  place(): Place;
  /**
   * Where the view stands now; null while it stands here, or at the far side from here, and there is no fix yet.
   * Read every frame, so it builds nothing: the same object until the place or the fix changes.
   */
  position(): SurfacePosition | null;
  /** Stand somewhere else. A place out of range throws: actions are checked before they get here. */
  set(place: Place): void;
}

/** `here()` is the sensors' position, the fix or its stand-in; it is read, never copied, so a new fix moves `here` at once. */
export function createStandingPlace(here: () => SurfacePosition | null): StandingPlace {
  let place: Place = { kind: 'here' };
  let at: SurfacePosition | null = null;
  // The far side, worked out again only when the fix it is the far side of changes.
  let antipodeFrom: SurfacePosition | null = null;
  let antipode: SurfacePosition | null = null;

  return {
    place: () => place,
    position() {
      switch (place.kind) {
        case 'here':
          return here();
        case 'antipode': {
          const from = here();
          if (from !== antipodeFrom) {
            antipodeFrom = from;
            antipode = from === null ? null : antipodeOf(from);
          }
          return antipode;
        }
        case 'at':
          return at;
      }
    },
    set(next) {
      if (next.kind === 'at') {
        const { lat, lon } = next;
        if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new RangeError(`no place at ${lat}, ${lon}`);
        at = { lat, lon };
      }
      place = next;
    },
  };
}
