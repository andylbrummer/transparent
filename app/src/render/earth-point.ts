/**
 * Where a place on or in the Earth is in the world: ECEF metres from the
 * Earth's centre. The app draws the Earth as a sphere of EARTH_RADIUS_M,
 * not the WGS84 ellipsoid, so this is the one place that says where a
 * latitude, longitude and depth land. Labels are placed with it, and a
 * guide's pointer aims with it, so the two cannot drift apart.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';

/** The point at `lat`, `lon` in degrees, `depthKm` below the surface. */
export function earthPoint(lat: number, lon: number, depthKm = 0): THREE.Vector3 {
  const lonRad = (lon * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const radius = EARTH_RADIUS_M - depthKm * 1000;
  return new THREE.Vector3(
    radius * Math.cos(latRad) * Math.cos(lonRad),
    radius * Math.cos(latRad) * Math.sin(lonRad),
    radius * Math.sin(latRad)
  );
}
