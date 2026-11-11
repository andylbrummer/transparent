/**
 * Colours of the transition zone's boundaries, apart from three.js so the
 * panel's legend can use them. Raised (shallower) green, pushed down
 * (deeper) violet: hues the mantle slices (red slow, blue fast), the core
 * field (teal, gold) and the ULVZ (magenta) leave free.
 */

import { rampGradient, type RampStop } from '../weather/ramps';

/** Departure from the boundary's mean depth, km: negative is shallower. */
export const TRANSITION_ZONE_RAMP: readonly RampStop[] = [
  [-20, 0x2f9e4f],
  [-8, 0x8fd68f],
  [0, 0xf2efe6],
  [8, 0xb9a3f0],
  [20, 0x6a3fc8],
];

export const TRANSITION_ZONE_LEGEND = rampGradient(TRANSITION_ZONE_RAMP);

/** Departures under this many km are left clear, so only the relief shows; full strength from CLEAR_FULL_KM. */
export const CLEAR_BELOW_KM = 2;
export const CLEAR_FULL_KM = 8;

/** Body of DeepShell's shade(texel, n, uv). uScaleKm is the grey scale's half-span, uRampKm the ramp's. */
export const TRANSITION_ZONE_SHADE_GLSL = `
    float km = (texel.r * 255.0 - 128.0) / 127.0 * uScaleKm;
    vec3 color = texture2D(uRamp, vec2(clamp(km / uRampKm, -1.0, 1.0) * 0.5 + 0.5, 0.5)).rgb;
    return vec4(color, 0.85 * smoothstep(${CLEAR_BELOW_KM.toFixed(1)}, ${CLEAR_FULL_KM.toFixed(1)}, abs(km)));
`;
