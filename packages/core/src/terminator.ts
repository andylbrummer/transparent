/**
 * Day/night terminator calculation using solar position from core geodesy.
 *
 * The terminator is the boundary between day and night on Earth.
 * It is a great circle perpendicular to the subsolar vector.
 * Points on the sphere with dot(subsolar, point) >= 0 are in daylight.
 */

import {
  type Vec3,
  type LatLonAlt,
  vec3,
  subsolarPoint,
  geodeticToEcef,
  WGS84,
} from './geodesy';

/** Earth mean radius in metres (spherical approximation for terminator). */
export const EARTH_RADIUS_M = 6371000;

/** Angular radius of the sun in degrees (for soft terminator). */
export const SUN_ANGULAR_RADIUS_DEG = 0.266;

/** Terminator geometry descriptor. */
export interface TerminatorGeometry {
  /** Subsolar point in ECEF (unit vector scaled by Earth radius). */
  readonly subsolarEcef: Vec3;
  /** Angular radius of the sun in degrees. */
  readonly sunAngularRadiusDeg: number;
}

/**
 * Compute the subsolar ECEF position at a given UTC instant.
 * Uses the simplified solar algorithm from geodesy (accurate to ~0.5°).
 */
export function subsolarEcef(utc: Date): Vec3 {
  const sp = subsolarPoint(utc);
  const latRad = (sp.lat * Math.PI) / 180;
  const lonRad = (sp.lon * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  const cosLon = Math.cos(lonRad);
  const sinLon = Math.sin(lonRad);

  return {
    x: EARTH_RADIUS_M * cosLat * cosLon,
    y: EARTH_RADIUS_M * cosLat * sinLon,
    z: EARTH_RADIUS_M * sinLat,
  };
}

/**
 * Compute terminator geometry for a given UTC instant.
 */
export function computeTerminator(utc: Date): TerminatorGeometry {
  return {
    subsolarEcef: subsolarEcef(utc),
    sunAngularRadiusDeg: SUN_ANGULAR_RADIUS_DEG,
  };
}

/**
 * Test whether a point (lat/lon) is in daylight at the given UTC.
 * Returns true if the sun is above the horizon (elevation > 0).
 *
 * Uses the dot product between the subsolar vector and the point's
 * ECEF position: daylight when dot >= 0.
 */
export function isDaylight(lat: number, lon: number, utc: Date): boolean {
  const ss = subsolarEcef(utc);

  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);

  const px = EARTH_RADIUS_M * cosLat * Math.cos(lonRad);
  const py = EARTH_RADIUS_M * cosLat * Math.sin(lonRad);
  const pz = EARTH_RADIUS_M * sinLat;

  const dot = ss.x * px + ss.y * py + ss.z * pz;
  return dot >= 0;
}

/**
 * Compute the day/night intensity factor for a point on the sphere.
 * Returns 1.0 for full daylight, 0.0 for full night, with a soft
 * transition across the terminator band.
 *
 * @param lat     Latitude in degrees
 * @param lon     Longitude in degrees
 * @param utc     UTC instant
 * @param softDeg Angular width of the terminator transition in degrees
 *                (default 0.5°)
 */
export function dayNightFactor(
  lat: number,
  lon: number,
  utc: Date,
  softDeg = 0.5
): number {
  const ss = subsolarEcef(utc);

  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);

  const px = cosLat * Math.cos(lonRad);
  const py = cosLat * Math.sin(lonRad);
  const pz = sinLat;

  const ssLen = Math.sqrt(ss.x * ss.x + ss.y * ss.y + ss.z * ss.z);
  const sx = ss.x / ssLen;
  const sy = ss.y / ssLen;
  const sz = ss.z / ssLen;

  // Cosine of the angle between subsolar and point
  const cosAngle = sx * px + sy * py + sz * pz;
  const angleRad = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
  const angleDeg = (angleRad * 180) / Math.PI;

  // 90° from subsolar = terminator
  const terminatorOffset = angleDeg - 90;

  // Soft transition
  if (terminatorOffset <= -softDeg) return 1.0;
  if (terminatorOffset >= softDeg) return 0.0;
  return 0.5 - terminatorOffset / (2 * softDeg);
}

/**
 * Generate a set of points along the terminator circle.
 * Returns an array of lat/lon pairs sampled evenly around the great circle.
 *
 * @param utc       UTC instant
 * @param segments  Number of segments around the circle (default 64)
 */
export function generateTerminatorPoints(
  utc: Date,
  segments = 64
): LatLonAlt[] {
  const ss = subsolarEcef(utc);

  // Normalise subsolar to unit vector
  const ssLen = Math.sqrt(ss.x * ss.x + ss.y * ss.y + ss.z * ss.z);
  const n = {
    x: ss.x / ssLen,
    y: ss.y / ssLen,
    z: ss.z / ssLen,
  };

  // Build an orthonormal basis (n, u, v) where u and v span the terminator plane
  // Pick an arbitrary vector not parallel to n
  const arbitrary = Math.abs(n.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };

  // u = normalize(arbitrary × n)
  const uRaw = {
    x: arbitrary.y * n.z - arbitrary.z * n.y,
    y: arbitrary.z * n.x - arbitrary.x * n.z,
    z: arbitrary.x * n.y - arbitrary.y * n.x,
  };
  const uLen = Math.sqrt(uRaw.x * uRaw.x + uRaw.y * uRaw.y + uRaw.z * uRaw.z);
  const u = {
    x: uRaw.x / uLen,
    y: uRaw.y / uLen,
    z: uRaw.z / uLen,
  };

  // v = n × u (guaranteed unit length and orthogonal)
  const v = {
    x: n.y * u.z - n.z * u.y,
    y: n.z * u.x - n.x * u.z,
    z: n.x * u.y - n.y * u.x,
  };

  const points: LatLonAlt[] = [];
  const radius = EARTH_RADIUS_M;

  for (let i = 0; i < segments; i++) {
    const theta = (2 * Math.PI * i) / segments;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    // Point on the great circle: radius * (cosT * u + sinT * v)
    const p = {
      x: radius * (cosT * u.x + sinT * v.x),
      y: radius * (cosT * u.y + sinT * v.y),
      z: radius * (cosT * u.z + sinT * v.z),
    };

    // Convert ECEF back to lat/lon
    const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    const lat = (Math.asin(p.z / r) * 180) / Math.PI;
    const lon = (Math.atan2(p.y, p.x) * 180) / Math.PI;

    points.push({ lat, lon, alt: 0 });
  }

  return points;
}

/**
 * Compute the approximate length of the terminator in kilometres.
 * The terminator is a great circle, so its length is the Earth's circumference.
 */
export function terminatorLengthKm(): number {
  return (2 * Math.PI * EARTH_RADIUS_M) / 1000;
}

/**
 * Compute the fraction of Earth's surface that is in daylight.
 * For a spherical Earth this is always exactly 0.5 (ignoring atmospheric refraction).
 */
export function daylightFraction(): number {
  return 0.5;
}
