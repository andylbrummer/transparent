/**
 * Lazy layers: everything added to the view beyond the always-loaded map.
 *
 * A layer is a folder under src/layers/ with a `layer.ts` that exports its
 * definitions - what the panel shows and whom to credit - and nothing
 * heavy: the code and data arrive through `load`, on the first time the
 * switch goes on. src/layers/registry.ts picks every `layer.ts` up by
 * itself, so adding a layer touches no shared file.
 */

import type * as THREE from 'three';
import type { GlobeRenderer } from '../render/globe';
import type { LabelGroup, LabelGroupSpec } from '../render/labels';
import type { SurfacePosition } from '../sensors';

/** Panel sections, in the order the panel shows them. */
export const LAYER_SECTIONS = [
  'Weather',
  'Surface',
  'Surface lines',
  'Inside the Earth',
  'Near space',
  'Sky',
  'Deep sky',
  'Sky maps',
  'Labels',
] as const;

export type LayerSection = (typeof LAYER_SECTIONS)[number];

/** One line of the in-app credits list. */
export interface Credit {
  /** What it is, e.g. "Star positions and magnitudes". */
  readonly what: string;
  /** Who made it, as they ask to be cited. */
  readonly source: string;
  readonly licence: string;
  readonly url: string;
}

export type StatusTone = 'info' | 'live' | 'stale' | 'error';

/** What every frame hands a visible layer. */
export interface FrameState {
  /** The app clock: wall time, or the instant pinned with ?time=. */
  readonly date: Date;
  /** The view camera (the cyclops camera in stereo). */
  readonly camera: THREE.PerspectiveCamera;
  readonly position: SurfacePosition;
  /** Wall-clock milliseconds since the previous frame. */
  readonly deltaMs: number;
}

/** Uniform objects shared by reference, so one write reaches every sky material. */
export interface SkyUniforms {
  /** Unit vector from the Earth's centre through the user, ECEF. */
  readonly uObserverUp: { value: THREE.Vector3 };
  /** Brightness kept by sky below the horizon, seen through the planet: 0 hides it. */
  readonly uBelowHorizon: { value: number };
  /** Device pixels per CSS pixel, for point sizes given in CSS pixels. */
  readonly uPixelRatio: { value: number };
}

export interface LayerContext {
  readonly renderer: THREE.WebGLRenderer;
  /** Earth-fixed: ECEF metres, origin at the Earth's centre. */
  readonly earthRoot: THREE.Group;
  /**
   * Earth-centred, turned to ICRS axes: metres from the Earth's centre in
   * the inertial frame. For bodies near enough to show parallax (the Moon).
   */
  readonly inertialRoot: THREE.Group;
  /**
   * The celestial sphere: centred on the camera and turned to ICRS axes,
   * so a child at a unit direction sits SKY_RADIUS_M away along it.
   */
  readonly skyRoot: THREE.Group;
  readonly skyUniforms: SkyUniforms;
  readonly globe: GlobeRenderer;
  /** URL of a baked file under app/public/. */
  assetUrl(path: string): string;
  /** GET and parse JSON; rejects on a non-2xx status. */
  fetchJson<T>(url: string, init?: RequestInit): Promise<T>;
  /** The app clock. */
  now(): Date;
  getPosition(): SurfacePosition | null;
  addLabels(spec: LabelGroupSpec): LabelGroup;
  /** Chip beside the layer's switch: null clears it. */
  setStatus(text: string | null, tone?: StatusTone): void;
}

export interface LayerInstance {
  setVisible(visible: boolean): void;
  /** Called every frame while visible. */
  update?(frame: FrameState): void;
  /** CSS-pixel size of the viewport (one eye's in stereo). */
  setResolution?(widthCss: number, heightCss: number): void;
  dispose(): void;
}

export interface LayerDefinition {
  /** Unique, kebab-case; also the key under which the switch is saved. */
  readonly id: string;
  readonly label: string;
  readonly section: LayerSection;
  /** Position within the section: lower first. Default 100. */
  readonly order?: number;
  /** CSS background for the legend bar. */
  readonly legend?: string;
  readonly caption?: string;
  /** Lazy layers start off unless this says otherwise. */
  readonly defaultOn?: boolean;
  /** Switches sharing a group are exclusive: turning one on turns the rest off. */
  readonly exclusiveGroup?: string;
  readonly credits: readonly Credit[];
  /** Fetch code and data and build the layer. Runs once, on first switch-on. */
  load(context: LayerContext): Promise<LayerInstance>;
}

/** Radius at which skyRoot's unit sphere is drawn: inside the far plane, far beyond the Moon's parallax. */
export const SKY_RADIUS_M = 9e8;
