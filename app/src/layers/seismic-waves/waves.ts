/**
 * Seismic wave playback: pick an earthquake and watch its waves cross the
 * planet under your feet, in compressed real time.
 *
 * The pieces: the baked rays and their arithmetic (data.ts), the meshes
 * (render.ts), the playback state (ui/timeline), the control (control.ts)
 * and its wording (readout.ts). This file joins them to the layer system.
 *
 * Playback runs on its own clock - seconds since the earthquake - and does
 * not touch the app clock. For screenshots and links the state can be set
 * from the page's URL:
 *
 *   ?quake=tohoku2011   the earthquake, by key (events.ts: tohoku2011,
 *                       sumatra2004, valdivia1960, sanfrancisco1906,
 *                       turkiye2023, okhotsk2013, bolivia1994, latest)
 *   &t=600              seconds since the origin; given, playback starts paused there
 *   &speed=120          compression (30, 60, 120, 600)
 *   &shadows=0          leave the shadow-zone tints off
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M, type EventRecord } from '@transparent-earth/core';
import { GeoMarkers } from '../../render/geo-markers';
import { LABEL_KIND_ORDER, type LabelGroup } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import type { SurfacePosition } from '../../sensors';
import {
  DEFAULT_PLAYBACK,
  PLAYBACK_SPANS_S,
  PLAYBACK_SPEEDS,
  elapsedS,
  isPlaying,
  playbackSpeed,
  seekElapsed,
  selectEvent,
  setSpan,
  setSpeed,
  tickPlayback,
  togglePlayback,
  type PlaybackState,
} from '../../ui/timeline';
import { CACHE_KEY, REFRESH_INTERVAL_MS, browserIo, loadRecent } from '../quakes-recent/recent';
import type { NotableQuakeData } from '../quakes-notable/notable';
import type { LayerContext, LayerInstance } from '../types';
import { PlaybackControl, type PlaybackView } from './control';
import {
  angularDistanceDeg,
  arrivalsAt,
  nearestSliceIndex,
  parseWaveData,
  surfaceRings,
  surfaceWaveRingDeg,
  type Arrival,
  type WaveData,
  type WaveManifest,
} from './data';
import { LATEST_KEY, latestLargeEvent, originText, presetEvents, type WaveEvent } from './events';
import { placeReadout } from './readout';
import { WAVE_COLORS, WaveRenderer, shadowEdges, sourceFrame } from './render';

/** An arrival counts as "passing here now" for this long on the wall clock. */
const PASSING_WALL_S = 4;
/** The readout's words are rebuilt this often, not every frame. */
const READOUT_INTERVAL_MS = 200;
/** The user has to move this far (degrees) before distances are worked out again. */
const MOVED_DEG = 0.01;

export interface UrlPlayback {
  readonly quake: string | null;
  readonly timeS: number | null;
  readonly speed: number | null;
  readonly shadows: boolean;
}

