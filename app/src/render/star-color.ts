/**
 * Star colour and drawn size from catalogue photometry.
 */

/** Effective temperature (K) from B−V colour index (Ballesteros 2012, EPL 97, 34008). */
export function temperatureFromBV(bv: number): number {
  const c = Math.max(-0.4, Math.min(2.0, bv));
  return 4600 * (1 / (0.92 * c + 1.7) + 1 / (0.92 * c + 0.62));
}

/**
 * Linear-ish RGB (0..1, brightest channel 1) of a black body at `kelvin`,
 * after Tanner Helland's fit to Mitchell Charity's blackbody table. Valid
 * 1000 K to 40000 K.
 */
export function blackbodyRgb(kelvin: number): [number, number, number] {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100;
  const clamp = (v: number): number => Math.max(0, Math.min(255, v)) / 255;
  const r = t <= 66 ? 1 : clamp(329.698727446 * Math.pow(t - 60, -0.1332047592));
  const g =
    t <= 66 ? clamp(99.4708025861 * Math.log(t) - 161.1195681661) : clamp(288.1221695283 * Math.pow(t - 60, -0.0755148492));
  const b = t >= 66 ? 1 : t <= 19 ? 0 : clamp(138.5177312231 * Math.log(t - 10) - 305.0447927307);
  return [r, g, b];
}

/**
 * Colour to draw a star of colour index `bv`: its black-body colour, pulled
 * part-way to white - the eye sees star colours as tints, not as the
 * saturated hues of the table.
 */
export function starRgb(bv: number, saturation = 0.75): [number, number, number] {
  const [r, g, b] = blackbodyRgb(temperatureFromBV(bv));
  return [1 - (1 - r) * saturation, 1 - (1 - g) * saturation, 1 - (1 - b) * saturation];
}

/**
 * Sprite diameter in CSS px for visual magnitude `mag`: Sirius ≈ 12 px,
 * magnitude 2 ≈ 4.6 px, flattening toward a 2.2 px floor - past magnitude
 * 4.5 stars dim (starAlpha) rather than shrink below what a screen can show.
 */
export function starSizePx(mag: number): number {
  return Math.max(2.2, 1.8 + 10 * Math.pow(10, -0.16 * (mag + 1.5)));
}

/** Opacity for magnitude `mag`: full to magnitude 4.5, then one magnitude ≈ ×0.63. */
export function starAlpha(mag: number): number {
  return Math.max(0.12, Math.min(1, Math.pow(10, -0.2 * (mag - 4.5))));
}
