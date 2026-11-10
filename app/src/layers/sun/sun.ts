/**
 * The Sun layers: the Sun itself (a glow at its true place that resolves,
 * zoomed in, into the live white-light disc with today's sunspots), live
 * extreme-ultraviolet images of its atmosphere on the disc, and live
 * coronagraph images around it at their true extent on the sky.
 */

import { RENDER_ORDER } from '../../render/order';
import { SkyPoints } from '../../render/sky-points';
import type { FrameState, LayerContext, LayerInstance, StatusTone } from '../types';
import { ProductFeed, frameStatus } from './feed';
import { MovingLabel, labelDropPx } from './moving-label';
import { PRODUCTS, type ProductId } from './products';
import { computeSunState, type SunState } from './solar-frame';
import { SunImageQuad, type SunImageOptions } from './sun-image';

/** Draw order within the sky: corona, then the Sun's glow, its disc, and an EUV image over that. The Moon follows all. */
export const SUN_RENDER_ORDER = {
  corona: RENDER_ORDER.sky + 0.01,
  glow: RENDER_ORDER.sky + 0.02,
  disc: RENDER_ORDER.sky + 0.03,
  euv: RENDER_ORDER.sky + 0.04,
} as const;

/** The Sun moves a disc-width in 12 hours: recomputing its place twice a second is already generous. */
const EPHEMERIS_INTERVAL_MS = 500;

/** Calls `apply` with the Sun's state when the app clock has moved on enough since the last call. */
export class SunClock {
  private lastMs = NaN;
  private state: SunState | null = null;

  update(date: Date, apply: (sun: SunState) => void): SunState {
    const ms = date.getTime();
    if (this.state === null || !(Math.abs(ms - this.lastMs) < EPHEMERIS_INTERVAL_MS)) {
      this.lastMs = ms;
      this.state = computeSunState(date);
      apply(this.state);
    }
    return this.state;
  }
}

/** The Sun's diameter on screen, CSS px, for a view `fovDeg` tall drawn `heightCss` px tall. */
export function discPixels(angularRadius: number, fovDeg: number, heightCss: number): number {
  return ((2 * angularRadius) / ((fovDeg * Math.PI) / 180)) * heightCss;
}

interface ImagePart {
  readonly quad: SunImageQuad;
  readonly feed: ProductFeed;
}

/**
 * The common body of the image layers: one or more product panels kept
 * on the Sun and kept current, and a chip that tells the oldest frame's story.
 */
class SunImages {
  readonly parts: ImagePart[] = [];
  private readonly clock = new SunClock();

  constructor(
    private readonly context: LayerContext,
    specs: readonly { id: ProductId; options: SunImageOptions }[]
  ) {
    for (const spec of specs) {
      const product = PRODUCTS[spec.id];
      const quad = new SunImageQuad(product, context.skyUniforms, spec.options);
      context.skyRoot.add(quad.object);
      const feed = new ProductFeed(context, product, (frame) => {
        quad.setTexture(frame.texture);
        this.reportStatus();
      });
      this.parts.push({ quad, feed });
    }
  }

  /**
   * Ask for the first frames. Not awaited by the layers: the Sun's place
   * is known at once and must not wait on a slow or absent network.
   */
  start(): void {
    for (const part of this.parts) void part.feed.refresh();
  }

  update(frame: FrameState): SunState {
    const wallMs = performance.now();
    for (const part of this.parts) part.feed.tick(wallMs);
    return this.clock.update(frame.date, (sun) => {
      for (const part of this.parts) part.quad.place(sun);
    });
  }

  setVisible(visible: boolean): void {
    for (const part of this.parts) part.quad.object.visible = visible;
  }

  private reportStatus(): void {
    const nowMs = this.context.now().getTime();
    const rank: Readonly<Record<StatusTone, number>> = { live: 0, info: 1, stale: 2, error: 3 };
    let worst: { text: string; tone: StatusTone } | null = null;
    for (const part of this.parts) {
      const shown = part.feed.current();
      if (!shown) continue;
      const status = frameStatus(shown, nowMs);
      if (worst === null || rank[status.tone] > rank[worst.tone]) worst = status;
    }
    if (worst) this.context.setStatus(worst.text, worst.tone);
  }

  dispose(): void {
    for (const part of this.parts) {
      part.feed.dispose();
      part.quad.dispose();
    }
  }
}

