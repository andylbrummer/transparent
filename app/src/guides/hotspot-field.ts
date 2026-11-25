/**
 * The hotspots in the view and the ways to open one (spec/guides.md §8.1-8.3). A guide's step and the "Stories and
 * clips" layer each hand theirs over as a source; the field draws a marker for each, "▶ title", and says which one a
 * tap, a stare or a press means. What opening does is the caller's: the clip player plays it.
 *
 * A marker is a label (LabelLayer.addGroup), so it is decluttered with the map's names and has its right-eye twin in
 * stereo for nothing. It is drawn as a guide's mark is, along its anchor's direction as far off as the sky, so both
 * eyes see it the same way. Labels take no pointer events, so a tap is tested by its direction against the markers.
 *
 * Anchors are found again every REFRESH_MS, not every frame: a horizon or a ground anchor moves only with where the
 * view stands, and the sky turns 15° an hour. Each frame is dot products against the directions kept, with nothing
 * allocated.
 */

import * as THREE from 'three';
import { SKY_RADIUS_M } from '../layers/types';
import type { LabelGroup, LabelGroupSpec, LabelStyle } from '../render/labels';
import { CAPTURE_DEG, DWELL_MS, FUSE_DELAY_MS, STILL_DEG_PER_S } from '../ui/spyglass';
import type { Located, Target, TargetUnresolved } from '../view/actions';
import type { Hotspot } from './format';

/** Where a set of hotspots comes from: a guide or the layer. */
export interface HotspotSource {
  readonly hotspots: readonly Hotspot[];
  /** The URL of a file one of its clips names, from the folder they are in. */
  fileUrl(path: string): string;
  /** The language of its clips' captions and text, BCP 47. */
  readonly language: string;
}

/** A hotspot in the view, as the clip player is handed it. */
export interface FieldHotspot {
  readonly hotspot: Hotspot;
  readonly source: HotspotSource;
  /** World unit vector toward its anchor, kept up to date in place. */
  readonly direction: THREE.Vector3;
}

export interface HotspotFieldDeps {
  /** Where a target is from where the view stands: ViewControl.locate. */
  locate(target: Target): Located | TargetUnresolved;
  /** The view's camera: markers hang at the sky's distance from it. */
  readonly camera: THREE.Camera;
  addLabels(spec: LabelGroupSpec): LabelGroup;
  /** Whether a layer switch is on: a hotspot with a `layer` shows only then. */
  isLayerOn(id: string): boolean;
  /** Open a hotspot's clip. */
  open(hotspot: FieldHotspot): void;
}

/** A tap opens the marker within this of its direction (spec/guides.md §8.3): looser than a stare, a finger is wide. */
export const TAP_DEG = 3;
/** A press that moves no further than this before it is released is a tap, not a drag of the view. */
export const TAP_SLOP_PX = 8;
/** How often anchors are found again. */
export const REFRESH_MS = 250;

/** After a guide's marks (-1) and before every name, the depth ladder's too (a country's rank less 0.9): a marker is there to be found. */
const MARKER_RANK = -0.99;
const MARKER_STYLE: LabelStyle = { fontPx: 13, color: '#ffd27a', bold: true };

/** A marker drawn for one hotspot. */
interface Marker extends FieldHotspot {
  /** Read by the label layer every frame, so it is moved in place. */
  readonly position: THREE.Vector3;
  readonly group: LabelGroup;
  /** Its anchor has resolved at least once: before then it has no direction. */
  placed: boolean;
  shown: boolean;
}

/** How near the gaze has come to opening a marker, for the ring the spyglass draws. */
export interface HotspotFuse {
  readonly direction: THREE.Vector3;
  /** 0 to 1. */
  readonly fraction: number;
}

/** The one fuse dwell hands out, changed in place: a new object a frame would be garbage a frame. */
interface KeptFuse {
  readonly direction: THREE.Vector3;
  fraction: number;
}

export interface HotspotField {
  /** Show `source`'s hotspots in place of what was shown under `key`; null takes them down. */
  set(key: string, source: HotspotSource | null): void;
  /** Once a frame: anchors found again when due, markers shown or hidden with their switches. */
  update(deltaMs: number): void;
  /** A hotspot in the view by id, the first source's first; null if none has it. */
  find(id: string): FieldHotspot | null;
  /** The markers shown now. A new array: for a spoken title, not for a frame. */
  shown(): FieldHotspot[];
  /** The shown marker nearest `direction`, within `maxDeg`; null if none is. */
  nearest(direction: THREE.Vector3, maxDeg: number): FieldHotspot | null;
  /** A tap toward `direction`: opens the marker there, and says whether one was. */
  tap(direction: THREE.Vector3): boolean;
  /**
   * Once a frame in the viewer: the stare that opens a marker, the spyglass's rule. A marker within CAPTURE_DEG of
   * `forward`, the head still, for DWELL_MS opens; then it stays shut until the gaze leaves it. The fuse to draw, or null.
   */
  dwell(forward: THREE.Vector3, deltaMs: number): HotspotFuse | null;
  /** Forget a stare under way: a clip opened some other way, or the viewer was left. */
  resetDwell(): void;
  dispose(): void;
}

