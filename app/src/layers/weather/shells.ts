/**
 * The weather layers that are an image draped on the planet: clouds, rain,
 * air temperature and the night side with its city lights.
 */

import * as THREE from 'three';
import { subsolarPoint } from '@transparent-earth/core';
import { RENDER_ORDER } from '../../render/order';
import { SurfaceShell, type SurfaceShellOptions } from '../../render/surface-shell';
import type { LayerContext, LayerInstance } from '../types';
import { geoColorSource } from './geostationary';
import { GFS_NI, GFS_NJ, type GfsGrid } from './gfs';
import { cacheStore, ProductWatcher, type ProductSource } from './live';
import { TEMPERATURE_RAMP, rampColor } from './ramps';
import { CLOUD_LATITUDE_LIMIT_DEG, cloudSource, gfsFieldSource, precipitationSource } from './sources';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DEG = Math.PI / 180;

/**
 * Draw order among the weather shells, all between the globe's surface and
 * the coastlines: temperature, clouds over it, rain over the clouds it
 * falls from, wind on top. The night side is under them all: the globe
 * shades it into the surface itself.
 */
export const WEATHER_ORDER = {
  earthNow: RENDER_ORDER.surfaceShell + 0.02,
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

/** Tile level of the "Earth right now" picture: 2560 px round the globe on a desk, 1280 on a phone or headset. */
export function earthNowLevel(coarsePointer: boolean): number {
  return coarsePointer ? 1 : 2;
}

/**
 * The Earth as GOES East and West see it now, on the surface itself, under
 * every other weather layer. Where neither satellite sees, the picture is
 * transparent and the base map shows.
 */
export function createEarthNowLayer(context: LayerContext): Promise<LayerInstance> {
  // A phone on mobile data fetches 1.3 MB a picture rather than 4.5.
  const level = earthNowLevel(window.matchMedia?.('(pointer: coarse)').matches ?? false);
  return createLiveShell(context, {
    source: geoColorSource(context, level),
    shell: { name: 'earth-now', renderOrder: WEATHER_ORDER.earthNow },
    toTexture: imageTexture,
    // A new picture every ten minutes; asking costs a few hundred bytes.
    refreshMs: 10 * MINUTE_MS,
    freshMs: HOUR_MS,
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

export const NIGHT_LIGHTS_ASSET = 'weather/night-lights.jpg';

/**
 * The night side with its city lights: the Black Marble image - dark land
 * and sea with the lights of towns - where the Sun is down. The globe
 * shades it into its own surface, so the interior in front of the night
 * hemisphere keeps its light.
 */
export async function createNightSideLayer(context: LayerContext): Promise<LayerInstance> {
  const texture = await new THREE.TextureLoader().loadAsync(context.assetUrl(NIGHT_LIGHTS_ASSET));
  const sun = context.globe.sunDirection;
  let statusMinute = -1;
  const report = (date: Date): void => {
    const minute = Math.floor(date.getTime() / MINUTE_MS);
    if (minute === statusMinute) return;
    statusMinute = minute;
    context.setStatus(`sun over ${formatSubsolar(date)}`, 'info');
  };
  sunDirection(context.now(), sun);
  report(context.now());
  return {
    setVisible(visible) {
      context.globe.setNightSide(visible ? texture : null);
    },
    update(frame) {
      sunDirection(frame.date, sun);
      report(frame.date);
    },
    dispose() {
      context.globe.setNightSide(null);
      texture.dispose();
    },
  };
}