/** The glow that stands for the Sun while its disc is only a few pixels wide: CSS px. */
const GLOW_SIZE_PX = 44;
/** The glow gives way to the real disc as that grows from the first to the second size, CSS px. */
const GLOW_FADE_PX: readonly [number, number] = [14, 44];

/** The Sun's name sits at least this far under its centre, clear of the glow: CSS px. */
export const SUN_LABEL_MIN_DROP_PX = 20;

export function glowOpacity(discPx: number): number {
  const t = (discPx - GLOW_FADE_PX[0]) / (GLOW_FADE_PX[1] - GLOW_FADE_PX[0]);
  return 1 - Math.max(0, Math.min(1, t));
}

export function createSunLayer(context: LayerContext): LayerInstance {
  const images = new SunImages(context, [
    // The continuum image is grey; sunlight is white with a little warmth.
    // Its disc centre sits near 0.68 of full scale: lifted so the Sun is the brightest thing in the sky.
    { id: 'hmi', options: { name: 'sun-disc', renderOrder: SUN_RENDER_ORDER.disc, tint: 0xfff4dc, gain: 1.45 } },
  ]);
  const glow = new SkyPoints(
    new Float32Array(3),
    new Float32Array([GLOW_SIZE_PX]),
    new Float32Array([1, 0.95, 0.8]),
    context.skyUniforms,
    { name: 'sun-glow', renderOrder: SUN_RENDER_ORDER.glow }
  );
  context.skyRoot.add(glow.object);
  // Ahead of the planets and the stars: there is one Sun.
  const label = new MovingLabel(context, 6.3, { fontPx: 12, color: '#ffe9b0', bold: true });
  let heightCss = window.innerHeight;
  let placed: SunState | null = null;
  images.start();
  return {
    setVisible(visible) {
      images.setVisible(visible);
      glow.object.visible = visible;
      label.setVisible(visible);
    },
    setResolution(_widthCss, height) {
      heightCss = height;
    },
    update(frame) {
      const sun = images.update(frame);
      // The clock hands back the same state until it recomputes: only then has the Sun moved.
      if (sun !== placed) {
        placed = sun;
        label.position.set(sun.direction[0], sun.direction[1], sun.direction[2]);
        glow.positions.setXYZ(0, sun.direction[0], sun.direction[1], sun.direction[2]);
        glow.positions.needsUpdate = true;
      }
      const discPx = discPixels(sun.angularRadius, frame.camera.fov, heightCss);
      label.set('Sun', labelDropPx(discPx, SUN_LABEL_MIN_DROP_PX));
      glow.setOpacity(glowOpacity(discPx));
    },
    dispose() {
      images.dispose();
      glow.dispose();
      label.dispose();
    },
  };
}

function imageLayer(images: SunImages): LayerInstance {
  return {
    setVisible: (visible) => images.setVisible(visible),
    update: (frame) => {
      images.update(frame);
    },
    dispose: () => images.dispose(),
  };
}

export function createEuvLayer(context: LayerContext, id: 'suvi-171' | 'suvi-195' | 'suvi-304'): LayerInstance {
  const images = new SunImages(context, [{ id, options: { name: `sun-${id}`, renderOrder: SUN_RENDER_ORDER.euv } }]);
  images.start();
  return imageLayer(images);
}

export function createLascoLayer(context: LayerContext): LayerInstance {
  // Both are white-light instruments shown through false-colour tables: draw them as the pearly corona they record,
  // C2 a shade warmer so the join at 5.7 solar radii can be told.
  const images = new SunImages(context, [
    { id: 'lasco-c3', options: { name: 'sun-lasco-c3', renderOrder: SUN_RENDER_ORDER.corona, tint: 0xc8dcff, gain: 0.8 } },
    { id: 'lasco-c2', options: { name: 'sun-lasco-c2', renderOrder: SUN_RENDER_ORDER.corona, tint: 0xffe6c8, gain: 1.3 } },
  ]);
  images.start();
  return imageLayer(images);
}

export function createCcorLayer(context: LayerContext): LayerInstance {
  const images = new SunImages(context, [
    { id: 'ccor1', options: { name: 'sun-ccor1', renderOrder: SUN_RENDER_ORDER.corona, gain: 0.8 } },
  ]);
  images.start();
  return imageLayer(images);
}