export function createHotspotField(deps: HotspotFieldDeps): HotspotField {
  const sources = new Map<string, Marker[]>();
  /** Every source's markers in one list, made again on a set: the frame's loops walk it by index, with no iterator. */
  let markers: Marker[] = [];
  const fuse: KeptFuse = { direction: new THREE.Vector3(), fraction: 0 };
  let sinceRefreshMs = Infinity;
  /** The stare under way. */
  let staring: Marker | null = null;
  let heldMs = 0;
  /** A marker the stare has opened, or a clip close left under the gaze: not opened again until the gaze leaves it. */
  let spent: Marker | null = null;
  const lastForward = new THREE.Vector3();
  let hasLastForward = false;
  const cosOf = (deg: number): number => Math.cos(THREE.MathUtils.degToRad(deg));
  const captureCos = cosOf(CAPTURE_DEG);

  function markerFor(hotspot: Hotspot, source: HotspotSource): Marker {
    const position = new THREE.Vector3();
    const group = deps.addLabels({ rank: MARKER_RANK, style: MARKER_STYLE, frame: 'earth', labels: [{ text: `▶ ${hotspot.title}`, priority: 0, position }] });
    // Hidden until its anchor resolves: before that it has no place to be.
    group.setVisible(false);
    return { hotspot, source, direction: new THREE.Vector3(), position, group, placed: false, shown: false };
  }

  function set(key: string, source: HotspotSource | null): void {
    for (const marker of sources.get(key) ?? []) marker.group.remove();
    sources.delete(key);
    if (source) sources.set(key, source.hotspots.map((hotspot) => markerFor(hotspot, source)));
    markers = [...sources.values()].flat();
    if (staring && !markers.includes(staring)) staring = null;
    if (spent && !markers.includes(spent)) spent = null;
    // The new markers are placed in the next update, not a refresh later.
    sinceRefreshMs = Infinity;
  }

  function update(deltaMs: number): void {
    sinceRefreshMs += deltaMs;
    const refresh = sinceRefreshMs >= REFRESH_MS;
    if (refresh) sinceRefreshMs = 0;
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      if (refresh) {
        const located = deps.locate(marker.hotspot.anchor);
        // A target lost for now (no position yet) leaves the marker where it was.
        if (located.ok) {
          marker.direction.copy(located.direction);
          marker.position.copy(deps.camera.position).addScaledVector(located.direction, SKY_RADIUS_M);
          marker.placed = true;
        }
      }
      const layer = marker.hotspot.layer;
      const shown = marker.placed && (layer === undefined || deps.isLayerOn(layer));
      if (shown !== marker.shown) {
        marker.shown = shown;
        marker.group.setVisible(shown);
      }
    }
  }

  function find(id: string): FieldHotspot | null {
    return markers.find((marker) => marker.hotspot.id === id) ?? null;
  }

  function nearestMarker(direction: THREE.Vector3, minCos: number): Marker | null {
    let best: Marker | null = null;
    let bestCos = minCos;
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      if (!marker.shown) continue;
      const cos = marker.direction.dot(direction);
      if (cos >= bestCos) {
        best = marker;
        bestCos = cos;
      }
    }
    return best;
  }

  function dwell(forward: THREE.Vector3, deltaMs: number): HotspotFuse | null {
    const under = nearestMarker(forward, captureCos);
    // Turned faster than a head holding still: as the spyglass reads it, degrees a second since the last frame.
    const turnedDeg = hasLastForward ? THREE.MathUtils.radToDeg(lastForward.angleTo(forward)) : 0;
    const still = deltaMs <= 0 || (turnedDeg * 1000) / deltaMs < STILL_DEG_PER_S;
    lastForward.copy(forward);
    hasLastForward = true;
    if (under !== spent) spent = null;
    if (under === null || under === spent) {
      staring = null;
      heldMs = 0;
      return null;
    }
    if (under !== staring || !still) {
      staring = under;
      heldMs = 0;
      return null;
    }
    heldMs += deltaMs;
    if (heldMs >= DWELL_MS) {
      spent = under;
      staring = null;
      heldMs = 0;
      deps.open(under);
      return null;
    }
    if (heldMs < FUSE_DELAY_MS) return null;
    fuse.direction.copy(under.direction);
    fuse.fraction = (heldMs - FUSE_DELAY_MS) / (DWELL_MS - FUSE_DELAY_MS);
    return fuse;
  }

  return {
    set,
    update,
    find,
    shown: () => markers.filter((marker) => marker.shown),
    nearest: (direction, maxDeg) => nearestMarker(direction, cosOf(maxDeg)),
    tap(direction) {
      const marker = nearestMarker(direction, cosOf(TAP_DEG));
      if (marker) deps.open(marker);
      return marker !== null;
    },
    dwell,
    resetDwell() {
      // What is under the gaze now stays shut until the gaze leaves it: a clip just closed there must not reopen.
      spent = staring ?? spent;
      staring = null;
      heldMs = 0;
      hasLastForward = false;
    },
    dispose() {
      for (const key of [...sources.keys()]) set(key, null);
    },
  };
}
