/**
 * The geophysical fields draped on the surface, and how each is coloured:
 * small and free of three.js, because layer.ts builds the panel from it.
 *
 * Each image (app/public/geo/fields/, tools/pipeline/generate_earth_fields.py)
 * holds a value's code in red, 0..1 across the field's scale; a ramp here
 * is written over that same 0..1, so the picture and the legend are one
 * thing. The scales (ranges, square-root and log codings) are the bake's:
 * its test reads this file and holds the two together.
 */

import type { Credit } from '../types';
import type { RampStop } from '../weather/ramps';

export interface FieldLabel {
  readonly text: string;
  readonly lon: number;
  readonly lat: number;
}

export interface EarthField {
  readonly id: string;
  readonly label: string;
  readonly file: string;
  /** Colour over the code, 0..1. */
  readonly ramp: readonly RampStop[];
  /**
   * GLSL expression for the strength, 0..1, of a pixel whose code is `t`
   * (0..1); `s` is the same code as a signed value, −1..1 about grey 128,
   * for the fields that have a zero.
   */
  readonly alphaGlsl: string;
  /** A line wherever the code crosses a multiple of this (in code units, 0..1); absent: none. */
  readonly contourEvery?: number;
  /** Green holds the share of the pixel with data. */
  readonly coverage: boolean;
  /** Draw the cells as cells: no blending between neighbours. */
  readonly nearest?: boolean;
  readonly opacity: number;
  readonly caption: string;
  readonly credits: readonly Credit[];
  readonly labels?: readonly FieldLabel[];
}

/** The scales of the codes, as in generate_earth_fields.py. */
export const MAGNETIC_RANGE_NT = 400;
export const GEOID_RANGE_M = 110;
export const MOHO_MAX_KM = 80;
export const SEDIMENT_MAX_KM = 20;
export const HEAT_FLOW_MIN = 10;
export const HEAT_FLOW_MAX = 1000;

/** Code (0..1) of a value on each scale: the inverse of what the shader reads. */
export const magneticCode = (nt: number): number =>
  (128 + 127 * Math.sign(nt) * Math.sqrt(Math.min(Math.abs(nt) / MAGNETIC_RANGE_NT, 1))) / 255;
export const geoidCode = (m: number): number => (128 + (127 * m) / GEOID_RANGE_M) / 255;
export const mohoCode = (km: number): number => km / MOHO_MAX_KM;
export const sedimentCode = (km: number): number => Math.sqrt(km / SEDIMENT_MAX_KM);
export const heatFlowCode = (mw: number): number => Math.log(mw / HEAT_FLOW_MIN) / Math.log(HEAT_FLOW_MAX / HEAT_FLOW_MIN);

const PUBLIC_DOMAIN = 'public domain (U.S. Government work)';

const CRUST1: Credit = {
  what: 'Moho depth and sediment thickness (model CRUST1.0, 1° cells)',
  source:
    'Laske, G., Masters, G., Ma, Z. & Pasyanos, M. (2013), Update on CRUST1.0 – A 1-degree Global Model of Earth’s Crust, Geophys. Res. Abstracts 15, EGU2013-2658',
  licence: 'no stated licence; the authors ask to be cited',
  url: 'https://igppweb.ucsd.edu/~gabi/crust1.html',
};

