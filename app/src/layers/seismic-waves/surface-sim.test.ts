import { describe, expect, it } from 'vitest';
import { SIM_TEXTURE_WIDTH, loudnessAt, parseSurfaceSim, simTextureData, type SimManifest } from './surface-sim';

/** A tiny bake: `points` points, `frames` frames, point i's loudness in frame f = (f * 10 + i) mod 256. */
function bake(points: number, frames: number): { manifest: SimManifest; buffer: ArrayBuffer } {
  const lat = new Float32Array(points).map((_, i) => i);
  const lon = new Float32Array(points).map((_, i) => -i);
  const triangles = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const loud = new Uint8Array(points * frames).map((_, k) => ((Math.floor(k / points) * 10 + (k % points)) % 256));
  const pad = (n: number): number => Math.ceil(n / 4) * 4;
  const latAt = 0;
  const lonAt = latAt + lat.byteLength;
  const triAt = lonAt + lon.byteLength;
  const framesAt = pad(triAt + triangles.byteLength);
  const buffer = new ArrayBuffer(framesAt + loud.byteLength);
  new Float32Array(buffer, latAt, points).set(lat);
  new Float32Array(buffer, lonAt, points).set(lon);
  new Uint16Array(buffer, triAt, triangles.length).set(triangles);
  new Uint8Array(buffer, framesAt, loud.length).set(loud);
  const manifest: SimManifest = {
    formatVersion: 1,
    key: 'test',
    comcatId: 'x',
    gcmtId: 'y',
    source: { time: '2011-03-11T05:46:24.120Z', lat: 0, lon: 0, depthKm: 10 },
    model: 'prem_a_10s',
    points,
    triangles: 2,
    frames,
    frameS: 8,
    log10FloorMs: -6,
    log10TopMs: -2,
    layout: {
      lat: { offset: latAt, length: points, type: 'float32' },
      lon: { offset: lonAt, length: points, type: 'float32' },
      triangles: { offset: triAt, length: triangles.length, type: 'uint16' },
      frames: { offset: framesAt, length: loud.length, type: 'uint8' },
    },
  };
  return { manifest, buffer };
}

describe('the simulated shaking', () => {
  it('reads the bake', () => {
    const { manifest, buffer } = bake(5, 4);
    const sim = parseSurfaceSim(manifest, buffer);
    expect(Array.from(sim.lat)).toEqual([0, 1, 2, 3, 4]);
    expect(Array.from(sim.triangles)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(sim.frames[2 * 5 + 3]).toBe(23);
  });

  it('refuses a bake whose layout does not match its counts', () => {
    const { manifest, buffer } = bake(5, 4);
    expect(() => parseSurfaceSim({ ...manifest, frames: 5 }, buffer)).toThrow(/layout/);
  });

  it('is loud between frames as the shader has it, and silent outside the simulation', () => {
    const sim = parseSurfaceSim(bake(5, 4).manifest, bake(5, 4).buffer);
    // Point 1: 1, 11, 21, 31 in frames 0..3, 8 s apart.
    expect(loudnessAt(sim, 1, 8)).toBeCloseTo(11 / 255, 9);
    expect(loudnessAt(sim, 1, 12)).toBeCloseTo(16 / 255, 9);
    expect(loudnessAt(sim, 1, -1)).toBe(0);
    expect(loudnessAt(sim, 1, 25)).toBe(0);
  });

  it('lays the frames out in rows a GPU can hold, a frame to a whole number of rows', () => {
    const sim = parseSurfaceSim(bake(3000, 2).manifest, bake(3000, 2).buffer);
    const texture = simTextureData(sim);
    expect(texture.width).toBe(SIM_TEXTURE_WIDTH);
    expect(texture.rowsPerFrame).toBe(2);
    expect(texture.height).toBe(4);
    // Frame 1, point 2500: row 1·2 + 1, column 452.
    const at = (1 * 2 + 1) * SIM_TEXTURE_WIDTH + (2500 - SIM_TEXTURE_WIDTH);
    expect(texture.data[at]).toBe(sim.frames[1 * 3000 + 2500]);
  });
});
