/**
 * Weather overlay layers: CloudLayer and PrecipLayer.
 *
 * These are DOM-side constructs that consume the core TileStreamer
 * and render attribution chips.  No Three.js here — that lives in
 * the globe renderer which will read tile buffers from these layers.
 */

import {
  createTileStreamerState,
  type TileStreamerState,
  type TileProvider,
  type ProviderStatus,
} from '@transparent-earth/core/tiles';

export {
  createTileStreamerState,
  GIBS_CLOUD_PROVIDER,
  RAINVIEWER_PROVIDER,
} from '@transparent-earth/core/tiles';

export type {
  TileStreamerState,
  TileKey,
  ProviderStatus,
  TileState,
  TileLruCache,
  RetryPolicy,
} from '@transparent-earth/core/tiles';

/** Attribution text for a provider. */
export interface Attribution {
  readonly text: string;
  readonly url?: string;
}

/** A weather layer that streams tiles from a provider. */
export interface WeatherLayer {
  readonly name: string;
  readonly provider: TileProvider;
  readonly state: TileStreamerState;
  readonly visible: boolean;
  readonly altitudeKm: number; // elevation above surface shell
  readonly attribution: Attribution;
}

/** Create a cloud layer using the GIBS provider. */
export function createCloudLayer(
  provider: TileProvider,
  altitudeKm = 10
): WeatherLayer {
  return {
    name: 'clouds',
    provider,
    state: createTileStreamerState(provider),
    visible: true,
    altitudeKm,
    attribution: { text: provider.attribution, url: 'https://earthdata.nasa.gov' },
  };
}

/** Create a precipitation layer using the RainViewer provider. */
export function createPrecipLayer(
  provider: TileProvider,
  altitudeKm = 5
): WeatherLayer {
  return {
    name: 'precipitation',
    provider,
    state: createTileStreamerState(provider),
    visible: true,
    altitudeKm,
    attribution: { text: provider.attribution, url: 'https://www.rainviewer.com' },
  };
}

/** Toggle layer visibility. */
export function setLayerVisibility(layer: WeatherLayer, visible: boolean): WeatherLayer {
  return { ...layer, visible };
}

/** Set layer altitude (for legibility exaggeration toggle). */
export function setLayerAltitude(layer: WeatherLayer, altitudeKm: number): WeatherLayer {
  return { ...layer, altitudeKm };
}

/** Offline chip state for the UI. */
export interface OfflineChip {
  readonly label: string;
  readonly status: ProviderStatus;
  readonly offlineSince: number | null;
}

/** Build offline chips for all visible layers that are not fully online. */
export function buildOfflineChips(layers: readonly WeatherLayer[]): OfflineChip[] {
  return layers
    .filter((l) => l.visible && l.state.status !== 'online')
    .map((l) => ({
      label: l.name,
      status: l.state.status,
      offlineSince: l.state.offlineSince,
    }));
}

/** Build attribution strings for all visible layers. */
export function buildAttribution(layers: readonly WeatherLayer[]): string[] {
  return layers
    .filter((l) => l.visible)
    .map((l) => l.attribution.text);
}

/** Precipitation animation frame descriptor. */
export interface PrecipFrame {
  readonly timestamp: number; // Unix epoch seconds
  readonly tileTime: string;  // provider time placeholder value
}

/** Build a 2-hour precipitation loop (past 2h, 10-min steps). */
export function buildPrecipLoop(nowSec: number): PrecipFrame[] {
  const frames: PrecipFrame[] = [];
  const stepSec = 600; // 10 minutes
  const totalSteps = 12; // 2 hours = 12 * 10 min
  for (let i = 0; i < totalSteps; i++) {
    const ts = nowSec - (totalSteps - 1 - i) * stepSec;
    frames.push({ timestamp: ts, tileTime: String(ts) });
  }
  return frames;
}

/** Current animation state for the precip loop. */
export interface PrecipAnimationState {
  readonly frames: readonly PrecipFrame[];
  readonly currentIndex: number;
  readonly playing: boolean;
  readonly lastFrameTime: number; // ms
}

export const DEFAULT_PRECIP_ANIMATION: PrecipAnimationState = {
  frames: [],
  currentIndex: 0,
  playing: false,
  lastFrameTime: 0,
};

/** Advance the precip animation by wall time. */
export function tickPrecipAnimation(
  state: PrecipAnimationState,
  nowMs: number,
  frameIntervalMs = 500
): PrecipAnimationState {
  if (!state.playing || state.frames.length === 0) return state;

  const elapsed = nowMs - state.lastFrameTime;
  if (elapsed < frameIntervalMs) return state;

  const nextIndex = (state.currentIndex + 1) % state.frames.length;
  return {
    ...state,
    currentIndex: nextIndex,
    lastFrameTime: nowMs,
  };
}

/** Start or stop the precip animation. */
export function togglePrecipAnimation(state: PrecipAnimationState): PrecipAnimationState {
  return {
    ...state,
    playing: !state.playing,
    lastFrameTime: state.playing ? state.lastFrameTime : Date.now(),
  };
}

/** Get the current frame's tile time string for URL building. */
export function currentPrecipTime(state: PrecipAnimationState): string | null {
  if (state.frames.length === 0) return null;
  return state.frames[state.currentIndex].tileTime;
}

/** Weather manager holds all layers and animation state. */
export interface WeatherManager {
  readonly layers: readonly WeatherLayer[];
  readonly precipAnimation: PrecipAnimationState;
  readonly exaggeration: boolean; // +80 km legibility toggle
}

export const DEFAULT_WEATHER_MANAGER: WeatherManager = {
  layers: [],
  precipAnimation: DEFAULT_PRECIP_ANIMATION,
  exaggeration: false,
};

/** Add a layer to the manager. */
export function addLayer(manager: WeatherManager, layer: WeatherLayer): WeatherManager {
  return { ...manager, layers: [...manager.layers, layer] };
}

/** Remove a layer by name. */
export function removeLayer(manager: WeatherManager, name: string): WeatherManager {
  return { ...manager, layers: manager.layers.filter((l) => l.name !== name) };
}

/** Toggle the altitude exaggeration (true = +80 km, false = true altitude). */
export function toggleExaggeration(manager: WeatherManager): WeatherManager {
  const exaggeration = !manager.exaggeration;
  const baseAltitudes: Record<string, number> = {
    clouds: 10,
    precipitation: 5,
  };
  const layers = manager.layers.map((l) => {
    const base = baseAltitudes[l.name] ?? l.altitudeKm;
    const altitudeKm = exaggeration ? base + 80 : base;
    return { ...l, altitudeKm };
  });
  return { ...manager, layers, exaggeration };
}

/** Get all offline chips across the manager. */
export function getOfflineChips(manager: WeatherManager): OfflineChip[] {
  return buildOfflineChips(manager.layers);
}

/** Get all attribution strings across the manager. */
export function getAttribution(manager: WeatherManager): string[] {
  return buildAttribution(manager.layers);
}
