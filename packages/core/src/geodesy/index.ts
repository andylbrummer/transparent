/**
 * WGS84 ellipsoid parameters
 */
export const WGS84 = {
  a: 6378137.0,           // semi-major axis (m)
  f: 1 / 298.257223563,   // flattening
  get b() { return this.a * (1 - this.f); }, // semi-minor axis
  get e2() { return 2 * this.f - this.f * this.f; }, // first eccentricity squared
} as const;

export interface LatLonAlt {
  readonly lat: number;  // degrees
  readonly lon: number;  // degrees
  readonly alt: number;  // meters above ellipsoid
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/**
 * Convert geodetic lat/lon/alt to ECEF (Earth-Centered Earth-Fixed) Cartesian.
 * WGS84 ellipsoid. lat/lon in degrees, alt in meters.
 */
export function geodeticToEcef(lla: LatLonAlt): Vec3 {
  const latRad = (lla.lat * Math.PI) / 180;
  const lonRad = (lla.lon * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  const cosLon = Math.cos(lonRad);
  const sinLon = Math.sin(lonRad);

  const N = WGS84.a / Math.sqrt(1 - WGS84.e2 * sinLat * sinLat);

  const x = (N + lla.alt) * cosLat * cosLon;
  const y = (N + lla.alt) * cosLat * sinLon;
  const z = (N * (1 - WGS84.e2) + lla.alt) * sinLat;

  return { x, y, z };
}

/**
 * Convert ECEF Cartesian to geodetic lat/lon/alt.
 * WGS84 ellipsoid. Returns lat/lon in degrees, alt in meters.
 * Uses Olson's iterative method (converges in 2-3 iterations).
 */
export function ecefToGeodetic(ecef: Vec3): LatLonAlt {
  const { x, y, z } = ecef;
  const p = Math.sqrt(x * x + y * y);

  // Olson's iterative method for latitude and altitude
  let latRad = Math.atan2(z, p * (1 - WGS84.e2));
  let alt = 0;
  for (let i = 0; i < 10; i++) {
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const N = WGS84.a / Math.sqrt(1 - WGS84.e2 * sinLat * sinLat);
    alt = p / cosLat - N;
    latRad = Math.atan2(z + WGS84.e2 * N * sinLat, p);
  }

  const lonRad = Math.atan2(y, x);

  return {
    lat: (latRad * 180) / Math.PI,
    lon: (lonRad * 180) / Math.PI,
    alt,
  };
}

/**
 * Compute the antipode (point diametrically opposite) of a lat/lon.
 * Altitude is preserved.
 */
export function antipode(lla: LatLonAlt): LatLonAlt {
  return {
    lat: -lla.lat,
    lon: lla.lon > 0 ? lla.lon - 180 : lla.lon + 180,
    alt: lla.alt,
  };
}

/**
 * Great-circle angular distance between two points on a unit sphere.
 * Returns central angle in radians (multiply by Earth's radius for arc length).
 * Uses haversine formula for numerical stability at small angles.
 */
export function angularDistance(a: LatLonAlt, b: LatLonAlt): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;

  const sinDLat2 = Math.sin(dLat / 2);
  const sinDLon2 = Math.sin(dLon / 2);

  const c = sinDLat2 * sinDLat2 +
    Math.cos(lat1) * Math.cos(lat2) * sinDLon2 * sinDLon2;

  // Clamp to [0, 1] to avoid numerical errors
  return 2 * Math.asin(Math.min(1, Math.sqrt(c)));
}

/**
 * ENU (East-North-Up) local tangent frame at a given lat/lon.
 * Returns orthonormal basis vectors: e (east), n (north), u (up).
 * All vectors are unit length in ECEF space.
 */
export function enuBasis(lla: LatLonAlt): { e: Vec3; n: Vec3; u: Vec3 } {
  const latRad = (lla.lat * Math.PI) / 180;
  const lonRad = (lla.lon * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);
  const cosLon = Math.cos(lonRad);
  const sinLon = Math.sin(lonRad);

  // East: tangent to parallel, points in +lon direction
  const e = { x: -sinLon, y: cosLon, z: 0 };

  // North: tangent to meridian, points in +lat direction
  const n = { x: -sinLat * cosLon, y: -sinLat * sinLon, z: cosLat };

  // Up: radial outward from ellipsoid center
  const u = { x: cosLat * cosLon, y: cosLat * sinLon, z: sinLat };

  return { e, n, u };
}

/**
 * Convert ECEF vector to ENU coordinates at a given origin lat/lon.
 * The ECEF vector is interpreted as a displacement from the origin point.
 */
export function ecefToEnu(origin: LatLonAlt, ecefVec: Vec3): Vec3 {
  const basis = enuBasis(origin);
  return {
    x: basis.e.x * ecefVec.x + basis.e.y * ecefVec.y + basis.e.z * ecefVec.z,
    y: basis.n.x * ecefVec.x + basis.n.y * ecefVec.y + basis.n.z * ecefVec.z,
    z: basis.u.x * ecefVec.x + basis.u.y * ecefVec.y + basis.u.z * ecefVec.z,
  };
}

/**
 * Convert ENU coordinates at a given origin to ECEF displacement vector.
 */
export function enuToEcef(origin: LatLonAlt, enu: Vec3): Vec3 {
  const basis = enuBasis(origin);
  return {
    x: basis.e.x * enu.x + basis.n.x * enu.y + basis.u.x * enu.z,
    y: basis.e.y * enu.x + basis.n.y * enu.y + basis.u.y * enu.z,
    z: basis.e.z * enu.x + basis.n.z * enu.y + basis.u.z * enu.z,
  };
}

/**
 * Floating-origin transform: convert a global ECEF position to local coordinates
 * relative to an origin ECEF position.
 * Uses double-precision subtraction on CPU, then converts to float-safe local coords.
 */
export function toFloatingOrigin(originEcef: Vec3, targetEcef: Vec3): Vec3 {
  return {
    x: targetEcef.x - originEcef.x,
    y: targetEcef.y - originEcef.y,
    z: targetEcef.z - originEcef.z,
  };
}

/**
 * Inverse floating-origin: convert local coordinates back to global ECEF.
 */
export function fromFloatingOrigin(originEcef: Vec3, local: Vec3): Vec3 {
  return {
    x: originEcef.x + local.x,
    y: originEcef.y + local.y,
    z: originEcef.z + local.z,
  };
}

/**
 * Solar position: compute azimuth and elevation of the sun at a given
 * location and UTC instant. Uses a simplified astronomical algorithm
 * accurate to ~0.5° for the period 2000–2050.
 *
 * Returns azimuth (degrees from north, clockwise) and elevation (degrees
 * above horizon; negative = below).
 *
 * Reference: NOAA Solar Calculator (approximate)
 */
export function solarPosition(lla: LatLonAlt, utc: Date): { azimuth: number; elevation: number } {
  const latRad = (lla.lat * Math.PI) / 180;
  const lonRad = (lla.lon * Math.PI) / 180;

  // Julian day number (days since J2000.0)
  const msPerDay = 86400000;
  const J2000 = 946728000000; // Date.UTC(2000, 0, 1, 12, 0, 0)
  const jd = (utc.getTime() - J2000) / msPerDay;

  // Mean longitude of the sun (degrees)
  const L = (280.46 + 0.9856474 * jd) % 360;

  // Mean anomaly of the sun (radians)
  const g = ((357.529 + 0.9856003 * jd) * Math.PI) / 180;

  // Ecliptic longitude of the sun (radians)
  const lambda = ((L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI) / 180;

  // Obliquity of the ecliptic (radians)
  const epsilon = ((23.439 - 0.0000004 * jd) * Math.PI) / 180;

  // Right ascension and declination
  const alpha = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const delta = Math.asin(Math.sin(epsilon) * Math.sin(lambda));

  // Local apparent sidereal time (radians)
  let theta0 = (4.894961213 + 6.300388099 * jd + lonRad) % (2 * Math.PI);
  if (theta0 < 0) {
    theta0 += 2 * Math.PI;
  }
  const hourAngle = theta0 - alpha;

  // Elevation
  const sinElev =
    Math.sin(latRad) * Math.sin(delta) +
    Math.cos(latRad) * Math.cos(delta) * Math.cos(hourAngle);
  const elevation = (Math.asin(sinElev) * 180) / Math.PI;

  // Azimuth (from north, clockwise)
  const y = -Math.sin(hourAngle) * Math.cos(delta);
  const x =
    Math.cos(latRad) * Math.sin(delta) -
    Math.sin(latRad) * Math.cos(delta) * Math.cos(hourAngle);
  let azimuth = (Math.atan2(y, x) * 180) / Math.PI;
  if (azimuth < 0) azimuth += 360;

  return { azimuth, elevation };
}

/**
 * Compute the subsolar point (lat/lon where the sun is directly overhead)
 * at a given UTC instant.
 */
export function subsolarPoint(utc: Date): LatLonAlt {
  const msPerDay = 86400000;
  const J2000 = 946728000000;
  const jd = (utc.getTime() - J2000) / msPerDay;

  const L = (280.46 + 0.9856474 * jd) % 360;
  const g = ((357.529 + 0.9856003 * jd) * Math.PI) / 180;
  const lambda = ((L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI) / 180;
  const epsilon = ((23.439 - 0.0000004 * jd) * Math.PI) / 180;

  const declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const rightAscension = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));

  // Greenwich Mean Sidereal Time at 0h UT (radians)
  const gmst = (4.894961213 + 6.300388099 * jd) % (2 * Math.PI);
  const longitude = ((gmst - rightAscension) * 180) / Math.PI;

  return {
    lat: (declination * 180) / Math.PI,
    lon: ((longitude + 180) % 360) - 180, // wrap to [-180, 180]
    alt: 0,
  };
}
