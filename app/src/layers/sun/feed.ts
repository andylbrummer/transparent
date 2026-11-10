/**
 * Keeps one solar image product current: asks NOAA SWPC which frames it
 * has, takes the one nearest the app clock, and falls back to the baked
 * snapshot - saying so - when the network does not answer.
 *
 * SWPC serves a rolling day of frames and asks nothing more than ordinary
 * HTTP caching (max-age 60 s). Frames are immutable under their URL, so
 * the browser's own cache is the cache; an index is asked for at most
 * every few minutes, and only while the layer is switched on.
 */

import * as THREE from 'three';
import type { LayerContext, StatusTone } from '../types';
import { LIVE_WINDOW_MS, formatImageDate, formatImageTime, nearestFrame, parseFrameIndex, SWPC_BASE, type Product } from './products';

/** How often an index is re-read. The fastest product (SUVI) adds a frame every 4 minutes. */
export const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const INDEX_TIMEOUT_MS = 12000;
const IMAGE_TIMEOUT_MS = 25000;

/** app/public/sky/sun/snapshot.json, written by tools/pipeline/generate_sun_snapshot.py. */
export interface SunSnapshot {
  /** Observation time (ISO 8601) of each baked frame, by product id. */
  readonly frames: Readonly<Record<string, { readonly time: string }>>;
  /** The solar_regions.json rows of the snapshot's day, as SWPC gave them. */
  readonly regions: readonly unknown[];
  readonly spaceWeather: {
    readonly xrayClass: string | null;
    readonly f107: number | null;
    readonly windKmS: number | null;
    readonly sunspotNumber: number | null;
    readonly sunspotDate: string | null;
    readonly time: string;
  };
}

let snapshotPromise: Promise<SunSnapshot> | null = null;

/** The baked snapshot's manifest, fetched once for all Sun layers. */
export function loadSnapshot(context: LayerContext): Promise<SunSnapshot> {
  snapshotPromise ??= context.fetchJson<SunSnapshot>(context.assetUrl('sky/sun/snapshot.json')).catch((error: unknown) => {
    snapshotPromise = null;
    throw error;
  });
  return snapshotPromise;
}

/** An AbortSignal that fires after `ms`, with the timer's cancel. */
export function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function loadTexture(url: string, timeoutMs: number): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${url}: timed out`)), timeoutMs);
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        clearTimeout(timer);
        resolve(texture);
      },
      undefined,
      () => {
        clearTimeout(timer);
        reject(new Error(`${url}: failed to load`));
      }
    );
  });
}

export interface ShownFrame {
  readonly texture: THREE.Texture;
  readonly timeMs: number;
  /** From SWPC just now, as opposed to the baked snapshot. */
  readonly fromNetwork: boolean;
}

/** The chip for a frame: live with its time, or stale and why. */
export function frameStatus(frame: Pick<ShownFrame, 'timeMs' | 'fromNetwork'>, nowMs: number): { text: string; tone: StatusTone } {
  if (!frame.fromNetwork) return { text: `offline · snapshot ${formatImageDate(frame.timeMs)}`, tone: 'stale' };
  if (Math.abs(frame.timeMs - nowMs) > LIVE_WINDOW_MS) return { text: `image of ${formatImageTime(frame.timeMs)}`, tone: 'stale' };
  return { text: `live · ${formatImageTime(frame.timeMs)}`, tone: 'live' };
}

export class ProductFeed {
  private shownUrl: string | null = null;
  private shown: { timeMs: number; fromNetwork: boolean } | null = null;
  private busy = false;
  private disposed = false;
  private lastCheck = -Infinity;

  /** `onFrame` receives each new frame's texture and owns it from then on. */
  constructor(
    private readonly context: LayerContext,
    private readonly product: Product,
    private readonly onFrame: (frame: ShownFrame) => void
  ) {}

  /** What is on screen now, for the status chip; null before the first frame. */
  current(): { timeMs: number; fromNetwork: boolean } | null {
    return this.shown;
  }

  /** Call every frame while visible: re-reads the index when it is due. `wallMs` is a monotonic clock. */
  tick(wallMs: number): void {
    if (wallMs - this.lastCheck < REFRESH_INTERVAL_MS) return;
    this.lastCheck = wallMs;
    void this.refresh();
  }

  /** Fetch the newest suitable frame; on failure show the snapshot unless a frame is already up. */
  async refresh(): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      const { signal, cancel } = timeoutSignal(INDEX_TIMEOUT_MS);
      let index: unknown;
      try {
        index = await this.context.fetchJson<unknown>(SWPC_BASE + this.product.indexPath, { signal });
      } finally {
        cancel();
      }
      const frame = nearestFrame(parseFrameIndex(index), this.context.now().getTime());
      if (!frame) throw new Error(`${this.product.id}: empty frame index`);
      if (frame.url !== this.shownUrl) {
        const texture = await loadTexture(frame.url, IMAGE_TIMEOUT_MS);
        this.show(texture, frame.url, frame.timeMs, true);
      }
    } catch (error) {
      // A frame already showing stays: an old real image beats a baked one.
      if (this.shown === null) await this.showSnapshot(error);
    } finally {
      this.busy = false;
    }
  }

  private async showSnapshot(cause: unknown): Promise<void> {
    console.error(`${this.product.id}: live image unavailable, using the baked snapshot`, cause);
    try {
      const snapshot = await loadSnapshot(this.context);
      const baked = snapshot.frames[this.product.id];
      const url = this.context.assetUrl(this.product.snapshotPath);
      const texture = await loadTexture(url, IMAGE_TIMEOUT_MS);
      this.show(texture, url, Date.parse(baked.time), false);
    } catch (error) {
      console.error(`${this.product.id}: snapshot unavailable too`, error);
      if (!this.disposed) this.context.setStatus('unavailable', 'error');
    }
  }

  private show(texture: THREE.Texture, url: string, timeMs: number, fromNetwork: boolean): void {
    if (this.disposed) {
      texture.dispose();
      return;
    }
    this.shownUrl = url;
    this.shown = { timeMs, fromNetwork };
    this.onFrame({ texture, timeMs, fromNetwork });
  }

  dispose(): void {
    this.disposed = true;
  }
}
