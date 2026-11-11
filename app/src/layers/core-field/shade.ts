/**
 * Colours of the core field, apart from three.js so the panel's legend can
 * use them. Outward field gold, inward teal: hues the mantle slices (red
 * slow, blue fast) and the ULVZ (magenta) do not use, so the core reads as
 * its own thing when they are on together.
 */

import type { RampStop } from '../weather/ramps';

export const CORE_FIELD_RAMP: readonly RampStop[] = [
  [-1, 0x0b8f88],
  [-0.4, 0x3fd0c2],
  [0, 0xf2efe6],
  [0.4, 0xffc94d],
  [1, 0xe07b00],
];

/** Fields weaker than this share of the scale are left clear; full strength from CLEAR_FULL. */
export const CLEAR_BELOW = 0.04;
export const CLEAR_FULL = 0.3;

/** Body of DeepShell's shade(texel, n, uv): this epoch's picture in uMap, the next in uNext, uMix between. */
export const CORE_FIELD_SHADE_GLSL = `
    float a = (texel.r * 255.0 - 128.0) / 127.0;
    float b = (texture2D(uNext, uv).r * 255.0 - 128.0) / 127.0;
    // Stretched so half the scale is near the ends of the ramp: most of the core is under 0.6 mT.
    float v = clamp(mix(a, b, uMix) * 1.6, -1.0, 1.0);
    vec3 color = texture2D(uRamp, vec2(v * 0.5 + 0.5, 0.5)).rgb;
    return vec4(color, 0.9 * smoothstep(${CLEAR_BELOW.toFixed(2)}, ${CLEAR_FULL.toFixed(2)}, abs(v)));
`;

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** Inward on the left, outward on the right. */
export const CORE_FIELD_LEGEND = `linear-gradient(to right, ${CORE_FIELD_RAMP.map(([at, color]) => `${hex(color)} ${String(((at + 1) / 2) * 100)}%`).join(', ')})`;
