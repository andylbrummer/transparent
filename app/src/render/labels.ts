/**
 * Names through the see-through Earth, the way a sky map names stars:
 * places on the far-side surface, and geology - plates, hotspots,
 * subduction zones, volcanoes, and deep structures and great earthquakes
 * at their depth.
 *
 * Labels are screen-aligned DOM text, so they stay readable however
 * foreshortened the land beneath them is. Each frame they are placed in
 * rank order - by kind (LABEL_KIND_ORDER), then by each source's own
 * priority - and a label overlapping one already placed is hidden, so the
 * broader names win wherever the view is crowded.
 *
 * Lazy layers add their own names later with addGroup: a group carries its
 * rank among the kinds, its style, and whether its points are Earth-fixed
 * or directions on the sky.
 *
 * In stereo (setStereo) each label has a twin in a right-eye container:
 * the left eye declutters, and the right shows the same names at its own
 * projection of the same points, so each name fuses at its feature's depth.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';

export type LabelKind =
  | 'country'
  | 'state'
  | 'city'
  | 'plate'
  | 'deep'
  | 'hotspot'
  | 'quake'
  | 'subduction'
  | 'volcano';

/**
 * Declutter rank by kind: earlier kinds win overlaps. Geology outranks
 * states and cities - this is a map of the Earth's structure - but
 * countries stay first so the view keeps its bearings.
 */
export const LABEL_KIND_ORDER: readonly LabelKind[] = [
  'country',
  'plate',
  'deep',
  'hotspot',
  'quake',
  'subduction',
  'state',
  'volcano',
  'city',
];

export interface PlaceLabel {
  readonly kind: LabelKind;
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
  /** Rank within its kind, from the pipeline: lower is more important. */
  readonly priority: number;
  /** Below the surface, in km; absent for surface features. */
  readonly depthKm?: number;
}

/** The labels of app/public/geo/labels.json, geology.json and quakes.json. */
export interface LabelData {
  readonly labels: readonly PlaceLabel[];
}

/** Font size per kind, in CSS pixels; width is estimated from it. */
const FONT_PX: Readonly<Record<LabelKind, number>> = {
  country: 12,
  state: 11,
  city: 11,
  plate: 12,
  deep: 11,
  hotspot: 11,
  quake: 10,
  subduction: 10,
  volcano: 10,
};
/** Kinds drawn uppercase and letter-spaced, so wider glyphs. */
const WIDE_KINDS: ReadonlySet<LabelKind> = new Set(['country', 'plate']);
/** Average glyph advance as a fraction of font size, for the overlap boxes. */
const GLYPH_WIDTH_EM = 0.62;
/** Uppercase, letter-spaced names (WIDE_KINDS): wider glyphs. */
const COUNTRY_GLYPH_WIDTH_EM = 0.78;
const LABEL_PADDING_PX = 4;
/** Bounds per-frame DOM writes; past this the view is unreadable anyway. */
export const MAX_VISIBLE_LABELS = 48;

/** How a group of labels added by a lazy layer is drawn. */
export interface LabelStyle {
  /** CSS pixels. */
  readonly fontPx: number;
  /** CSS colour. */
  readonly color: string;
  readonly italic?: boolean;
  readonly bold?: boolean;
  /** Uppercase and letter-spaced, like country names. */
  readonly wide?: boolean;
  /** Shift the text down from its point, CSS px, so it sits under a marker instead of on it. */
  readonly offsetYPx?: number;
}

export interface GroupLabel {
  /** The text shown, markers included. */
  readonly text: string;
  /** Rank within the group: lower is more important. */
  readonly priority: number;
  /**
   * 'earth': ECEF metres. 'sky': a unit direction in ICRS, at infinity.
   * Read every frame, so a layer may move it (a satellite, a planet).
   */
  readonly position: THREE.Vector3;
}

export interface LabelGroupSpec {
  /**
   * Declutter rank among the kinds: the index a kind would have in
   * LABEL_KIND_ORDER, fractions allowed (0.5 sits between country and plate).
   */
  readonly rank: number;
  readonly style: LabelStyle;
  readonly frame: 'earth' | 'sky';
  readonly labels: readonly GroupLabel[];
}

