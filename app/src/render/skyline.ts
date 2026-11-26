/**
 * The local skyline: how high the land stands above the horizon in every
 * direction from where the view stands, worked out from elevation tiles.
 *
 * The ground underfoot is glass (globe.ts), so the only local cue left was
 * a flat ring at the geometric horizon - the same ring in the Alps as on
 * the sea. The skyline puts the real hills and mountains there instead.
 *
 * Tiles are AWS Terrain Tiles (Tilezen/Joerd), terrarium encoding:
 * metres = R·256 + G + B/256 − 32768, in Web Mercator XYZ tiles of 256 px.
 */

import { EARTH_RADIUS_M } from '@transparent-earth/core';

export const TERRAIN_TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
export const TILE_PX = 256;

/** Directions around the horizon, one per half degree. */
export const SKYLINE_BINS = 720;

/**
 * Refraction bends sightlines down along the Earth's curve; the standard
 * coefficient 0.13 is the same as looking over a sphere 1/(1 − 0.13) as big.
 */
const EFFECTIVE_RADIUS_M = EARTH_RADIUS_M / (1 - 0.13);

const DEG = Math.PI / 180;

export function terrariumMetres(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Fractional Web Mercator tile coordinates of a point at zoom `z`. */
export function tileXY(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const latR = Math.max(-85.0511, Math.min(85.0511, lat)) * DEG;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n };
}

/** The tiles at zoom `z` that cover a square `radiusM` around a point, as a block of columns and rows. */
export function tileBlock(lat: number, lon: number, z: number, radiusM: number): { z: number; x0: number; y0: number; cols: number; rows: number } {
  const dLat = radiusM / EARTH_RADIUS_M / DEG;
  const dLon = dLat / Math.max(0.05, Math.cos(lat * DEG));
  const nw = tileXY(Math.min(85, lat + dLat), lon - dLon, z);
  const se = tileXY(Math.max(-85, lat - dLat), lon + dLon, z);
  const x0 = Math.floor(nw.x);
  const y0 = Math.floor(nw.y);
  return { z, x0, y0, cols: Math.floor(se.x) - x0 + 1, rows: Math.floor(se.y) - y0 + 1 };
}

/** A block of decoded tiles: metres, row-major over the whole block, NaN where a tile failed. */
export class ElevationMosaic {
  private readonly width: number;
  private readonly height: number;
  private readonly n: number;

  constructor(
    readonly block: { z: number; x0: number; y0: number; cols: number; rows: number },
    readonly metres: Float32Array,
  ) {
    this.width = block.cols * TILE_PX;
    this.height = block.rows * TILE_PX;
    this.n = 2 ** block.z;
  }

  /** Bilinear elevation in metres, or NaN outside the block or over a missing tile. */
  sample(lat: number, lon: number): number {
    const latR = Math.max(-85.0511, Math.min(85.0511, lat)) * DEG;
    let tx0 = ((((lon + 180) % 360) + 360) % 360 / 360) * this.n - this.block.x0;
    // A block straddling the antimeridian starts west of it.
    if (tx0 < 0) tx0 += this.n;
    const ty0 = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * this.n - this.block.y0;
    // Pixel centres sit half a pixel in.
    const fx = tx0 * TILE_PX - 0.5;
    const fy = ty0 * TILE_PX - 0.5;
    if (fx < 0 || fy < 0 || fx >= this.width - 1 || fy >= this.height - 1) return NaN;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const i = iy * this.width + ix;
    const m = this.metres;
    const top = m[i] + (m[i + 1] - m[i]) * tx;
    const bottom = m[i + this.width] + (m[i + this.width + 1] - m[i + this.width]) * tx;
    return top + (bottom - top) * ty;
  }
}

export type ElevationSampler = (lat: number, lon: number) => number;

/** The first sampler that has a value: finer mosaics first. NaN if none does. */
export function layeredSampler(mosaics: readonly ElevationMosaic[]): ElevationSampler {
  return (lat, lon) => {
    for (const mosaic of mosaics) {
      const value = mosaic.sample(lat, lon);
      if (!Number.isNaN(value)) return value;
    }
    return NaN;
  };
}

export interface SkylineOptions {
  readonly bins?: number;
  readonly maxDistanceM?: number;
  /** The viewer's eye above the ground. */
  readonly eyeHeightM?: number;
  /** Elevation angle below which the skyline never goes, radians: the drawn sphere's own horizon. */
  readonly floorRad?: number;
}

/**
 * Highest elevation angle of the land, radians above level, in each of
 * `bins` directions clockwise from north (bin i at azimuth i·360/bins).
 * The sea counts as level: bathymetry under it does not lift the horizon.
 */
export function skylineProfile(sample: ElevationSampler, lat: number, lon: number, options: SkylineOptions = {}): Float32Array {
  const work = skylineWork(sample, lat, lon, options);
  work.run(work.out.length);
  return work.out;
}

/**
 * The same, a slice at a time: about 80 ms of work in all on a laptop, so it gives the frame loop back every
 * `binsPerSlice` directions rather than hold a phone's frame for a quarter of a second.
 */
export async function skylineProfileSliced(
  sample: ElevationSampler,
  lat: number,
  lon: number,
  options: SkylineOptions = {},
  binsPerSlice = 48,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const work = skylineWork(sample, lat, lon, options);
  while (!work.run(binsPerSlice)) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) throw signal.reason;
  }
  return work.out;
}

function skylineWork(sample: ElevationSampler, lat: number, lon: number, options: SkylineOptions): { out: Float32Array; run(bins: number): boolean } {
  const bins = options.bins ?? SKYLINE_BINS;
  const maxDistanceM = options.maxDistanceM ?? 150_000;
  const floor = options.floorRad ?? 0;
  const ground = sample(lat, lon);
  const eye = Math.max(0, Number.isNaN(ground) ? 0 : ground) + (options.eyeHeightM ?? 1.5);

  const lat1 = lat * DEG;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const out = new Float32Array(bins).fill(floor);
  let next = 0;
  return {
    out,
    run(count) {
      const end = Math.min(bins, next + count);
      for (; next < end; next++) {
        const azimuth = (next / bins) * 2 * Math.PI;
        const sinAz = Math.sin(azimuth);
        const cosAz = Math.cos(azimuth);
        let best = floor;
        // Steps grow with distance: 1% of the way out, never under 30 m.
        for (let d = 30; d <= maxDistanceM; d += Math.max(30, d * 0.01)) {
          const delta = d / EARTH_RADIUS_M;
          const sinD = Math.sin(delta);
          const cosD = Math.cos(delta);
          const sinLat2 = sinLat1 * cosD + cosLat1 * sinD * cosAz;
          const lat2 = Math.asin(sinLat2);
          const lon2 = lon * DEG + Math.atan2(sinAz * sinD * cosLat1, cosD - sinLat1 * sinLat2);
          const h = sample(lat2 / DEG, lon2 / DEG);
          if (Number.isNaN(h)) continue;
          const angle = Math.atan2(Math.max(0, h) - eye - (d * d) / (2 * EFFECTIVE_RADIUS_M), d);
          if (angle > best) best = angle;
        }
        out[next] = best;
      }
      return next >= bins;
    },
  };
}
