/**
 * The oil and gas fields' colours, labels and data shape, apart from
 * three.js so the panel's legend and the tests can use them. The picture
 * (tools/pipeline/generate_oil_gas_fields.py) holds a fluid class in red,
 * 1..4 in this order, and coverage in blue.
 */

export const FLUID_COLORS = {
  oil: '#ff8a1f',
  gas: '#4fd3ff',
  'oil and gas': '#c27dff',
  'not given': '#efe6c8',
} as const;

export type Fluid = keyof typeof FLUID_COLORS;
export const FLUIDS = Object.keys(FLUID_COLORS) as Fluid[];

export interface FieldLabel {
  readonly name: string;
  readonly country: string;
  readonly region: string;
  readonly fluid: Fluid;
  readonly km2: number;
  readonly lon: number;
  readonly lat: number;
}

export interface OilGasFieldsData {
  readonly records: number;
  readonly drawn: number;
  readonly fluids: Readonly<Record<Fluid, number>>;
  readonly labels: readonly FieldLabel[];
}

/** Four equal bands, in class order. */
export const FIELDS_LEGEND = `linear-gradient(to right, ${FLUIDS.map((fluid, i) => `${FLUID_COLORS[fluid]} ${i * 25}% ${(i + 1) * 25}%`).join(', ')})`;

const SMALL_WORDS = new Set(['and', 'of', 'de', 'la']);

/** "ROMASHKINSKOE AND SHUGUROVSKOE" → "Romashkinskoe and Shugurovskoe": the data's names are in capitals. */
export function fieldName(name: string): string {
  return name
    .toLowerCase()
    .split(' ')
    .map((word, i) => (i > 0 && SMALL_WORDS.has(word) ? word : word.replace(/(^|[-/(])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase())))
    .join(' ');
}

export function fieldLabelText(label: FieldLabel): string {
  return `${fieldName(label.name)} · ${label.km2.toLocaleString('en-US')} km²`;
}

/** Body of SurfaceShell's shade(texel, n, uv). The class is read at the texel's centre, unblended; coverage blended. */
export const FIELDS_SHADE_GLSL = `
    vec2 centre = (floor(uv * uSize) + 0.5) / uSize;
    float fluid = floor(texture2D(uMap, centre).r * 255.0 + 0.5);
    float cover = texel.b;
    if (cover < 0.004) return vec4(0.0);
    vec3 color = fluid < 1.5 ? uColors[0] : fluid < 2.5 ? uColors[1] : fluid < 3.5 ? uColors[2] : uColors[3];
    // Most fields are a few km across, a fraction of a pixel: a small share is still a field there.
    return vec4(color, 0.95 * smoothstep(0.0, 0.35, cover));
`;
