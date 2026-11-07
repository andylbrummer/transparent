/**
 * UI shell components for Transparent Earth.
 * Plain DOM overlay — no external framework.
 */

export type RenderMode = 'gyro' | 'ar' | 'vr';

export interface AppState {
  readonly mode: RenderMode;
  readonly reducedMotion: boolean;
}

export const DEFAULT_STATE: AppState = {
  mode: 'gyro',
  reducedMotion: false,
};

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
