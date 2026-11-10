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

export type ImageryStatus = 'loading' | 'ready' | 'failed';

/**
 * What the HUD says about the surface image, if anything. `status` is the
 * base map's (Blue Marble); `shown` is whether the globe has an image to
 * show at all. With another base map chosen and showing, the Blue Marble
 * failing behind it is not the user's problem: they are looking at a map.
 */
export function surfaceImageryNote(status: ImageryStatus, shown: boolean): string {
  return status === 'ready' || shown ? '' : ` · surface imagery ${status}`;
}