/** A group added with LabelLayer.addGroup. */
export interface LabelGroup {
  setVisible(visible: boolean): void;
  remove(): void;
}

interface GroupState {
  readonly frame: 'earth' | 'sky';
  visible: boolean;
}

interface PlacedLabel {
  /** Absent for a group's labels. */
  readonly label: PlaceLabel | null;
  readonly group: GroupState | null;
  readonly name: string;
  readonly rank: number;
  readonly priority: number;
  readonly element: HTMLElement;
  readonly position: THREE.Vector3;
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** Added to the projected y: the text's offset from its point. */
  readonly offsetY: number;
  visible: boolean;
  /** The right eye's copy, created on the first setStereo(true). */
  twin: HTMLElement | null;
  twinVisible: boolean;
}

/** The text a label shows: its name, with a marker or depth for its kind. */
export function labelText(label: PlaceLabel): string {
  switch (label.kind) {
    case 'city':
      return `• ${label.name}`;
    case 'volcano':
      return `▲ ${label.name}`;
    case 'hotspot':
      return `◉ ${label.name}`;
    case 'deep':
    case 'quake':
      return label.depthKm === undefined ? label.name : `${label.name} · ${label.depthKm} km`;
    default:
      return label.name;
  }
}

/** Estimated on-screen box, so placement never forces a layout read. */
export function estimateLabelSize(label: PlaceLabel): { width: number; height: number } {
  const font = FONT_PX[label.kind];
  const em = WIDE_KINDS.has(label.kind) ? COUNTRY_GLYPH_WIDTH_EM : GLYPH_WIDTH_EM;
  return { width: labelText(label).length * font * em + LABEL_PADDING_PX, height: font * 1.3 + LABEL_PADDING_PX };
}

/** Stable rank order: by kind, then the source's priority, then source order. */
export function rankLabels(labels: readonly PlaceLabel[]): PlaceLabel[] {
  const rank = (kind: LabelKind): number => LABEL_KIND_ORDER.indexOf(kind);
  return [...labels].sort((a, b) => rank(a.kind) - rank(b.kind) || a.priority - b.priority);
}

/** Sky labels are projected from this far out along their direction: effectively infinity. */
const SKY_LABEL_DISTANCE_M = 1e12;

export class LabelLayer {
  private readonly container: HTMLElement;
  private placed: PlacedLabel[];
  private readonly skyRotation = new THREE.Matrix4();
  private readonly view = new THREE.Vector3();
  private readonly boxes: number[] = [];
  private readonly hiddenKinds = new Set<LabelKind>();
  private rightEyeContainer: HTMLElement | null = null;
  private stereo = false;
  private shown = true;

  /** Takes label sources up front; more can follow with addLabels. All rank together by LABEL_KIND_ORDER. */
  constructor(parent: HTMLElement, sources: readonly LabelData[]) {
    this.container = document.createElement('div');
    this.container.className = 'place-labels';
    this.placed = [];
    this.addLabels(sources);
    parent.appendChild(this.container);
  }

  /** Add kind-styled labels (the baked places and geology) after construction. */
  addLabels(sources: readonly LabelData[]): void {
    const added = rankLabels(sources.flatMap((source) => source.labels)).map((label): PlacedLabel => {
      const element = document.createElement('div');
      element.className = `place-label place-label--${label.kind}`;
      element.textContent = labelText(label);
      element.style.display = 'none';
      this.container.appendChild(element);
      let twin: HTMLElement | null = null;
      if (this.rightEyeContainer) {
        twin = element.cloneNode(true) as HTMLElement;
        this.rightEyeContainer.appendChild(twin);
      }
      const lonRad = (label.lon * Math.PI) / 180;
      const latRad = (label.lat * Math.PI) / 180;
      const radius = EARTH_RADIUS_M - (label.depthKm ?? 0) * 1000;
      const position = new THREE.Vector3(
        radius * Math.cos(latRad) * Math.cos(lonRad),
        radius * Math.cos(latRad) * Math.sin(lonRad),
        radius * Math.sin(latRad)
      );
      const size = estimateLabelSize(label);
      return {
        label,
        group: null,
        name: label.name,
        rank: LABEL_KIND_ORDER.indexOf(label.kind),
        priority: label.priority,
        element,
        position,
        halfWidth: size.width / 2,
        halfHeight: size.height / 2,
        offsetY: 0,
        visible: false,
        twin,
        twinVisible: false,
      };
    });
    this.placed = [...this.placed, ...added].sort((x, y) => x.rank - y.rank || x.priority - y.priority);
  }

