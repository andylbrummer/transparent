/**
 * A different map of the surface in place of Blue Marble: a whole-globe
 * image from NASA GIBS, handed to the globe as its surface override while
 * the layer's switch is on.
 *
 * Dated products go through the same live-then-fallback loading as the
 * weather (../weather/live.ts): the product's time domain says which date
 * exists, the last download is kept for offline use, and the chip names
 * the date shown. Only the night lights have a copy baked into the app;
 * the rest fail to an error chip and leave Blue Marble showing.
 */

import * as THREE from 'three';
import { DEFAULT_SURFACE_GAIN } from '../../render/globe';
import type { LayerContext, LayerInstance, StatusTone } from '../types';
import { GIBS_WMS, gibsDomainUrl, gibsTime, latestCompleteDay, latestInDomain, parseTimeDomain, wmsGlobeUrl } from '../weather/gibs';
import { cacheStore, decodeImage, fetchOk, type FetchLike, ProductWatcher, type ProductSource } from '../weather/live';

export interface ImagerySpec {
  /** GIBS layer identifier. */
  readonly product: string;
  /** JPEG for photographs; PNG for data products, which are transparent where they have no data. */
  readonly format: 'jpeg' | 'png';
  /** Pixels across; half as many down. 4096 is the globe's budget for a base map. */
  readonly width: 2048 | 4096;
  /**
   * Which date to ask for: null for a product with only one; a fixed date;
   * 'latest' for the newest the product has; 'complete-day' for the newest
   * day whose mosaic from an afternoon polar orbiter is whole.
   */
  readonly time: null | 'latest' | 'complete-day' | string;
  /**
   * Brightening on the globe. Absent: the globe's own default for a
   * photograph, none for a data product - its colours must match its legend.
   */
  readonly gain?: number;
  /**
   * Multiply the image by itself before use: dim tones fall away and bright
   * ones stay, which lifts city lights out of the moonlit ground around them.
   */
  readonly deepen?: boolean;
  /** A copy under app/public/ to fall back on. */
  readonly bakedAsset?: string;
}

/** A whole-globe 4096×2048 JPEG takes GIBS five or six seconds to compose. */
const IMAGERY_TIMEOUT_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** What shows where a data product has nothing: land under an ocean map, sea under a land map. */
const NO_DATA_COLOR = '#14171f';
/** A product with a single date has nothing to keep up with. */
const UNDATED = new Date(0);

export const isDated = (spec: ImagerySpec): boolean => spec.time === 'latest' || spec.time === 'complete-day';

export function imagerySource(
  spec: ImagerySpec,
  storeKey: string,
  assetUrl: (path: string) => string,
  decode: (blob: Blob) => Promise<TexImageSource>,
  fetchImpl?: FetchLike
): ProductSource<TexImageSource> {
  return {
    storeKey,
    async latest(now) {
      if (!isDated(spec)) return { tag: spec.time ?? 'undated', validTime: UNDATED };
      const response = await fetchOk(gibsDomainUrl(spec.product), {}, undefined, fetchImpl);
      const at = spec.time === 'complete-day' ? latestCompleteDay(now) : now;
      const latest = latestInDomain(parseTimeDomain(await response.text()), at);
      if (!latest) throw new Error(`${spec.product} has nothing at or before ${at.toISOString()}`);
      return { tag: gibsTime(latest.time, latest.daily), validTime: latest.time };
    },
    async download(tag) {
      const url = wmsGlobeUrl(GIBS_WMS, spec.product, {
        width: spec.width,
        height: spec.width / 2,
        format: spec.format,
        time: spec.time === null ? undefined : tag,
      });
      return (await fetchOk(url, {}, IMAGERY_TIMEOUT_MS, fetchImpl)).blob();
    },
    decode,
    async snapshot() {
      if (!spec.bakedAsset) throw new Error(`${spec.product} has no baked copy`);
      const blob = await (await fetchOk(assetUrl(spec.bakedAsset), {}, undefined, fetchImpl)).blob();
      return { value: await decode(blob), validTime: UNDATED };
    },
  };
}

/**
 * The image as the globe should show it. A data product goes over a neutral
 * ground, so that "no data" is not the black of deep space; a product to be
 * deepened is drawn twice, the second time multiplying the first. Both are
 * canvas compositing, done by the browser without a pixel loop here.
 */
async function decodeFor(spec: ImagerySpec, blob: Blob): Promise<TexImageSource> {
  const image = await decodeImage(blob);
  if (spec.format !== 'png' && !spec.deepen) return image;
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2D canvas to compose the image on');
  context.fillStyle = NO_DATA_COLOR;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  if (spec.deepen) {
    context.globalCompositeOperation = 'multiply';
    context.drawImage(image, 0, 0);
  }
  return canvas;
}

/** The chip for an undated product: nothing when it is the real thing, the truth when it is not. */
export function undatedStatus(text: string | null): { text: string | null; tone: StatusTone } {
  if (text?.startsWith('offline · snapshot')) return { text: 'offline · low-resolution copy', tone: 'stale' };
  if (text?.startsWith('offline')) return { text: 'offline · cached', tone: 'stale' };
  return { text: null, tone: 'info' };
}

/**
 * Which imagery layer the globe is showing. Switching from one to another
 * turns the new one on and the old one off in no fixed order: an old layer
 * going off must not clear the override a new one has just set.
 */
let showing: string | null = null;

export async function createImageryLayer(context: LayerContext, id: string, spec: ImagerySpec): Promise<LayerInstance> {
  let texture: THREE.Texture | null = null;
  let visible = false;
  const gain = spec.gain ?? (spec.format === 'png' ? 1 : DEFAULT_SURFACE_GAIN);
  const apply = (): void => {
    if (visible && texture) {
      context.globe.setSurfaceOverride(texture, gain);
      showing = id;
    } else if (showing === id) {
      context.globe.setSurfaceOverride(null);
      showing = null;
    }
  };
  const watcher = new ProductWatcher(
    imagerySource(spec, id, context.assetUrl, (blob) => decodeFor(spec, blob)),
    cacheStore('transparent-earth-imagery-v1'),
    {
      // Daily products at most: an hourly look finds the new day soon enough.
      refreshMs: HOUR_MS,
      // Composites run up to 16 days and are published days after they close.
      freshMs: 40 * DAY_MS,
      daily: true,
      now: context.now,
      setStatus(text, tone) {
        if (isDated(spec)) context.setStatus(text, tone);
        else context.setStatus(undatedStatus(text).text, undatedStatus(text).tone);
      },
      onProduct(product) {
        const previous = texture;
        const next = product.value instanceof HTMLCanvasElement ? new THREE.CanvasTexture(product.value) : new THREE.Texture(product.value);
        texture = next;
        apply();
        // After the globe has let go of it.
        previous?.dispose();
      },
    }
  );
  await watcher.start();
  return {
    setVisible(next) {
      visible = next;
      apply();
    },
    update() {
      if (isDated(spec)) watcher.tick();
    },
    dispose() {
      watcher.stop();
      visible = false;
      apply();
      texture?.dispose();
    },
  };
}
