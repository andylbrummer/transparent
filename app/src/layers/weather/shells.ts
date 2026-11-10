/**
 * The weather layers that are an image draped on the planet: clouds, rain,
 * air temperature and the night side with its city lights.
 */

import * as THREE from 'three';
import { subsolarPoint } from '@transparent-earth/core';
import { RENDER_ORDER } from '../../render/order';
import { SurfaceShell, type SurfaceShellOptions } from '../../render/surface-shell';
import type { LayerContext, LayerInstance } from '../types';
import { GFS_NI, GFS_NJ, type GfsGrid } from './gfs';
import { cacheStore, ProductWatcher, type ProductSource } from './live';
import { TEMPERATURE_RAMP, rampColor } from './ramps';
import { CLOUD_LATITUDE_LIMIT_DEG, cloudSource, gfsFieldSource, precipitationSource } from './sources';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DEG = Math.PI / 180;

/**
 * Draw order among the weather shells, all between the globe's surface and
 * the coastlines: the night side lowest, then temperature, clouds over
 * both, rain over the clouds it falls from, wind on top.
 */
export const WEATHER_ORDER = {
  nightSide: RENDER_ORDER.surfaceShell,
  temperature: RENDER_ORDER.surfaceShell + 0.05,
  clouds: RENDER_ORDER.surfaceShell + 0.1,
  precipitation: RENDER_ORDER.surfaceShell + 0.15,
  wind: RENDER_ORDER.surfaceShell + 0.2,
} as const;

interface LiveShellOptions<T> {
  readonly source: ProductSource<T>;
  readonly shell: SurfaceShellOptions;
  toTexture(value: T): THREE.Texture;
  readonly refreshMs: number;
  readonly freshMs: number;
}

/** A shell whose texture is a live product, kept current while it shows. */
async function createLiveShell<T>(context: LayerContext, options: LiveShellOptions<T>): Promise<LayerInstance> {
  const shell = new SurfaceShell(context.skyUniforms, options.shell);
  let texture: THREE.Texture | null = null;
  const watcher = new ProductWatcher(options.source, cacheStore(), {
    refreshMs: options.refreshMs,
    freshMs: options.freshMs,
    now: context.now,
    setStatus: context.setStatus,
    onProduct(product) {
      const previous = texture;
      texture = options.toTexture(product.value);
      shell.setTexture(texture);
      previous?.dispose();
    },
  });
  await watcher.start();
  context.earthRoot.add(shell.object);
  return {
    setVisible(visible) {
      shell.object.visible = visible;
    },
    update() {
      watcher.tick();
    },
    dispose() {
      watcher.stop();
      // Disposes of the texture it holds, too.
      shell.dispose();
    },
  };
}

function imageTexture(image: HTMLImageElement): THREE.Texture {
  return new THREE.Texture(image);
}

/**
 * Infrared brightness → cloud. The mosaic is bright where the emitting
 * surface is cold: high cloud tops are brightest, but so, less, is cold
 * ground. The threshold therefore rises toward the poles, where bare
 * ground is as cold as tropical mid-level cloud; what is left is white
 * with an opacity that follows the cloud-top cold.
 */
const CLOUD_SHADE = `
  float latitude = abs(asin(clamp(n.z, -1.0, 1.0)));
  float poleward = smoothstep(${(30 * DEG).toFixed(4)}, ${(62 * DEG).toFixed(4)}, latitude);
  float clear = mix(0.24, 0.55, poleward);
  float cloud = smoothstep(clear, clear + mix(0.42, 0.18, poleward), texel.r);
  // Past the polar circles ice is as cold as cloud and the satellites look
  // along the ground: the layer thins out there and ends where the mosaic does.
  float covered = 1.0 - smoothstep(${(63 * DEG).toFixed(4)}, ${((CLOUD_LATITUDE_LIMIT_DEG - 0.5) * DEG).toFixed(4)}, latitude);
  return vec4(vec3(1.0), cloud * covered);
`;

export function createCloudLayer(context: LayerContext): Promise<LayerInstance> {
  return createLiveShell(context, {
    source: cloudSource(context),
    shell: { name: 'clouds', altitudeM: 10_000, opacity: 0.9, renderOrder: WEATHER_ORDER.clouds, shadeGlsl: CLOUD_SHADE },
    toTexture: imageTexture,
    // Hourly product: look three times an hour so a new mosaic shows within 20 minutes.
    refreshMs: 20 * MINUTE_MS,
    freshMs: 4 * HOUR_MS,
  });
}

/**
 * The image is GIBS's own palette with dry pixels transparent black, so
 * dividing the filtered colour by the filtered alpha gives back the rain
 * colour at a cell's soft edge instead of a darkened one.
 */
const PRECIPITATION_SHADE = `
  if (texel.a < 0.02) return vec4(0.0);
  return vec4(texel.rgb / texel.a, smoothstep(0.02, 0.5, texel.a));
`;

