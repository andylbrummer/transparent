/**
 * PREM (Preliminary Reference Earth Model) layer radii in kilometers.
 * These define the boundaries of Earth's interior shells.
 */
export const PREM_LAYERS = [
  { name: 'inner core', radiusKm: 1221.5, color: [1.0, 0.8, 0.2] as const, alpha: 0.9 },
  { name: 'outer core', radiusKm: 3480.0, color: [1.0, 0.5, 0.1] as const, alpha: 0.7 },
  { name: 'lower mantle', radiusKm: 5701.0, color: [0.8, 0.3, 0.1] as const, alpha: 0.5 },
  { name: 'upper mantle', radiusKm: 6371.0, color: [0.6, 0.4, 0.2] as const, alpha: 0.3 },
  { name: 'crust', radiusKm: 6371.0 + 35.0, color: [0.3, 0.6, 0.3] as const, alpha: 0.15 },
] as const;

/** Earth radius in meters (WGS84) */
export const EARTH_RADIUS_M = 6_371_000;

/** Convert PREM layer radii to origin-relative shader units (meters) */
export function premRadiiToMeters(): Float32Array {
  const radii = new Float32Array(PREM_LAYERS.length);
  for (let i = 0; i < PREM_LAYERS.length; i++) {
    radii[i] = PREM_LAYERS[i].radiusKm * 1000;
  }
  return radii;
}

/** Layer colors as vec3 RGB */
export function premColors(): Float32Array {
  const colors = new Float32Array(PREM_LAYERS.length * 3);
  for (let i = 0; i < PREM_LAYERS.length; i++) {
    colors[i * 3 + 0] = PREM_LAYERS[i].color[0];
    colors[i * 3 + 1] = PREM_LAYERS[i].color[1];
    colors[i * 3 + 2] = PREM_LAYERS[i].color[2];
  }
  return colors;
}

/** Layer alphas */
export function premAlphas(): Float32Array {
  const alphas = new Float32Array(PREM_LAYERS.length);
  for (let i = 0; i < PREM_LAYERS.length; i++) {
    alphas[i] = PREM_LAYERS[i].alpha;
  }
  return alphas;
}