  setVisible(visible: boolean): void {
    this.shown = visible;
    this.container.style.display = visible ? '' : 'none';
    if (this.rightEyeContainer) this.rightEyeContainer.style.display = visible && this.stereo ? '' : 'none';
  }

  /**
   * Split into a left-eye and a right-eye half. While on, `update` takes
   * the eye viewport's size and the right-eye camera.
   */
  setStereo(on: boolean): void {
    this.stereo = on;
    if (on && !this.rightEyeContainer) {
      const right = document.createElement('div');
      right.className = 'place-labels place-labels--right-eye';
      for (const placed of this.placed) {
        placed.twin = placed.element.cloneNode(true) as HTMLElement;
        placed.twin.style.display = 'none';
        right.appendChild(placed.twin);
      }
      this.container.after(right);
      this.rightEyeContainer = right;
    }
    this.container.classList.toggle('place-labels--left-eye', on);
    this.setVisible(this.shown);
  }

  /** Show or hide every label of these kinds; takes effect at the next update. */
  setKindsVisible(kinds: readonly LabelKind[], visible: boolean): void {
    for (const kind of kinds) {
      if (visible) this.hiddenKinds.delete(kind);
      else this.hiddenKinds.add(kind);
    }
  }

  /**
   * Add a lazy layer's labels. They join the same declutter pass at the
   * group's rank, and stay until the returned handle removes them.
   */
  addGroup(spec: LabelGroupSpec): LabelGroup {
    const state: GroupState = { frame: spec.frame, visible: true };
    const style = spec.style;
    const em = style.wide ? COUNTRY_GLYPH_WIDTH_EM : GLYPH_WIDTH_EM;
    const added: PlacedLabel[] = spec.labels.map((label) => {
      const element = document.createElement('div');
      element.className = 'place-label';
      element.textContent = label.text;
      element.style.display = 'none';
      element.style.fontSize = `${style.fontPx}px`;
      element.style.color = style.color;
      if (style.italic) element.style.fontStyle = 'italic';
      if (style.bold) element.style.fontWeight = '600';
      if (style.wide) {
        element.style.letterSpacing = '0.12em';
        element.style.textTransform = 'uppercase';
      }
      this.container.appendChild(element);
      let twin: HTMLElement | null = null;
      if (this.rightEyeContainer) {
        twin = element.cloneNode(true) as HTMLElement;
        this.rightEyeContainer.appendChild(twin);
      }
      return {
        label: null,
        group: state,
        name: label.text,
        rank: spec.rank,
        priority: label.priority,
        element,
        position: label.position,
        halfWidth: (label.text.length * style.fontPx * em + LABEL_PADDING_PX) / 2,
        halfHeight: (style.fontPx * 1.3 + LABEL_PADDING_PX) / 2,
        offsetY: style.offsetYPx ?? 0,
        visible: false,
        twin,
        twinVisible: false,
      };
    });
    // Stable sort keeps every existing label's order among its equals.
    this.placed = [...this.placed, ...added].sort((a, b) => a.rank - b.rank || a.priority - b.priority);
    const mine = new Set(added);
    return {
      setVisible: (visible) => {
        state.visible = visible;
      },
      remove: () => {
        for (const placed of mine) {
          placed.element.remove();
          placed.twin?.remove();
        }
        this.placed = this.placed.filter((placed) => !mine.has(placed));
      },
    };
  }

