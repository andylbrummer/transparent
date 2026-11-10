/**
 * The baked rays as the app ships them, for tests: read from
 * app/public/geo once per test file.
 */

import { readFileSync } from 'node:fs';
import { parseWaveData, type WaveData, type WaveManifest } from './data';

// Held in a variable: Vite rewrites `new URL('literal', import.meta.url)` into an asset URL, which is not a file.
const here = import.meta.url;
const baked = (name: string): URL => new URL(`../../../public/geo/${name}`, here);

export function loadBakedWaves(): WaveData {
  const manifest = JSON.parse(readFileSync(baked('seismic-waves.json'), 'utf8')) as WaveManifest;
  const bytes = readFileSync(baked('seismic-waves.bin'));
  return parseWaveData(manifest, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}
