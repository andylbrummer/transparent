/**
 * Where the room is on the Earth: the matrix that takes WebXR local-floor
 * coordinates (metres; +Y up, -Z where the phone faced when the session
 * began) to the Earth-centred frame everything else is drawn in.
 *
 * The portal sits on the floor and the floor is the ground where the user
 * stands: the portal's centre maps to the surface point under the user's
 * fix, XR up to local up, and XR -Z to the compass heading it was measured
 * to face. ARCore's tracking keeps the room steady from then on; the
 * compass is read once, when the portal is placed.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M, enuBasis } from '@transparent-earth/core';

const DEG = Math.PI / 180;

/** Degrees in [0, 360). */
function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Compass heading of an Earth-frame direction, degrees clockwise from north, given the place's east and north. */
export function headingOfDirection(v: THREE.Vector3, east: THREE.Vector3, north: THREE.Vector3): number {
  return normalizeDeg(Math.atan2(v.dot(east), v.dot(north)) / DEG);
}

/** Clockwise angle, degrees, seen from above, from XR -Z to an XR direction. */
export function xrYawDeg(v: THREE.Vector3): number {
  return normalizeDeg(Math.atan2(v.x, -v.z) / DEG);
}

/**
 * The device axis to read a heading from. The phone's back (-Z) unless it
 * points within 30° of straight down or up, where its heading is noise;
 * then the phone's top (+Y), as a phone held over the floor in portrait
 * points its top ahead. Chosen in XR space, where up is exact.
 */
export function headingAxis(xrQuaternion: THREE.Quaternion): THREE.Vector3 {
  const back = new THREE.Vector3(0, 0, -1).applyQuaternion(xrQuaternion);
  return Math.hypot(back.x, back.z) >= 0.5 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
}

/**
 * Compass heading of XR -Z, degrees: the same device axis seen in both
 * frames - by the XR pose and by the compass-aimed camera - fixes how one
 * frame is turned against the other.
 *
 * @param xrQuaternion the camera's orientation in XR space
 * @param earthQuaternion the compass-aimed camera's orientation in the Earth frame
 */
export function headingOfXrForward(
  xrQuaternion: THREE.Quaternion,
  earthQuaternion: THREE.Quaternion,
  lat: number,
  lon: number
): number {
  const axis = headingAxis(xrQuaternion);
  const inXr = axis.clone().applyQuaternion(xrQuaternion);
  const inEarth = axis.clone().applyQuaternion(earthQuaternion);
  const { e, n } = enuBasis({ lat, lon, alt: 0 });
  const heading = headingOfDirection(inEarth, new THREE.Vector3(e.x, e.y, e.z), new THREE.Vector3(n.x, n.y, n.z));
  return normalizeDeg(heading - xrYawDeg(inXr));
}

/**
 * XR local-floor to Earth-centred metres.
 *
 * @param portal the portal's centre on the floor, XR coordinates
 * @param forwardHeadingDeg compass heading of XR -Z, degrees clockwise from true north
 */
export function earthFromXr(
  portal: THREE.Vector3,
  forwardHeadingDeg: number,
  lat: number,
  lon: number,
  out = new THREE.Matrix4()
): THREE.Matrix4 {
  const { e, n, u } = enuBasis({ lat, lon, alt: 0 });
  // East-north-up to Earth-centred, with the ground under the user at the origin.
  const enuToEarth = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(e.x, e.y, e.z),
    new THREE.Vector3(n.x, n.y, n.z),
    new THREE.Vector3(u.x, u.y, u.z)
  );
  enuToEarth.setPosition(u.x * EARTH_RADIUS_M, u.y * EARTH_RADIUS_M, u.z * EARTH_RADIUS_M);
  // XR axes into east-north-up once XR -Z points north: +X east, +Y up, -Z north.
  const xrToEnu = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, -1, 0)
  );
  // Facing heading h, north is h degrees anticlockwise of XR -Z: turn the room clockwise by h.
  const turn = new THREE.Matrix4().makeRotationY(-forwardHeadingDeg * DEG);
  const fromPortal = new THREE.Matrix4().makeTranslation(-portal.x, -portal.y, -portal.z);
  return out.copy(enuToEarth).multiply(xrToEnu).multiply(turn).multiply(fromPortal);
}
