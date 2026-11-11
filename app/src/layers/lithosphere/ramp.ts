/**
 * How the lithosphere's thickness is coloured, apart from three.js so the
 * panel's legend can use it. The picture (app/public/geo/lithosphere.png,
 * tools/pipeline/generate_lithosphere.py) holds round(255 * depth / 300 km);
 * the ramp is written over that same code, 0..1. Thick plate bright, thin
 * plate dark: the cratons' keels stand out, the ridges sink away.
 */

import type { RampStop } from '../weather/ramps';

/** As DEPTH_SCALE_KM in the bake: grey 255 is this deep. */
export const LITHOSPHERE_SCALE_KM = 300;

export const lithosphereCode = (km: number): number => km / LITHOSPHERE_SCALE_KM;

export const LITHOSPHERE_RAMP: readonly RampStop[] = [
  [lithosphereCode(20), 0x3a0f2e],
  [lithosphereCode(50), 0x8a2a3c],
  [lithosphereCode(90), 0xd8664a],
  [lithosphereCode(140), 0xf2b45c],
  [lithosphereCode(190), 0xf6ecc4],
  [lithosphereCode(250), 0xffffff],
];

/** A line every 50 km of thickness. */
export const LITHOSPHERE_CONTOUR_KM = 50;

/** Body of SurfaceShell's shade(texel, n, uv). */
export const LITHOSPHERE_SHADE_GLSL = `
    float t = texel.r;
    float low = ${LITHOSPHERE_RAMP[0][0].toFixed(6)};
    float high = ${LITHOSPHERE_RAMP[LITHOSPHERE_RAMP.length - 1][0].toFixed(6)};
    vec3 color = texture2D(uRamp, vec2(clamp((t - low) / (high - low), 0.0, 1.0), 0.5)).rgb;
    // The thin oceanic plate shows faintly; the keels in full.
    float alpha = 0.25 + 0.65 * smoothstep(${lithosphereCode(30).toFixed(6)}, ${lithosphereCode(150).toFixed(6)}, t);
    float interval = ${lithosphereCode(LITHOSPHERE_CONTOUR_KM).toFixed(6)};
    float perPixel = max(fwidth(t), 1.0e-6);
    float distancePx = abs(mod(t + 0.5 * interval, interval) - 0.5 * interval) / perPixel;
    float line = (1.0 - smoothstep(0.5, 1.5, distancePx)) * smoothstep(3.0, 8.0, interval / perPixel);
    color *= 1.0 - 0.45 * line;
    alpha = max(alpha, 0.8 * line);
    return vec4(color, alpha);
`;
