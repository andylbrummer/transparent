/**
 * A measurement draped over the surface: a whole-globe image from NASA
 * GIBS on a shell at ground level, above whatever map of the surface is
 * showing and below the coastlines, so the far side keeps its bearings.
 *
 * Loading is the surface-imagery layers' (../surface-imagery/imagery.ts):
 * the product's time domain says which date exists, the last download is
 * kept for offline use, and the chip names the date shown. What differs is
 * where the picture goes - a shell of its own, not the globe's base map -
 * and which date is asked for: monthly means and the day before the newest
 * are dated here.
 */

import * as THREE from 'three';
import { RENDER_ORDER } from '../../render/order';
import { SurfaceShell } from '../../render/surface-shell';
import { imagerySource, undatedStatus, type ImagerySpec } from '../surface-imagery/imagery';
import type { LayerContext, LayerInstance, StatusTone } from '../types';
import { gibsDomainUrl, gibsTime, latestInDomain, parseTimeDomain } from '../weather/gibs';
import { cacheStore, decodeImage, fetchOk, type FetchLike, ProductWatcher, type ProductSource } from '../weather/live';

export interface OverlaySpec {
  /** GIBS layer identifier. */
  readonly product: string;
  /**
   * Which date to ask for: null for a product with only one; 'latest' for
   * the newest the product has; 'complete-day' for the newest day a polar
   * orbiter has finished flying.
   */
  readonly time: null | 'latest' | 'complete-day';
  /**
   * Step this many days back from the product's newest date. A swath
   * product's newest day is listed while its orbits are still arriving.
   */
  readonly lagDays?: number;
  /** How the product is dated: decides what the chip says. */
  readonly cadence: 'daily' | 'monthly' | 'fixed';
  /** Pixels across; default 2048. Point data wants the globe's full 4096. */
  readonly width?: 2048 | 4096;
  /**
   * How the image is drawn: as GIBS coloured it (default); the same colours
   * but thin where the palette is pale, for a field that covers the whole
   * globe; as small marks made to carry; or snow in white.
   */
  readonly shade?: 'palette' | 'fade-low' | 'points' | 'snow';
  /** A copy under app/public/ to fall back on. */
  readonly bakedAsset?: string;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Over the night side and under the air temperature, clouds and rain (../weather/shells.ts). */
const OVERLAY_ORDER = RENDER_ORDER.surfaceShell + 0.03;

export function overlayImagerySpec(spec: OverlaySpec): ImagerySpec {
  return { product: spec.product, format: 'png', width: spec.width ?? 2048, time: spec.time, bakedAsset: spec.bakedAsset };
}

/**
 * The surface-imagery source for the product, with the date moved back by
 * `lagDays` from the newest the product has - and never onto a day missing
 * from its domain: the domain is asked again for the newest day at or
 * before the one wanted.
 */
export function overlaySource(
  spec: OverlaySpec,
  storeKey: string,
  assetUrl: (path: string) => string,
  decode: (blob: Blob) => Promise<TexImageSource>,
  fetchImpl?: FetchLike
): ProductSource<TexImageSource> {
  const source = imagerySource(overlayImagerySpec(spec), storeKey, assetUrl, decode, fetchImpl);
  const lagDays = spec.lagDays ?? 0;
  if (spec.time === null || lagDays === 0) return source;
  return {
    ...source,
    async latest(now) {
      const periods = parseTimeDomain(await (await fetchOk(gibsDomainUrl(spec.product), {}, undefined, fetchImpl)).text());
      const newest = latestInDomain(periods, now);
      const wanted = newest && latestInDomain(periods, new Date(newest.time.getTime() - lagDays * DAY_MS));
      if (!wanted) throw new Error(`${spec.product} has nothing ${lagDays} d before its newest at ${now.toISOString()}`);
      return { tag: gibsTime(wanted.time, wanted.daily), validTime: wanted.time };
    },
  };
}

/**
 * The chip for an overlay. A day is shown as the watcher words it. A
 * monthly mean is named by its month and never called live: it is months
 * old by the time it is published. A product with one date says nothing
 * unless it is the baked copy.
 */
export function overlayStatus(text: string | null, tone: StatusTone, cadence: OverlaySpec['cadence']): { text: string | null; tone: StatusTone } {
  if (cadence === 'fixed') return undatedStatus(text);
  if (cadence === 'daily' || text === null) return { text, tone };
  const month = text.replace(/\b1 ([A-Z][a-z]{2} \d{4})\b/, '$1');
  const fetched = /^(live|latest) · /.exec(month);
  if (!fetched) return { text: month, tone };
  return { text: `mean of ${month.slice(fetched[0].length)}`, tone: 'info' };
}

/**
 * GIBS leaves "no data" transparent black, and the texture is filtered:
 * dividing the colour by the alpha gives back the palette colour at an
 * edge instead of a darkened one (as for rain, ../weather/shells.ts).
 */
const PALETTE_SHADE = `
  if (texel.a < 0.02) return vec4(0.0);
  return vec4(texel.rgb / texel.a, smoothstep(0.02, 0.5, texel.a));
`;

/**
 * For palettes that start near white and darken with the value, over a
 * field with no gaps: the palette's colours, but the pale low end let
 * through, so the map underneath shows wherever there is little to report.
 */
const FADE_LOW_SHADE = `
  if (texel.a < 0.02) return vec4(0.0);
  vec3 c = texel.rgb / texel.a;
  float depth = 1.0 - min(c.r, min(c.g, c.b));
  return vec4(c, mix(0.14, 1.0, smoothstep(0.2, 0.7, depth)) * smoothstep(0.02, 0.5, texel.a));
`;

/** Marks a texel or two across: any coverage at all shows at full strength, or they vanish at this distance. */
const POINTS_SHADE = `
  if (texel.a < 0.01) return vec4(0.0);
  return vec4(texel.rgb / texel.a, smoothstep(0.01, 0.12, texel.a));
`;

/**
 * GIBS draws snow cover from yellow (1 %) to red (100 %), its green channel
 * falling in steps from 240 to about 125 and to 0 at 100 %. Read back from
 * that channel and redrawn from blue-grey to white, thin cover fainter.
 */
const SNOW_SHADE = `
  if (texel.a < 0.02) return vec4(0.0);
  vec3 c = texel.rgb / texel.a;
  // 0 % is drawn pure green: not snow.
  if (c.r < 0.5) return vec4(0.0);
  float snow = clamp((0.96 - c.g) / 0.47, 0.0, 1.0);
  return vec4(mix(vec3(0.55, 0.68, 0.85), vec3(1.0), snow), mix(0.6, 1.0, snow) * smoothstep(0.02, 0.5, texel.a));
`;

const SHADES: Readonly<Record<NonNullable<OverlaySpec['shade']>, string>> = {
  palette: PALETTE_SHADE,
  'fade-low': FADE_LOW_SHADE,
  points: POINTS_SHADE,
  snow: SNOW_SHADE,
};

/** A whole-globe PNG of a data product takes GIBS up to half a minute to compose. */
const REFRESH_MS = HOUR_MS;

export async function createOverlayLayer(context: LayerContext, id: string, spec: OverlaySpec): Promise<LayerInstance> {
  const shell = new SurfaceShell(context.skyUniforms, {
    name: id,
    opacity: spec.shade === 'points' ? 1 : 0.88,
    renderOrder: OVERLAY_ORDER,
    shadeGlsl: SHADES[spec.shade ?? 'palette'],
  });
  let texture: THREE.Texture | null = null;
  const watcher = new ProductWatcher(
    overlaySource(spec, id, context.assetUrl, decodeImage),
    cacheStore('transparent-earth-overlays-v1'),
    {
      refreshMs: REFRESH_MS,
      // A monthly mean arrives one to three months after its month; a day, within the week.
      freshMs: spec.cadence === 'monthly' ? 150 * DAY_MS : 10 * DAY_MS,
      daily: true,
      now: context.now,
      setStatus(text, tone = 'info') {
        const status = overlayStatus(text, tone, spec.cadence);
        context.setStatus(status.text, status.tone);
      },
      onProduct(product) {
        const previous = texture;
        texture = new THREE.Texture(product.value as HTMLImageElement);
        shell.setTexture(texture);
        previous?.dispose();
      },
    }
  );
  await watcher.start();
  context.earthRoot.add(shell.object);
  return {
    setVisible(visible) {
      shell.object.visible = visible;
    },
    update() {
      if (spec.time !== null) watcher.tick();
    },
    dispose() {
      watcher.stop();
      // Disposes of the texture it holds, too.
      shell.dispose();
    },
  };
}
