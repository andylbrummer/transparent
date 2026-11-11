/**
 * Permafrost zones of the Northern Hemisphere (app/public/geo/permafrost.png
 * and permafrost.json, from tools/pipeline/generate_permafrost.py; Obu et
 * al. 2018, CC BY 3.0): the zones, their colours, how the picture encodes
 * them and the chip's text. Apart from three.js so the panel's legend can
 * use it.
 *
 * The picture: R the zone, 1 continuous ... 4 isolated, in steps of
 * R_STEP (filtered, so between two zones it reads in between); B coverage.
 */

export const ZONES = ['continuous', 'discontinuous', 'sporadic', 'isolated'] as const;
export type Zone = (typeof ZONES)[number];

/** R = zone number x R_STEP. */
export const R_STEP = 64;

/** Coldest the deepest colour; the share of the ground frozen in brackets. */
export const ZONE_COLORS: Record<Zone, string> = {
  continuous: '#5b3fd1',
  discontinuous: '#3f86e0',
  sporadic: '#4fc7d6',
  isolated: '#bfeff0',
};

export const ZONE_SHARE: Record<Zone, string> = {
  continuous: 'over 90%',
  discontinuous: '50–90%',
  sporadic: '10–50%',
  isolated: 'under 10%',
};

export interface PermafrostData {
  readonly zones: readonly Zone[];
  readonly rStep: number;
  readonly areaKm2: Readonly<Record<Zone, number>>;
}

/** "21.5 million km²" style: the sum of the zones, one decimal. */
export function totalText(data: PermafrostData): string {
  const total = ZONES.reduce((sum, zone) => sum + data.areaKm2[zone], 0);
  return `${(total / 1e6).toFixed(1)} million km²`;
}

/** The chip: the region's area and the continuous zone's. */
export function permafrostStatus(data: PermafrostData): string {
  return `permafrost region ${totalText(data)} · continuous ${(data.areaKm2.continuous / 1e6).toFixed(1)} million km²`;
}

/** Zone number (1..4, fractional between zones) from R, 0..1 as the shader reads it. */
export function zoneFromRed(red: number): number {
  return (red * 255) / R_STEP;
}