export function createPrecipitationLayer(context: LayerContext): Promise<LayerInstance> {
  return createLiveShell(context, {
    source: precipitationSource(context),
    shell: {
      name: 'precipitation',
      // Under the cloud tops it falls from, over the ground it lands on.
      altitudeM: 5_000,
      opacity: 0.92,
      renderOrder: WEATHER_ORDER.precipitation,
      shadeGlsl: PRECIPITATION_SHADE,
    },
    toTexture: imageTexture,
    refreshMs: 15 * MINUTE_MS,
    // IMERG's early run trails real time by five to six hours.
    freshMs: 9 * HOUR_MS,
  });
}

/**
 * A field on the GFS grid has its points on the degree lines, pole to pole:
 * column 0 is 0°E and the rows include both poles. The shell's own
 * coordinate runs −180..180 with texels centred between lines, so the
 * sample point is moved half a turn round and scaled onto the 181 rows.
 */
const GFS_GRID_UV = `
  vec2 gridUv(vec2 uv) {
    return vec2(uv.x + 0.5 + 0.5 / ${GFS_NI}.0, (uv.y * ${GFS_NJ - 1}.0 + 0.5) / ${GFS_NJ}.0);
  }
`;

/** The grid as an RGBA texture through the temperature ramp: row 0 of the texture is 90°S. */
export function temperatureTexels(celsius: GfsGrid): Uint8Array {
  const texels = new Uint8Array(GFS_NI * GFS_NJ * 4);
  for (let j = 0; j < GFS_NJ; j++) {
    for (let i = 0; i < GFS_NI; i++) {
      const [r, g, b] = rampColor(TEMPERATURE_RAMP, celsius[j * GFS_NI + i]);
      texels.set([Math.round(r), Math.round(g), Math.round(b), 255], ((GFS_NJ - 1 - j) * GFS_NI + i) * 4);
    }
  }
  return texels;
}

export function createTemperatureLayer(context: LayerContext): Promise<LayerInstance> {
  return createLiveShell(context, {
    source: gfsFieldSource(context, 'temperature'),
    shell: {
      name: 'temperature',
      opacity: 0.8,
      renderOrder: WEATHER_ORDER.temperature,
      declarationsGlsl: GFS_GRID_UV,
      shadeGlsl: 'return texture2D(uMap, gridUv(uv));',
    },
    toTexture: ([celsius]) => new THREE.DataTexture(temperatureTexels(celsius), GFS_NI, GFS_NJ, THREE.RGBAFormat),
    refreshMs: 30 * MINUTE_MS,
    freshMs: 3 * HOUR_MS,
  });
}

/** Unit vector from the Earth's centre toward the Sun, ECEF. */
export function sunDirection(date: Date, target: THREE.Vector3): THREE.Vector3 {
  const { lat, lon } = subsolarPoint(date);
  const cosLat = Math.cos(lat * DEG);
  return target.set(cosLat * Math.cos(lon * DEG), cosLat * Math.sin(lon * DEG), Math.sin(lat * DEG));
}

/** "17.1°S 176.0°E" */
export function formatSubsolar(date: Date): string {
  const { lat, lon } = subsolarPoint(date);
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
}

/**
 * Night falls between the Sun 1° above the horizon and 12° below it - the
 * end of nautical twilight - so the terminator is the soft band it is from
 * orbit, not a line. The night side is the Black Marble image: dark land
 * and sea with the lights of towns, brightened to carry through the globe.
 */
const NIGHT_SHADE = `
  float night = smoothstep(${Math.sin(1 * DEG).toFixed(4)}, ${(-Math.sin(12 * DEG)).toFixed(4)}, dot(n, uSunDirection));
  float glow = max(texel.r, max(texel.g, texel.b));
  // Unlit ground stays dim; lit ground is lifted toward the sodium glow it has from orbit.
  vec3 lights = texel.rgb * mix(0.6, 1.0, smoothstep(0.25, 0.6, glow)) + vec3(1.0, 0.78, 0.45) * smoothstep(0.3, 0.95, glow);
  return vec4(min(lights, vec3(1.0)), night * mix(0.78, 1.0, smoothstep(0.3, 0.7, glow)));
`;

export const NIGHT_LIGHTS_ASSET = 'weather/night-lights.jpg';

export async function createNightSideLayer(context: LayerContext): Promise<LayerInstance> {
  const sun = new THREE.Vector3();
  const shell = new SurfaceShell(context.skyUniforms, {
    name: 'night-side',
    renderOrder: WEATHER_ORDER.nightSide,
    uniforms: { uSunDirection: { value: sunDirection(context.now(), sun) } },
    declarationsGlsl: 'uniform vec3 uSunDirection;',
    shadeGlsl: NIGHT_SHADE,
  });
  shell.setTexture(await new THREE.TextureLoader().loadAsync(context.assetUrl(NIGHT_LIGHTS_ASSET)));
  context.earthRoot.add(shell.object);
  let statusMinute = -1;
  const report = (date: Date): void => {
    const minute = Math.floor(date.getTime() / MINUTE_MS);
    if (minute === statusMinute) return;
    statusMinute = minute;
    context.setStatus(`sun over ${formatSubsolar(date)}`, 'info');
  };
  report(context.now());
  return {
    setVisible(visible) {
      shell.object.visible = visible;
    },
    update(frame) {
      sunDirection(frame.date, sun);
      report(frame.date);
    },
    dispose() {
      shell.dispose();
    },
  };
}
