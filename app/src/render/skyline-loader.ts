/**
 * Fetches the elevation tiles around a place and works out its skyline
 * (skyline.ts). Two blocks: fine tiles for the near hills, coarse ones for
 * mountains out to 150 km: 6 to 12 tiles, about 1 MB.
 */

import { ElevationMosaic, TERRAIN_TILE_URL, TILE_PX, layeredSampler, skylineProfileSliced, terrariumMetres, tileBlock } from './skyline';

const NEAR = { z: 10, radiusM: 15_000 } as const;
const FAR = { z: 7, radiusM: 150_000 } as const;

async function decodeTile(url: string, signal: AbortSignal): Promise<ImageData> {
  const response = await fetch(url, { signal, mode: 'cors' });
  if (!response.ok) throw new Error(`terrain tile ${String(response.status)}`);
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(TILE_PX, TILE_PX);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2d context');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, TILE_PX, TILE_PX);
}

async function loadMosaic(lat: number, lon: number, level: { z: number; radiusM: number }, signal: AbortSignal): Promise<ElevationMosaic> {
  const block = tileBlock(lat, lon, level.z, level.radiusM);
  const width = block.cols * TILE_PX;
  const metres = new Float32Array(width * block.rows * TILE_PX).fill(NaN);
  const n = 2 ** block.z;
  const jobs: Promise<void>[] = [];
  for (let row = 0; row < block.rows; row++) {
    const y = block.y0 + row;
    if (y < 0 || y >= n) continue;
    for (let col = 0; col < block.cols; col++) {
      const x = (((block.x0 + col) % n) + n) % n;
      jobs.push(
        decodeTile(`${TERRAIN_TILE_URL}/${String(block.z)}/${String(x)}/${String(y)}.png`, signal).then(
          (image) => {
            const data = image.data;
            for (let py = 0; py < TILE_PX; py++) {
              const base = (row * TILE_PX + py) * width + col * TILE_PX;
              for (let px = 0; px < TILE_PX; px++) {
                const i = (py * TILE_PX + px) * 4;
                metres[base + px] = terrariumMetres(data[i], data[i + 1], data[i + 2]);
              }
            }
          },
          // A missing tile leaves NaN: that stretch of the skyline falls back to the coarser block, or to level.
          () => undefined,
        ),
      );
    }
  }
  await Promise.all(jobs);
  if (signal.aborted) throw signal.reason;
  return new ElevationMosaic(block, metres);
}

/** The skyline at a place, radians above level per direction; rejects if aborted. */
export async function loadSkyline(lat: number, lon: number, floorRad: number, signal: AbortSignal): Promise<Float32Array> {
  const [near, far] = await Promise.all([loadMosaic(lat, lon, NEAR, signal), loadMosaic(lat, lon, FAR, signal)]);
  return skylineProfileSliced(layeredSampler([near, far]), lat, lon, { floorRad }, 48, signal);
}
