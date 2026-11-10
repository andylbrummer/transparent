/**
 * What NOAA's Space Weather Prediction Center reports about the Sun right
 * now, written on the Sun: the numbered active regions at their places on
 * the disc, and under it the X-ray level, sunspot number, radio flux and
 * solar wind speed.
 *
 * A region is reported once a day by heliographic latitude and Carrington
 * longitude - coordinates fixed to the turning Sun - so it is placed for
 * the app clock's instant, not the report's: it rides the rotation across
 * the disc and drops out when it passes the limb.
 */

import * as THREE from 'three';
import type { GroupLabel, LabelGroup } from '../../render/labels';
import type { LayerContext, LayerInstance } from '../types';
import { loadSnapshot, timeoutSignal } from './feed';
import { MovingLabel, labelDropPx } from './moving-label';
import {
  LIVE_WINDOW_MS,
  SWPC_BASE,
  activeRegionLabel,
  formatImageDate,
  formatImageTime,
  latestActiveRegions,
  parseDailySolarIndices,
  spaceWeatherSummary,
  type ActiveRegion,
  type SpaceWeather,
} from './products';
import { surfacePointOnSky } from './solar-frame';
import { SUN_LABEL_MIN_DROP_PX, SunClock, discPixels } from './sun';

/** Regions are reported daily and the indices change slowly: every ten minutes is plenty. */
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12000;
/** Region names appear once the disc is this wide on screen, CSS px: below it they would pile on one spot. */
const REGION_LABELS_MIN_DISC_PX = 40;
/** Line spacing between the Sun's name and the readings under it, CSS px. */
const SUMMARY_LINE_PX = 20;

interface ActivityData {
  readonly regions: readonly ActiveRegion[];
  readonly weather: SpaceWeather;
  readonly fromNetwork: boolean;
}

async function fetchJsonWithTimeout(context: LayerContext, path: string): Promise<unknown> {
  const { signal, cancel } = timeoutSignal(FETCH_TIMEOUT_MS);
  try {
    return await context.fetchJson<unknown>(SWPC_BASE + path, { signal });
  } finally {
    cancel();
  }
}

async function fetchTextWithTimeout(path: string): Promise<string> {
  const { signal, cancel } = timeoutSignal(FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(SWPC_BASE + path, { signal });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return await response.text();
  } finally {
    cancel();
  }
}

function firstRow(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) && value.length > 0 ? (value[0] as Record<string, unknown>) : null;
}