export const EARTH_FIELDS: readonly EarthField[] = [
  {
    id: 'magnetic-anomaly',
    label: 'Magnetic anomaly of the crust',
    file: 'magnetic-anomaly.jpg',
    // Blue where the crust's magnetisation opposes today's field, pink where it adds to it.
    ramp: [
      [magneticCode(-400), 0x0a3c9c],
      [magneticCode(-100), 0x2aa3d6],
      [magneticCode(0), 0xeef3f5],
      [magneticCode(100), 0xf2679f],
      [magneticCode(400), 0x9c0f5e],
    ],
    // Clear within ±13 nT of nothing; full colour from ±200 nT. Shown whole, the grid's fine texture buries its stripes.
    alphaGlsl: 'smoothstep(0.18, 0.7, abs(s))',
    coverage: false,
    opacity: 0.85,
    caption:
      '−400 … +400 nT, square-root scale, clear near zero · stripes parallel to the ridges: seafloor magnetised as the field reversed · clear also where nothing was measured',
    credits: [
      {
        what: 'Magnetic anomaly (EMAG2 version 3, 2-arc-minute compilation)',
        source: 'Meyer, B., Saltus, R. & Chulliat, A. (2017), EMAG2v3: Earth Magnetic Anomaly Grid, NOAA National Centers for Environmental Information, doi:10.7289/V5H70CVX',
        licence: PUBLIC_DOMAIN,
        url: 'https://www.ncei.noaa.gov/products/earth-magnetic-model-anomaly-grid-2',
      },
    ],
  },
  {
    id: 'geoid',
    label: 'Geoid height (the shape of sea level)',
    file: 'geoid.png',
    ramp: [
      [geoidCode(-110), 0x2a1a7c],
      [geoidCode(-55), 0x4d74d6],
      [geoidCode(0), 0xdfe3ea],
      [geoidCode(45), 0xf2b34c],
      [geoidCode(90), 0xc44a1a],
    ],
    alphaGlsl: '0.3 + 0.55 * smoothstep(0.0, 0.3, abs(s))',
    // 10 m.
    contourEvery: (127 * 10) / GEOID_RANGE_M / 255,
    coverage: true,
    opacity: 1,
    caption:
      '−107 m (blue) … +85 m (orange) above the reference ellipsoid · a line every 10 m · where sea level sits lowest, south of India, there is less mass below · a model (EGM96)',
    credits: [
      {
        what: 'Geoid height (Earth Gravitational Model 1996, 15-arc-minute grid)',
        source: 'Lemoine, F.G. et al. (1998), The Development of the Joint NASA GSFC and NIMA Geopotential Model EGM96, NASA/TP-1998-206861; grid packaged by PROJ',
        licence: PUBLIC_DOMAIN,
        url: 'https://cdn.proj.org/',
      },
    ],
    labels: [
      { text: 'geoid low · −107 m', lon: 78.75, lat: 4.75 },
      { text: 'geoid high · +85 m', lon: 147.25, lat: -8.25 },
    ],
  },
  {
    id: 'moho-depth',
    label: 'Crust: depth of the Moho',
    file: 'moho-depth.png',
    // Thin ocean crust dark, mountain roots bright.
    ramp: [
      [mohoCode(7), 0x16264d],
      [mohoCode(24), 0x2f6f9e],
      [mohoCode(35), 0x4fbf9f],
      [mohoCode(45), 0xdfe07a],
      [mohoCode(60), 0xffb04a],
      [mohoCode(75), 0xffffff],
    ],
    alphaGlsl: `0.4 + 0.5 * smoothstep(${mohoCode(10).toFixed(4)}, ${mohoCode(30).toFixed(4)}, t)`,
    // 10 km.
    contourEvery: mohoCode(10),
    coverage: true,
    opacity: 1,
    caption:
      'base of the crust, 7 km under the oceans (dark) … 75 km under Tibet and the Andes (white), below sea level · a line every 10 km · a model (CRUST1.0), 1° cells',
    credits: [CRUST1],
  },
  {
    id: 'sediment-thickness',
    label: 'Sediment thickness',
    file: 'sediment-thickness.png',
    ramp: [
      [0, 0x2b2118],
      [sedimentCode(1), 0x6b5332],
      [sedimentCode(5), 0xc9a15a],
      [sedimentCode(10), 0xf2dc9b],
      [sedimentCode(20), 0xffffff],
    ],
    // Clear where there is under a few hundred metres.
    alphaGlsl: `0.9 * smoothstep(${sedimentCode(0.2).toFixed(4)}, ${sedimentCode(1.5).toFixed(4)}, t)`,
    coverage: true,
    opacity: 1,
    caption:
      '0 … 20 km of sediment on the crystalline crust, square-root scale · thickest in the great basins and river fans: the Gulf of Mexico, the Caspian, Bengal · a model (CRUST1.0), 1° cells',
    credits: [CRUST1],
  },
  {
    id: 'heat-flow',
    label: 'Heat flow (measured)',
    file: 'heat-flow.png',
    ramp: [
      [heatFlowCode(20), 0x231151],
      [heatFlowCode(40), 0x5f187f],
      [heatFlowCode(60), 0x982d80],
      [heatFlowCode(100), 0xde4968],
      [heatFlowCode(200), 0xfe9f6d],
      [heatFlowCode(500), 0xfcfdbf],
    ],
    alphaGlsl: '1.0',
    coverage: true,
    nearest: true,
    opacity: 0.95,
    caption:
      '20 … 500 mW/m², log scale: the median of the measurements in each 1° cell · 91,058 borehole and seabed measurements in 10,214 cells; the rest of the planet is unmeasured and left clear',
    credits: [
      {
        what: 'Heat-flow measurements',
        source: 'Global Heat Flow Data Assessment Group et al. (2024), The Global Heat Flow Database: Release 2024, v. 2026.03, GFZ Data Services, doi:10.5880/fidgeo.2024.014',
        licence: 'CC BY 4.0',
        url: 'https://doi.org/10.5880/fidgeo.2024.014',
      },
    ],
  },
];