/** What the page URL asks of the playback; anything malformed is ignored. */
export function parseUrlPlayback(search: string): UrlPlayback {
  const params = new URLSearchParams(search);
  const number = (key: string): number | null => {
    const raw = params.get(key);
    if (raw === null || raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  const t = number('t');
  const speed = number('speed');
  return {
    quake: params.get('quake'),
    timeS: t !== null && t >= 0 ? t : null,
    speed: speed !== null && (PLAYBACK_SPEEDS as readonly number[]).includes(speed) ? speed : null,
    shadows: params.get('shadows') !== '0',
  };
}

/** The scrubber span that holds a time: the default if it fits, else the shortest that does. */
export function spanFor(timeS: number, current: number): number {
  if (timeS <= current) return current;
  return PLAYBACK_SPANS_S.find((span) => span >= timeS) ?? PLAYBACK_SPANS_S[PLAYBACK_SPANS_S.length - 1];
}

/** The latest feed answer another layer left in localStorage, if it is fresh enough to stand in for a fetch. */
function freshCachedFeed(): readonly EventRecord[] | null {
  try {
    const text = localStorage.getItem(CACHE_KEY);
    if (!text) return null;
    const entry = JSON.parse(text) as { generatedMs?: unknown; events?: unknown };
    if (typeof entry.generatedMs !== 'number' || !Array.isArray(entry.events)) return null;
    // Wall time: this decides whether to ask USGS again, it dates nothing.
    if (Date.now() - entry.generatedMs > REFRESH_INTERVAL_MS) return null;
    return entry.events as EventRecord[];
  } catch {
    return null;
  }
}

function unitAt(latDeg: number, lonDeg: number, target: THREE.Vector3): THREE.Vector3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  return target.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
}

export async function createSeismicWavesLayer(context: LayerContext): Promise<LayerInstance> {
  const [manifest, binary, notable] = await Promise.all([
    context.fetchJson<WaveManifest>(context.assetUrl('geo/seismic-waves.json')),
    fetch(context.assetUrl('geo/seismic-waves.bin')).then((response) => {
      if (!response.ok) throw new Error(`seismic-waves.bin: HTTP ${response.status}`);
      return response.arrayBuffer();
    }),
    context.fetchJson<NotableQuakeData>(context.assetUrl('geo/quakes-notable.json')),
  ]);
  const data: WaveData = parseWaveData(manifest, binary);
  let events: WaveEvent[] = presetEvents(notable, manifest.deepEvents);
  if (events.length === 0) throw new Error('seismic waves: no earthquakes to play');

  const url = parseUrlPlayback(window.location.search);
  const renderer = new WaveRenderer(data);
  renderer.setShadowsVisible(url.shadows);
  const motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const onMotion = (): void => renderer.setReducedMotion(motion?.matches ?? false);
  onMotion();
  motion?.addEventListener('change', onMotion);
  context.earthRoot.add(renderer.object);

  // The source and its antipode, over the fronts and the catalogue's dots.
  const markers = new GeoMarkers('seismic-wave-markers', context.skyUniforms.uPixelRatio, RENDER_ORDER.quakes + 0.1);
  context.earthRoot.add(markers.object);

  let state: PlaybackState = DEFAULT_PLAYBACK;
  let selected: WaveEvent = events[0];
  let visible = false;
  let disposed = false;
  let staticLabels: LabelGroup | null = null;
  let observer: SurfacePosition | null = context.getPosition();
  let hereDeg = 0;
  let hereArrivals: Arrival[] = [];
  let antipodeArrivals: Arrival[] = [];
  let lastReadoutMs = -Infinity;

  // Labels that ride the rings: one group each, so each can be hidden when its wave is not at the surface.
  const ringLabels = (
    [
      ['P', 'P wave', WAVE_COLORS.P],
      ['S', 'S wave', WAVE_COLORS.S],
      ['love', 'Love wave', WAVE_COLORS.love],
      ['rayleigh', 'Rayleigh wave', WAVE_COLORS.rayleigh],
    ] as const
  ).map(([id, text, color]) => {
    const position = new THREE.Vector3();
    const group = context.addLabels({
      rank: LABEL_KIND_ORDER.indexOf('quake') - 0.6,
      style: { fontPx: 11, color: `#${color.toString(16).padStart(6, '0')}`, bold: true, offsetYPx: -12 },
      frame: 'earth',
      labels: [{ text, priority: 0, position }],
    });
    group.setVisible(false);
    return { id, position, group };
  });
  const ringScratch = new Float32Array(16);
  const frame = { axis: new THREE.Vector3(0, 0, 1), e1: new THREE.Vector3(1, 0, 0) };

  const control = new PlaybackControl(context.renderer.domElement.parentElement ?? document.body, {
    onSelect: (key) => {
      const event = events.find((candidate) => candidate.key === key);
      if (event) choose(event, true, 0);
    },
    onToggle: () => {
      state = togglePlayback(state);
      refreshReadout(true);
    },
    onSeek: (seconds) => {
      state = seekElapsed(state, seconds);
      refreshReadout(true);
    },
    onSpeed: (compression) => {
      state = setSpeed(state, compression);
      refreshReadout(true);
    },
    onSpan: (spanS) => {
      state = setSpan(state, spanS);
      refreshReadout(true);
    },
  });

  /** A point on the surface `deg` from the epicentre, along the great circle towards the observer. */
  const towardsObserver = (deg: number, target: THREE.Vector3): THREE.Vector3 => {
    const rad = (deg * Math.PI) / 180;
    return target
      .copy(frame.axis)
      .multiplyScalar(Math.cos(rad))
      .addScaledVector(frame.e1, Math.sin(rad))
      .multiplyScalar(EARTH_RADIUS_M);
  };

  /** Everything that depends on the earthquake and on where the user stands. */
  function place(): void {
    const slice = data.slices[nearestSliceIndex(data, selected.depthKm)];
    const towards = observer ? unitAt(observer.lat, observer.lon, new THREE.Vector3()) : null;
    renderer.setSource(selected.lat, selected.lon, slice, towards);
    const source = sourceFrame(selected.lat, selected.lon, towards);
    frame.axis.copy(source.axis);
    frame.e1.copy(source.e1);

    hereDeg = observer ? angularDistanceDeg(selected.lat, selected.lon, observer.lat, observer.lon) : 0;
    hereArrivals = observer ? arrivalsAt(data, selected.depthKm, hereDeg) : [];
    antipodeArrivals = arrivalsAt(data, selected.depthKm, 180);

    const antipodeLon = selected.lon > 0 ? selected.lon - 180 : selected.lon + 180;
    markers.setMarkers([
      { lon: selected.lon, lat: selected.lat, altitudeM: -selected.depthKm * 1000, shape: 'star', color: 0xffffff, sizePx: 18 },
      { lon: antipodeLon, lat: -selected.lat, shape: 'ring', color: 0xffffff, sizePx: 16 },
    ]);

    const edges = shadowEdges(data, slice);
    staticLabels?.remove();
    staticLabels = context.addLabels({
      rank: LABEL_KIND_ORDER.indexOf('quake') - 0.7,
      style: { fontPx: 11, color: '#ffffff', bold: true, offsetYPx: 16 },
      frame: 'earth',
      labels: [
        {
          text: `M${selected.mag.toFixed(1)} ${selected.name} · ${Math.round(Math.max(0, selected.depthKm))} km`,
          priority: 0,
          position: new THREE.Vector3().copy(frame.axis).multiplyScalar(EARTH_RADIUS_M - Math.max(0, selected.depthKm) * 1000),
        },
        { text: 'antipode', priority: 1, position: new THREE.Vector3().copy(frame.axis).multiplyScalar(-EARTH_RADIUS_M) },
        ...(url.shadows
          ? [
              {
                text: `P shadow ${Math.round(edges.pEndDeg)}°–${Math.round(edges.pkpCausticDeg)}°`,
                priority: 2,
                position: towardsObserver((edges.pEndDeg + edges.pkpCausticDeg) / 2, new THREE.Vector3()),
              },
              {
                text: `S shadow beyond ${Math.round(edges.sEndDeg)}°`,
                priority: 3,
                position: towardsObserver(Math.min(175, edges.pkpCausticDeg + 14), new THREE.Vector3()),
              },
            ]
          : []),
      ],
    });
    staticLabels.setVisible(visible);
    context.setStatus(`${manifest.model} model`, 'info');
  }

  function choose(event: WaveEvent, play: boolean, atS: number): void {
    selected = event;
    state = selectEvent(state, event, play);
    if (atS > 0) state = seekElapsed(setSpan(state, spanFor(atS, state.spanS)), atS);
    control.setEvents(events, selected.key);
    place();
    refreshReadout(true);
  }

  function refreshReadout(force: boolean): void {
    const nowMs = performance.now();
    if (!force && nowMs - lastReadoutMs < READOUT_INTERVAL_MS) return;
    lastReadoutMs = nowMs;
    const t = elapsedS(state);
    const passingS = PASSING_WALL_S * playbackSpeed(state);
    const here = placeReadout(hereArrivals, t, 'you', passingS);
    const antipode = placeReadout(antipodeArrivals, t, 'the antipode', passingS);
    const view: PlaybackView = {
      playing: isPlaying(state),
      elapsedS: t,
      spanS: state.spanS,
      speed: playbackSpeed(state),
      origin: `M${selected.mag.toFixed(1)} · ${Math.round(Math.max(0, selected.depthKm))} km deep · ${originText(selected.time)}`,
      hereTitle: observer ? `Here, ${hereDeg.toFixed(1)}° away` : 'Here',
      hereNext: observer ? here.next : 'waiting for your location',
      hereTimetable: observer ? here.timetable : '',
      antipodeNext: antipode.next,
      antipodeTimetable: antipode.timetable,
      felt: here.passing ?? '',
    };
    control.update(view);
  }

  /** Put each ring's label on its ring, on the side of the epicentre the observer is on. */
  function placeRingLabels(t: number): void {
    const slice = renderer.getSlice();
    for (const label of ringLabels) {
      let deg = -1;
      if (label.id === 'P' || label.id === 'S') {
        // The outermost ring of the family: the one still spreading.
        const count = surfaceRings(data, slice, label.id, t, ringScratch);
        for (let i = 0; i < count; i++) deg = Math.max(deg, ringScratch[i]);
      } else if (t > 0) {
        const wave = manifest.surfaceWaves.find((candidate) => candidate.id === label.id);
        if (wave) deg = surfaceWaveRingDeg(data, wave, t);
      }
      const shown = visible && deg > 1 && deg < 179;
      label.group.setVisible(shown);
      if (shown) towardsObserver(deg, label.position);
    }
  }

  const initial = events.find((event) => event.key === url.quake) ?? events[0];
  if (url.speed !== null) state = setSpeed(state, url.speed);
  // A time in the URL is a request to look at that instant: start paused there.
  choose(initial, url.timeS === null, url.timeS ?? 0);

  // The live entry arrives when the feed does; the presets do not wait for it.
  void (async () => {
    try {
      const feed = freshCachedFeed() ?? (await loadRecent(browserIo(context))).events;
      const latest = latestLargeEvent(feed, context.now().getTime());
      if (disposed || !latest) return;
      events = [...events, latest];
      control.setEvents(events, selected.key);
      if (url.quake === LATEST_KEY) choose(latest, url.timeS === null, url.timeS ?? 0);
    } catch (error) {
      console.error('seismic waves: no live earthquakes', error);
    }
  })();

  return {
    setVisible(next) {
      visible = next;
      renderer.object.visible = next;
      markers.object.visible = next;
      staticLabels?.setVisible(next);
      control.setVisible(next);
      if (!next) for (const label of ringLabels) label.group.setVisible(false);
    },
    update(frameState) {
      const position = frameState.position;
      if (!observer || Math.abs(position.lat - observer.lat) > MOVED_DEG || Math.abs(position.lon - observer.lon) > MOVED_DEG) {
        observer = position;
        place();
      }
      state = tickPlayback(state, frameState.deltaMs);
      const t = elapsedS(state);
      renderer.setTime(t);
      placeRingLabels(t);
      refreshReadout(false);
    },
    dispose() {
      disposed = true;
      motion?.removeEventListener('change', onMotion);
      staticLabels?.remove();
      for (const label of ringLabels) label.group.remove();
      markers.dispose();
      renderer.dispose();
      control.dispose();
    },
  };
}