/** A reading's time tag as ms, or null. SWPC writes some without the Z; all are UTC. */
function timeTagMs(row: Record<string, unknown> | null): number | null {
  const tag = row?.time_tag;
  if (typeof tag !== 'string') return null;
  const ms = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(tag) ? tag : `${tag}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The live numbers. The regions are the one feed the layer cannot do
 * without; each of the others may fail alone and is then just left out.
 */
async function fetchLive(context: LayerContext): Promise<ActivityData> {
  const optional = <T>(promise: Promise<T>): Promise<T | null> => promise.catch(() => null);
  const [report, flares, flux, wind, indices] = await Promise.all([
    fetchJsonWithTimeout(context, '/json/solar_regions.json'),
    optional(fetchJsonWithTimeout(context, '/json/goes/primary/xray-flares-latest.json')),
    optional(fetchJsonWithTimeout(context, '/products/summary/10cm-flux.json')),
    optional(fetchJsonWithTimeout(context, '/products/summary/solar-wind-speed.json')),
    optional(fetchTextWithTimeout('/text/daily-solar-indices.txt')),
  ]);
  const flare = firstRow(flares);
  const fluxRow = firstRow(flux);
  const windRow = firstRow(wind);
  const daily = indices === null ? null : parseDailySolarIndices(indices);
  const times = [timeTagMs(flare), timeTagMs(fluxRow), timeTagMs(windRow)].filter((t): t is number => t !== null);
  return {
    regions: latestActiveRegions(report),
    weather: {
      xrayClass: typeof flare?.current_class === 'string' ? flare.current_class : null,
      f107: typeof fluxRow?.flux === 'number' ? fluxRow.flux : null,
      windKmS: typeof windRow?.proton_speed === 'number' ? windRow.proton_speed : null,
      sunspotNumber: daily?.sunspotNumber ?? null,
      sunspotDate: daily?.date ?? null,
      timeMs: times.length > 0 ? Math.max(...times) : null,
    },
    fromNetwork: true,
  };
}

async function fetchBaked(context: LayerContext): Promise<ActivityData> {
  const snapshot = await loadSnapshot(context);
  const { time, ...weather } = snapshot.spaceWeather;
  return {
    regions: latestActiveRegions(snapshot.regions),
    weather: { ...weather, timeMs: Date.parse(time) },
    fromNetwork: false,
  };
}

/** When the regions were observed: the end of their report's UT day. */
function regionsTimeMs(regions: readonly ActiveRegion[]): number | null {
  if (regions.length === 0) return null;
  const ms = Date.parse(`${regions[0].observedDate}T24:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

export function createActivityLayer(context: LayerContext): LayerInstance {
  const clock = new SunClock();
  let data: ActivityData | null = null;
  let regionPositions: THREE.Vector3[] = [];
  let regionLabels: LabelGroup | null = null;
  const summaryLabel = new MovingLabel(context, 6.31, { fontPx: 10, color: '#ffd08a' });
  let summaryText = '';
  let visible = false;
  let regionsShown = false;
  let placed = false;
  let heightCss = window.innerHeight;
  let lastCheck = -Infinity;
  let busy = false;
  let disposed = false;

  function applyVisibility(): void {
    regionLabels?.setVisible(visible && regionsShown);
    summaryLabel.setVisible(visible);
  }

  function rebuildLabels(): void {
    regionLabels?.remove();
    regionLabels = null;
    if (!data) return;
    regionPositions = data.regions.map(() => new THREE.Vector3());
    placed = false;
    const labels: GroupLabel[] = data.regions.map((region, i) => ({
      text: activeRegionLabel(region),
      // The largest spot groups first.
      priority: -(region.area ?? 0),
      position: regionPositions[i],
    }));
    regionLabels = context.addLabels({
      rank: 6.32,
      // White on the bright disc: the label shadow carries it.
      style: { fontPx: 9, color: '#ffffff', bold: true, offsetYPx: 9 },
      frame: 'sky',
      labels,
    });
    summaryText = spaceWeatherSummary(data.weather);
    applyVisibility();
  }

  function reportStatus(): void {
    if (!data) return;
    const dataMs = data.weather.timeMs ?? regionsTimeMs(data.regions);
    if (dataMs === null) return;
    if (!data.fromNetwork) {
      context.setStatus(`offline · snapshot ${formatImageDate(dataMs)}`, 'stale');
    } else if (Math.abs(dataMs - context.now().getTime()) > LIVE_WINDOW_MS) {
      context.setStatus(`data of ${formatImageTime(dataMs)}`, 'stale');
    } else {
      context.setStatus(`live · ${formatImageTime(dataMs)}`, 'live');
    }
  }

  async function refresh(): Promise<void> {
    if (busy || disposed) return;
    busy = true;
    try {
      let next: ActivityData;
      try {
        next = await fetchLive(context);
      } catch (error) {
        // Live numbers already showing stay; otherwise the baked ones, said to be stale.
        if (data !== null) return;
        console.error('solar activity: live data unavailable, using the baked snapshot', error);
        next = await fetchBaked(context);
      }
      if (disposed) return;
      data = next;
      rebuildLabels();
      reportStatus();
    } catch (error) {
      console.error('solar activity: no data', error);
      if (!disposed) context.setStatus('unavailable', 'error');
    } finally {
      busy = false;
    }
  }

  return {
    setVisible(next) {
      visible = next;
      applyVisibility();
    },
    setResolution(_widthCss, height) {
      heightCss = height;
    },
    update(frame) {
      const wallMs = performance.now();
      if (wallMs - lastCheck >= REFRESH_INTERVAL_MS) {
        lastCheck = wallMs;
        void refresh();
      }
      let moved = false;
      const sun = clock.update(frame.date, () => {
        moved = true;
      });
      // New labels need placing even if the Sun has not moved since they arrived.
      if (data && (moved || !placed)) {
        placed = true;
        summaryLabel.position.set(sun.direction[0], sun.direction[1], sun.direction[2]);
        data.regions.forEach((region, i) => {
          const at = surfacePointOnSky(sun, region.latDeg, region.carringtonLonDeg);
          // The origin is "behind the viewer" to the label pass: a region gone round the limb is not named.
          if (at) regionPositions[i].set(at[0], at[1], at[2]);
          else regionPositions[i].set(0, 0, 0);
        });
      }
      const discPx = discPixels(sun.angularRadius, frame.camera.fov, heightCss);
      // One line under the Sun's own name.
      summaryLabel.set(summaryText, labelDropPx(discPx, SUN_LABEL_MIN_DROP_PX) + SUMMARY_LINE_PX);
      const show = discPx >= REGION_LABELS_MIN_DISC_PX;
      if (show !== regionsShown) {
        regionsShown = show;
        applyVisibility();
      }
    },
    dispose() {
      disposed = true;
      regionLabels?.remove();
      summaryLabel.dispose();
    },
  };
}
