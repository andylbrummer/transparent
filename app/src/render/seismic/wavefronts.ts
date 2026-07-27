/**
 * Seismic wavefront renderer utilities.
 * Computes isochron radii from travel-time texture lookups.
 */

import { type EventRecord } from '@transparent-earth/core/seismic';

export interface IsochronParams {
  readonly event: EventRecord;
  readonly simTimeMs: number;      // current simulation time
  readonly eventTimeMs: number;     // event origin time
}

/**
 * Compute the angular distance (degrees) a P-wave has traveled
 * from the event hypocenter at the current simulation time.
 * Returns null if the wave hasn't arrived yet.
 */
export function computePIsochronDistance(params: IsochronParams): number | null {
  const elapsedSimMs = params.simTimeMs - params.eventTimeMs;
  if (elapsedSimMs <= 0) return null;

  const elapsedSimSec = elapsedSimMs / 1000;
  // Approximate P-wave velocity: 8-14 km/s average through mantle
  // Simplified: 10 km/s average → distance = velocity × time
  const distanceKm = 10 * elapsedSimSec;
  const earthRadiusKm = 6371;
  const angularDistRad = distanceKm / earthRadiusKm;
  const angularDistDeg = (angularDistRad * 180) / Math.PI;

  return Math.min(angularDistDeg, 180);
}

/**
 * Compute the angular distance (degrees) an S-wave has traveled.
 * Returns null if the wave hasn't arrived yet or is in the core shadow.
 */
export function computeSIsochronDistance(params: IsochronParams): number | null {
  const elapsedSimMs = params.simTimeMs - params.eventTimeMs;
  if (elapsedSimMs <= 0) return null;

  const elapsedSimSec = elapsedSimMs / 1000;
  // S-wave velocity: ~4.5 km/s average through mantle
  const distanceKm = 4.5 * elapsedSimSec;
  const earthRadiusKm = 6371;
  const angularDistRad = distanceKm / earthRadiusKm;
  const angularDistDeg = (angularDistRad * 180) / Math.PI;

  // Core shadow: S-waves cannot propagate through the outer core (liquid)
  // Shadow zone begins at ~104° and extends to ~140°
  // For simplicity: cap at 104° (S-waves don't exist beyond this)
  if (angularDistDeg > 104) return null;

  return angularDistDeg;
}

/**
 * Compute surface-wave ring radius at current simulation time.
 * Surface waves travel ~3.5 km/s and decay over time.
 */
export function computeSurfaceWaveRadius(params: IsochronParams): { distanceDeg: number; amplitude: number } | null {
  const elapsedSimMs = params.simTimeMs - params.eventTimeMs;
  if (elapsedSimMs <= 0) return null;

  const elapsedSimSec = elapsedSimMs / 1000;
  const distanceKm = 3.5 * elapsedSimSec;
  const earthRadiusKm = 6371;
  const angularDistDeg = (distanceKm / earthRadiusKm) * (180 / Math.PI);

  // Amplitude decays with 1/sqrt(distance)
  const amplitude = 1 / Math.sqrt(1 + distanceKm / 100);

  return {
    distanceDeg: Math.min(angularDistDeg, 180),
    amplitude,
  };
}

/**
 * Check if a point (lat/lon) is within the P-wave shadow zone
 * relative to an event. Shadow zone: 104°-140° for shallow events.
 */
export function isInPShadowZone(
  eventLat: number,
  eventLon: number,
  pointLat: number,
  pointLon: number
): boolean {
  // Simplified: use haversine distance
  const dLat = ((pointLat - eventLat) * Math.PI) / 180;
  const dLon = ((pointLon - eventLon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((eventLat * Math.PI) / 180) *
      Math.cos((pointLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  const distDeg = (c * 180) / Math.PI;

  return distDeg > 104 && distDeg < 140;
}

/**
 * Notable earthquake presets for timeline playback.
 */
export const NOTABLE_EVENTS: readonly EventRecord[] = [
  {
    id: 'toff2011',
    time: '2011-03-11T05:46:24Z',
    lat: 38.297,
    lon: 142.373,
    depthKm: 29,
    mag: 9.1,
    name: 'Tōhoku 2011',
  },
  {
    id: 'sumatra2004',
    time: '2004-12-26T00:58:53Z',
    lat: 3.295,
    lon: 95.982,
    depthKm: 30,
    mag: 9.1,
    name: 'Sumatra 2004',
  },
  {
    id: 'valdivia1960',
    time: '1960-05-22T19:11:14Z',
    lat: -38.24,
    lon: -72.63,
    depthKm: 25,
    mag: 9.5,
    name: 'Valdivia 1960',
  },
];
