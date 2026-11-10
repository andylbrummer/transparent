/**
 * The colour scales the weather layers draw with, in one place so the
 * panel's legend and the picture cannot drift apart. Small and free of
 * three.js: layer.ts imports it eagerly for the legends.
 */

/** A value and its colour, 0xRRGGBB. Stops ascend by value. */
export type RampStop = readonly [value: number, color: number];

/** 2 m air temperature, °C. */
export const TEMPERATURE_RAMP: readonly RampStop[] = [
  [-45, 0x4a1a78],
  [-30, 0x3b3fc4],
  [-15, 0x3f8fe0],
  [0, 0xbfe8f2],
  [10, 0x59b86a],
  [20, 0xf2e04a],
  [30, 0xf08a24],
  [40, 0xc4262b],
  [48, 0x5a0a16],
];

/** Wind speed at 10 m, m/s: calm air faint, a gale hot. */
export const WIND_10M_RAMP: readonly RampStop[] = [
  [0, 0x8ab4d6],
  [5, 0xa8e6f2],
  [10, 0xdff5c8],
  [16, 0xffd166],
  [24, 0xff7043],
  [34, 0xff3d9a],
];

/** Wind speed at 250 hPa, m/s: the jet streams stand out of a dim background. */
export const WIND_250HPA_RAMP: readonly RampStop[] = [
  [0, 0x6f8fae],
  [20, 0x7fc4e8],
  [40, 0xb8f0d0],
  [60, 0xffe066],
  [80, 0xff8a3d],
  [110, 0xff4fa3],
];

const channels = (color: number): [number, number, number] => [(color >> 16) & 255, (color >> 8) & 255, color & 255];

/** The ramp's colour at `value`, as 0..255 channels; clamps beyond the ends. */
export function rampColor(ramp: readonly RampStop[], value: number): [number, number, number] {
  if (value <= ramp[0][0]) return channels(ramp[0][1]);
  for (let i = 1; i < ramp.length; i++) {
    if (value <= ramp[i][0]) {
      const t = (value - ramp[i - 1][0]) / (ramp[i][0] - ramp[i - 1][0]);
      const a = channels(ramp[i - 1][1]);
      const b = channels(ramp[i][1]);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
  }
  return channels(ramp[ramp.length - 1][1]);
}

/** The ramp as a CSS gradient, each stop placed by its value. */
export function rampGradient(ramp: readonly RampStop[]): string {
  const low = ramp[0][0];
  const span = ramp[ramp.length - 1][0] - low;
  const stops = ramp.map(([value, color]) => `#${color.toString(16).padStart(6, '0')} ${(((value - low) / span) * 100).toFixed(0)}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** The ramp as a width × 1 strip of RGBA bytes, for a lookup texture. */
export function rampStrip(ramp: readonly RampStop[], width: number): Uint8Array {
  const low = ramp[0][0];
  const span = ramp[ramp.length - 1][0] - low;
  const strip = new Uint8Array(width * 4);
  for (let i = 0; i < width; i++) {
    const [r, g, b] = rampColor(ramp, low + (span * i) / (width - 1));
    strip.set([Math.round(r), Math.round(g), Math.round(b), 255], i * 4);
  }
  return strip;
}
