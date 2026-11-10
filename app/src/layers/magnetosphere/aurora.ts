/**
 * The auroral ovals, now: NOAA SWPC's OVATION Prime nowcast - the
 * probability of visible aurora on a one-degree grid of the whole Earth,
 * a 30 to 90 minute forecast driven by the solar wind measured at L1 -
 * as a glow on a shell 110 km up, where the green light is made.
 *
 * The shell is drawn like the cloud layers (SurfaceShell), so from the
 * ground it is a real sheet of light overhead near the oval, a band on
 * the poleward horizon from further away, and both ovals show through
 * the Earth when looking down.
 */

import * as THREE from 'three';
import { SurfaceShell } from '../../render/surface-shell';
import type { LayerContext, LayerInstance } from '../types';
import {
  HEMI_POWER_PATH,
  KP_PATH,
  OVATION_PATH,
  fetchSwpcJson,
  fetchSwpcText,
  loadSpaceWeatherSnapshot,
  parseHemisphericPower,
  parseKp,
  parseSwpcTime,
  readingStatus,
} from './space-weather';

export const AURORA_ALTITUDE_M = 110e3;
export const GRID_WIDTH = 360;
export const GRID_HEIGHT = 181;
/** OVATION is recomputed every five minutes. */
const REFRESH_MS = 10 * 60 * 1000;

export interface OvationGrid {
  readonly observedMs: number;
  /** The instant the forecast is for. */
  readonly forecastMs: number;
  /**
   * Probability of aurora, percent, GRID_WIDTH × GRID_HEIGHT: row 0 is
   * 90°S, column 0 is 180°W - the layout of the globe's own textures.
   */
  readonly percent: Uint8Array;
}

/** Parse ovation_aurora_latest.json: {"Observation Time", "Forecast Time", coordinates: [[lon 0..359, lat -90..90, percent], ...]}. */
export function parseOvation(json: unknown): OvationGrid | null {
  if (typeof json !== 'object' || json === null) return null;
  const record = json as Record<string, unknown>;
  const coordinates = record.coordinates;
  const observedMs = parseSwpcTime(record['Observation Time']);
  const forecastMs = parseSwpcTime(record['Forecast Time']);
  if (!Array.isArray(coordinates) || !Number.isFinite(observedMs) || !Number.isFinite(forecastMs)) return null;
  const percent = new Uint8Array(GRID_WIDTH * GRID_HEIGHT);
  let filled = 0;
  for (const entry of coordinates as unknown[]) {
    if (!Array.isArray(entry)) continue;
    const [lon, lat, value] = entry as number[];
    if (!Number.isInteger(lon) || !Number.isInteger(lat) || !(value >= 0) || lat < -90 || lat > 90) continue;
    const column = (((lon + 180) % 360) + 360) % 360;
    percent[(lat + 90) * GRID_WIDTH + column] = Math.min(100, Math.round(value));
    filled++;
  }
  // A grid with holes would draw as dark stripes that look like data.
  return filled >= GRID_WIDTH * GRID_HEIGHT ? { observedMs, forecastMs, percent } : null;
}

const SHADE_GLSL = `
  // Texel centres are whole degrees: column 0 is 180°W exactly, row 0 the south pole.
  vec2 at = vec2(uv.x + 0.5 / ${GRID_WIDTH}.0, (uv.y * ${GRID_HEIGHT - 1}.0 + 0.5) / ${GRID_HEIGHT}.0);
  // Stored as percent in a byte.
  float p = texture2D(uMap, at).r * 2.55;
  // Oxygen green where aurora is merely likely, turning to the red-violet fringe of a strong display.
  vec3 color = mix(vec3(0.22, 1.0, 0.42), vec3(1.0, 0.32, 0.72), smoothstep(0.55, 0.95, p));
  return vec4(color, smoothstep(0.015, 0.3, p) * 0.95);
`;

function gridTexture(percent: Uint8Array): THREE.DataTexture {
  const texture = new THREE.DataTexture(percent, GRID_WIDTH, GRID_HEIGHT, THREE.RedFormat, THREE.UnsignedByteType);
  texture.unpackAlignment = 1;
  return texture;
}

interface Shown {
  readonly forecastMs: number;
  readonly fromNetwork: boolean;
  readonly detail: string;
}

export async function createAuroraLayer(context: LayerContext): Promise<LayerInstance> {
  const shell = new SurfaceShell(context.skyUniforms, {
    name: 'aurora',
    altitudeM: AURORA_ALTITUDE_M,
    blending: THREE.AdditiveBlending,
    shadeGlsl: SHADE_GLSL,
    // Overhead is exactly where an aurora is watched from: no clear zone around the user.
    nearFadeDeg: [0, 0.01],
  });
  context.earthRoot.add(shell.object);
  let shown: Shown | null = null;
  let lastFetch = performance.now();
  let busy = false;
  let disposed = false;
  let status = '';

  function show(texture: THREE.Texture, next: Shown): void {
    if (disposed) {
      texture.dispose();
      return;
    }
    (shell.uniforms.uMap.value as THREE.Texture | null)?.dispose();
    shell.setTexture(texture);
    shown = next;
    status = '';
  }

  const detailText = (kp: number | null, power: { north: number; south: number } | null): string =>
    [kp === null ? '' : `Kp ${kp.toFixed(1)}`, power === null ? '' : `${power.north} GW north, ${power.south} GW south`].filter(Boolean).join(' · ');

  async function refresh(): Promise<void> {
    if (busy || disposed) return;
    busy = true;
    try {
      const grid = parseOvation(await fetchSwpcJson(context, OVATION_PATH));
      if (!grid) throw new Error('OVATION grid not understood');
      // The numbers beside the map are extras: the oval shows without them.
      const [kp, power] = await Promise.all([
        fetchSwpcJson(context, KP_PATH).then(parseKp, () => null),
        fetchSwpcText(HEMI_POWER_PATH).then(parseHemisphericPower, () => null),
      ]);
      show(gridTexture(grid.percent), { forecastMs: grid.forecastMs, fromNetwork: true, detail: detailText(kp?.kp ?? null, power) });
    } catch (error) {
      if (shown === null) {
        console.error('aurora: live nowcast unavailable, using the baked snapshot', error);
        const snapshot = await loadSpaceWeatherSnapshot(context);
        const texture = await new THREE.TextureLoader().loadAsync(context.assetUrl('space/aurora.png'));
        texture.colorSpace = THREE.NoColorSpace;
        show(texture, {
          forecastMs: parseSwpcTime(snapshot.aurora.forecast),
          fromNetwork: false,
          detail: detailText(snapshot.kp?.kp ?? null, snapshot.aurora.hemisphericPowerGw),
        });
      }
    } finally {
      busy = false;
    }
  }

  await refresh();
  if (shown === null) throw new Error('no aurora nowcast, live or baked');

  return {
    setVisible(visible) {
      shell.object.visible = visible;
    },
    update(frame) {
      const wall = performance.now();
      if (wall - lastFetch > REFRESH_MS) {
        lastFetch = wall;
        void refresh();
      }
      if (shown) {
        const next = readingStatus('forecast', shown.forecastMs, shown.fromNetwork, frame.date.getTime(), shown.detail);
        if (next.text !== status) {
          status = next.text;
          context.setStatus(next.text, next.tone);
        }
      }
    },
    dispose() {
      disposed = true;
      shell.dispose();
    },
  };
}
