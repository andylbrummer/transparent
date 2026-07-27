/**
 * UI shell components for Transparent Earth.
 * Plain DOM overlay — no external framework.
 */

export interface LayerState {
  readonly id: string;
  readonly label: string;
  readonly visible: boolean;
  readonly opacity: number; // 0-1
}

export type RenderMode = 'gyro' | 'ar' | 'vr';

export interface AppState {
  readonly layers: readonly LayerState[];
  readonly mode: RenderMode;
  readonly reducedMotion: boolean;
  readonly offlineLayers: readonly string[];
}

export const DEFAULT_LAYERS: LayerState[] = [
  { id: 'surface', label: 'Surface', visible: true, opacity: 1.0 },
  { id: 'crust', label: 'Crust', visible: true, opacity: 0.3 },
  { id: 'upperMantle', label: 'Upper Mantle', visible: true, opacity: 0.3 },
  { id: 'lowerMantle', label: 'Lower Mantle', visible: true, opacity: 0.5 },
  { id: 'outerCore', label: 'Outer Core', visible: true, opacity: 0.7 },
  { id: 'innerCore', label: 'Inner Core', visible: true, opacity: 0.9 },
  { id: 'graticule', label: 'Graticule', visible: false, opacity: 0.5 },
  { id: 'plateBoundaries', label: 'Plate Boundaries', visible: false, opacity: 0.8 },
  { id: 'cityLights', label: 'City Lights', visible: false, opacity: 0.6 },
];

export const DEFAULT_STATE: AppState = {
  layers: DEFAULT_LAYERS,
  mode: 'gyro',
  reducedMotion: false,
  offlineLayers: [],
};

/**
 * Toggle a layer's visibility.
 */
export function toggleLayer(state: AppState, layerId: string): AppState {
  return {
    ...state,
    layers: state.layers.map((l) =>
      l.id === layerId ? { ...l, visible: !l.visible } : l
    ),
  };
}

/**
 * Set a layer's opacity.
 */
export function setLayerOpacity(state: AppState, layerId: string, opacity: number): AppState {
  const clamped = Math.max(0, Math.min(1, opacity));
  return {
    ...state,
    layers: state.layers.map((l) =>
      l.id === layerId ? { ...l, opacity: clamped } : l
    ),
  };
}

/**
 * Probe available render modes.
 */
export async function probeCapabilities(): Promise<RenderMode[]> {
  const modes: RenderMode[] = ['gyro'];

  if (typeof navigator !== 'undefined' && navigator.xr) {
    try {
      const arSupported = await navigator.xr.isSessionSupported('immersive-ar');
      if (arSupported) modes.push('ar');
    } catch { /* ignore */ }

    try {
      const vrSupported = await navigator.xr.isSessionSupported('immersive-vr');
      if (vrSupported) modes.push('vr');
    } catch { /* ignore */ }
  }

  return modes;
}

/**
 * Mark a layer as offline (data source unavailable).
 */
export function setLayerOffline(state: AppState, layerId: string, offline: boolean): AppState {
  const offlineSet = new Set(state.offlineLayers);
  if (offline) {
    offlineSet.add(layerId);
  } else {
    offlineSet.delete(layerId);
  }
  return {
    ...state,
    offlineLayers: Array.from(offlineSet),
  };
}

/**
 * Check if a layer is currently offline.
 */
export function isLayerOffline(state: AppState, layerId: string): boolean {
  return state.offlineLayers.includes(layerId);
}
