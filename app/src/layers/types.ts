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
import type { HotspotSource } from '../guides/hotspot-field';
import type { GlobeRenderer } from '../render/globe';
import type { LabelGroup, LabelGroupSpec } from '../render/labels';
import type { SurfacePosition } from '../sensors';

/** Panel sections, in the order the panel shows them. */
export const LAYER_SECTIONS = [
  'Weather',
  'Surface',
  'Surface lines',
  'Human world',
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
  /**
   * How many times the scene is drawn this frame: 2 in the stereo view,
   * where whatever a layer costs per draw it pays twice. Absent means 1.
   */
  readonly eyes?: 1 | 2;
  /** A magnified window inside the view, while one is open: layers that sharpen with zoom sharpen there too. */
  readonly spyglass?: SpyglassFrame;
}

/** The Cardboard spyglass's view (ui/spyglass). */
export interface SpyglassFrame {
  /** Where it looks: a world unit vector. */
  readonly direction: THREE.Vector3;
  /** Its field, degrees across. */
  readonly fovDeg: number;
  /** Its size on the screen, CSS px across. */
  readonly heightCss: number;
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

/** Hotspots a layer handed to the app's hotspot field (spec/guides.md §8.1). */
export interface HotspotGroup {
  /** Their markers shown or taken down; they start down. */
  setVisible(visible: boolean): void;
  remove(): void;
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
  /** Hand hotspots to the one field a guide's hotspots share, so they open the same way. */
  addHotspots(source: HotspotSource): HotspotGroup;
  /** Chip beside the layer's switch: null clears it. */
  setStatus(text: string | null, tone?: StatusTone): void;
}

/**
 * One setting a layer takes from outside its own control: which earthquake
 * plays, how far back in time. A small schema, so that a guide's cue is
 * checked against it before it plays (layers/params.ts).
 */
export type LayerParam =
  | {
      readonly type: 'number';
      readonly description: string;
      readonly minimum?: number;
      readonly maximum?: number;
      /** Only these: a control that offers a few choices takes no other. */
      readonly values?: readonly number[];
    }
  | { readonly type: 'string'; readonly description: string; readonly values: readonly string[] }
  | { readonly type: 'boolean'; readonly description: string };

/** A layer's settings by name. */
export type LayerParams = Readonly<Record<string, LayerParam>>;

export type LayerParamValue = number | string | boolean;

/** Settings to change, by name; a setting left out stays as it is. */
export type LayerParamValues = Readonly<Record<string, LayerParamValue>>;

export interface LayerInstance {
  setVisible(visible: boolean): void;
  /**
   * Change the settings `values` names, checked already against the definition's `params`. A layer with params has
   * it. It may throw for a value the data turn out not to have, which reaches the caller as an error.
   */
  setParams?(values: LayerParamValues): void;
  /**
   * How much of the layer shows while it is visible, 0 to 1: a fade, called every frame of one, so it writes uniforms
   * and allocates nothing. Apart from setVisible: an invisible layer stays invisible whatever this says. A layer whose
   * definition says it `fades` has it.
   */
  setOpacity?(opacity: number): void;
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
  /**
   * Shows the provider's newest data whatever the app clock says: today's clouds over a 2011 sky. A guide that takes
   * the clock away from the present may not have it on (guides/validate.ts).
   */
  readonly live?: true;
  readonly credits: readonly Credit[];
  /** The settings a guide, a link or the voice may give it beside its own control; its instance then has setParams. */
  readonly params?: LayerParams;
  /** It can fade in and out (a `layers` action's fadeS); its instance then has setOpacity. */
  readonly fades?: boolean;
  /** Fetch code and data and build the layer. Runs once, on first switch-on. */
  load(context: LayerContext): Promise<LayerInstance>;
}

/** Radius at which skyRoot's unit sphere is drawn: inside the far plane, far beyond the Moon's parallax. */
export const SKY_RADIUS_M = 9e8;
