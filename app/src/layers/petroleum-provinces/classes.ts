/**
 * The petroleum provinces' colours, labels and data shape, apart from
 * three.js so the panel's legend and the tests can use them. The picture
 * (tools/pipeline/generate_petroleum_provinces.py) holds a class in red -
 * 1 not assessed, 2 oil, 3 gas, 4 assessed with no main commodity given -
 * outlines in green and coverage in blue.
 */

export const PROVINCE_COLORS = {
  oil: '#ffa64d',
  gas: '#5cc8ff',
  assessed: '#d8d0bc',
  outline: '#fff3dc',
} as const;

export interface ProvinceLabel {
  readonly code: string;
  readonly name: string;
  readonly commodity: 'oil' | 'gas';
  readonly lon: number;
  readonly lat: number;
  /** Known petroleum (produced plus reserves) by 2000, million barrels of oil equivalent. */
  readonly knownMmboe: number;
  readonly undiscoveredMmboe: number;
}

export interface PetroleumProvincesData {
  readonly records: number;
  readonly provinces: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly labels: readonly ProvinceLabel[];
}

export const PROVINCES_LEGEND = `linear-gradient(to right, ${PROVINCE_COLORS.oil} 0% 40%, ${PROVINCE_COLORS.gas} 40% 70%, ${PROVINCE_COLORS.assessed} 70% 85%, transparent 85% 100%)`;

/** "West Siberian Basin · 355 bn boe found by 2000": barrels of oil equivalent, produced plus reserves. */
export function provinceLabelText(label: ProvinceLabel): string {
  return `${label.name} · ${Math.round(label.knownMmboe / 1000).toLocaleString('en-US')} bn boe found by 2000`;
}

/** Body of SurfaceShell's shade(texel, n, uv). The class is read at the texel's centre, unblended; edges and outlines blended. */
export const PROVINCES_SHADE_GLSL = `
    vec2 centre = (floor(uv * uSize) + 0.5) / uSize;
    float kind = floor(texture2D(uMap, centre).r * 255.0 + 0.5);
    float cover = texel.b;
    float line = texel.g;
    vec3 fillColor = kind < 1.5 ? uOutline : kind < 2.5 ? uOil : kind < 3.5 ? uGas : uAssessed;
    // Provinces not assessed are only outlined; assessed ones are washed in their commodity.
    float fillAlpha = kind < 1.5 ? 0.0 : kind < 3.5 ? 0.38 : 0.22;
    vec4 fill = vec4(fillColor, fillAlpha * cover);
    float lineAlpha = 0.55 * line;
    float alpha = lineAlpha + fill.a * (1.0 - lineAlpha);
    if (alpha < 0.004) return vec4(0.0);
    vec3 color = (uOutline * lineAlpha + fill.rgb * fill.a * (1.0 - lineAlpha)) / alpha;
    return vec4(color, alpha);
`;
