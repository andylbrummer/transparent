/**
 * The colours of the seafloor-age layer, shared by its shader and its
 * legend. Kept apart from the layer's code so the eagerly loaded layer.ts
 * can build the legend without pulling three.js or the shader in.
 */

/** The age the image's code runs to; tools/pipeline/generate_seafloor_age.py's AGE_MAX_MYR. */
export const AGE_MAX_MYR = 340;

/** The legend spans this much; the little crust older still is the last colour. */
export const AGE_LEGEND_MYR = 180;

/**
 * Age (Myr) to colour: new crust glows pale yellow and cools through
 * orange, magenta and violet to a deep blue. Deliberately not the rainbow
 * of age maps: red-to-violet is already depth here (DEPTH_RAMP), and a
 * ramp that only darkens with age makes the ridges the brightest thing on
 * the ocean floor, which is the point.
 */
export const AGE_RAMP: readonly { readonly myr: number; readonly color: number }[] = [
  { myr: 0, color: 0xfff7b8 },
  { myr: 5, color: 0xffd23f },
  { myr: 20, color: 0xff8a1f },
  { myr: 40, color: 0xf0453a },
  { myr: 65, color: 0xc2257a },
  { myr: 100, color: 0x7b2aa8 },
  { myr: 140, color: 0x3d2f9c },
  { myr: 180, color: 0x1f3a7a },
];

const channels = (color: number): [number, number, number] => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];

/** The ramp's colour for an age, as display [r, g, b] 0..255; clamps past either end. */
export function ageColor(myr: number): [number, number, number] {
  const last = AGE_RAMP.length - 1;
  let i = 1;
  while (i < last && AGE_RAMP[i].myr < myr) i++;
  const t = Math.min(Math.max((myr - AGE_RAMP[i - 1].myr) / (AGE_RAMP[i].myr - AGE_RAMP[i - 1].myr), 0), 1);
  const a = channels(AGE_RAMP[i - 1].color);
  const b = channels(AGE_RAMP[i].color);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** CSS linear-gradient of AGE_RAMP, youngest on the left, AGE_LEGEND_MYR wide. */
export function ageRampGradient(): string {
  const stops = AGE_RAMP.map(
    (stop) => `#${stop.color.toString(16).padStart(6, '0')} ${((stop.myr / AGE_LEGEND_MYR) * 100).toFixed(1)}%`
  );
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** GLSL `vec3 ageRamp(float myr)`: AGE_RAMP as display values, blended as ageColor and the legend blend. */
export const AGE_RAMP_GLSL = `
  vec3 ageRamp(float myr) {
    vec3 color = vec3(${channels(AGE_RAMP[0].color)
      .map((c) => (c / 255).toFixed(5))
      .join(', ')});
${AGE_RAMP.slice(1)
  .map(
    (stop, i) =>
      `    color = mix(color, vec3(${channels(stop.color)
        .map((c) => (c / 255).toFixed(5))
        .join(', ')}), clamp((myr - ${AGE_RAMP[i].myr.toFixed(1)}) / ${(stop.myr - AGE_RAMP[i].myr).toFixed(1)}, 0.0, 1.0));`
  )
  .join('\n')}
    return color;
  }
`;