  /** Names currently shown, in placement order. Instrumentation for tests and the harness. */
  visibleNames(): string[] {
    return this.placed.filter((p) => p.visible).map((p) => p.name);
  }

  /** Where a placed label's point is in the world, written into `this.view`. */
  private worldPoint(placed: PlacedLabel, camera: THREE.Camera): THREE.Vector3 {
    if (placed.group?.frame === 'sky') {
      return this.view
        .copy(placed.position)
        .applyMatrix4(this.skyRotation)
        .multiplyScalar(SKY_LABEL_DISTANCE_M)
        .add(camera.position);
    }
    return this.view.copy(placed.position);
  }

  /**
   * Place labels for this frame's camera, in a viewport of CSS size
   * width×height. In stereo, `camera` is the left eye, the viewport is one
   * eye's, and `rightEye` places the twins. `skyRotation` turns ICRS
   * directions into the world's (ECEF) for groups on the sky.
   */
  update(
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
    rightEye?: THREE.PerspectiveCamera,
    skyRotation?: THREE.Matrix4
  ): void {
    camera.updateMatrixWorld();
    if (skyRotation) this.skyRotation.copy(skyRotation);
    this.boxes.length = 0;
    let shown = 0;

    for (const placed of this.placed) {
      let show = false;
      let x = 0;
      let y = 0;
      const enabled = placed.label ? !this.hiddenKinds.has(placed.label.kind) : placed.group!.visible;
      if (shown < MAX_VISIBLE_LABELS && enabled) {
        this.worldPoint(placed, camera).applyMatrix4(camera.matrixWorldInverse);
        // Camera looks down -Z: anything at z >= 0 is behind the viewer.
        if (this.view.z < 0) {
          this.view.applyMatrix4(camera.projectionMatrix);
          x = (this.view.x * 0.5 + 0.5) * width;
          y = (0.5 - this.view.y * 0.5) * height + placed.offsetY;
          show =
            x + placed.halfWidth > 0 &&
            x - placed.halfWidth < width &&
            y + placed.halfHeight > 0 &&
            y - placed.halfHeight < height &&
            !this.overlapsPlaced(x, y, placed.halfWidth, placed.halfHeight);
        }
      }

      if (show) {
        this.boxes.push(x - placed.halfWidth, y - placed.halfHeight, x + placed.halfWidth, y + placed.halfHeight);
        placed.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
        shown++;
      }
      if (show !== placed.visible) {
        placed.element.style.display = show ? '' : 'none';
        placed.visible = show;
      }
      if (this.stereo && rightEye && placed.twin) this.placeTwin(placed, placed.twin, show, rightEye, width, height);
    }
  }

  /** The right eye's copy of a label the left eye placed; hidden if that eye cannot see the point. */
  private placeTwin(
    placed: PlacedLabel,
    twin: HTMLElement,
    leftShows: boolean,
    rightEye: THREE.PerspectiveCamera,
    width: number,
    height: number
  ): void {
    let show = false;
    if (leftShows) {
      this.worldPoint(placed, rightEye).applyMatrix4(rightEye.matrixWorldInverse);
      if (this.view.z < 0) {
        this.view.applyMatrix4(rightEye.projectionMatrix);
        const x = (this.view.x * 0.5 + 0.5) * width;
        const y = (0.5 - this.view.y * 0.5) * height + placed.offsetY;
        twin.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
        show = true;
      }
    }
    if (show !== placed.twinVisible) {
      twin.style.display = show ? '' : 'none';
      placed.twinVisible = show;
    }
  }

  private overlapsPlaced(x: number, y: number, halfWidth: number, halfHeight: number): boolean {
    const left = x - halfWidth;
    const top = y - halfHeight;
    const right = x + halfWidth;
    const bottom = y + halfHeight;
    for (let i = 0; i < this.boxes.length; i += 4) {
      if (left < this.boxes[i + 2] && right > this.boxes[i] && top < this.boxes[i + 3] && bottom > this.boxes[i + 1]) {
        return true;
      }
    }
    return false;
  }

  dispose(): void {
    this.container.remove();
    this.rightEyeContainer?.remove();
  }
}
