/**
 * Names through the see-through Earth, the way a sky map names stars:
 * places on the far-side surface, and geology - plates, hotspots,
 * subduction zones, volcanoes, and deep structures at their depth.
 *
 * Labels are screen-aligned DOM text, so they stay readable however
 * foreshortened the land beneath them is. Each frame they are placed in
 * rank order - by kind (LABEL_KIND_ORDER), then by each source's own
 * priority - and a label overlapping one already placed is hidden, so the
 * broader names win wherever the view is crowded.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';

export type LabelKind = 'country' | 'state' | 'city' | 'plate' | 'deep' | 'hotspot' | 'subduction' | 'volcano';

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

/** The shape of app/public/geo/labels.json and geology.json. */
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

interface PlacedLabel {
  readonly label: PlaceLabel;
  readonly element: HTMLElement;
  readonly position: THREE.Vector3;
  readonly halfWidth: number;
  readonly halfHeight: number;
  visible: boolean;
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

export class LabelLayer {
  private readonly container: HTMLElement;
  private readonly placed: PlacedLabel[];
  private readonly view = new THREE.Vector3();
  private readonly boxes: number[] = [];

  /** Takes every label source at once; ranks them together by LABEL_KIND_ORDER. */
  constructor(parent: HTMLElement, sources: readonly LabelData[]) {
    this.container = document.createElement('div');
    this.container.className = 'place-labels';
    this.placed = rankLabels(sources.flatMap((source) => source.labels)).map((label) => {
      const element = document.createElement('div');
      element.className = `place-label place-label--${label.kind}`;
      element.textContent = labelText(label);
      element.style.display = 'none';
      this.container.appendChild(element);
      const lonRad = (label.lon * Math.PI) / 180;
      const latRad = (label.lat * Math.PI) / 180;
      const radius = EARTH_RADIUS_M - (label.depthKm ?? 0) * 1000;
      const position = new THREE.Vector3(
        radius * Math.cos(latRad) * Math.cos(lonRad),
        radius * Math.cos(latRad) * Math.sin(lonRad),
        radius * Math.sin(latRad)
      );
      const size = estimateLabelSize(label);
      return { label, element, position, halfWidth: size.width / 2, halfHeight: size.height / 2, visible: false };
    });
    parent.appendChild(this.container);
  }

  setVisible(visible: boolean): void {
    this.container.style.display = visible ? '' : 'none';
  }

  /** Names currently shown, in placement order. Instrumentation for tests and the harness. */
  visibleNames(): string[] {
    return this.placed.filter((p) => p.visible).map((p) => p.label.name);
  }

  /** Place labels for this frame's camera, in a viewport of CSS size width×height. */
  update(camera: THREE.PerspectiveCamera, width: number, height: number): void {
    camera.updateMatrixWorld();
    this.boxes.length = 0;
    let shown = 0;

    for (const placed of this.placed) {
      let show = false;
      let x = 0;
      let y = 0;
      if (shown < MAX_VISIBLE_LABELS) {
        this.view.copy(placed.position).applyMatrix4(camera.matrixWorldInverse);
        // Camera looks down -Z: anything at z >= 0 is behind the viewer.
        if (this.view.z < 0) {
          this.view.applyMatrix4(camera.projectionMatrix);
          x = (this.view.x * 0.5 + 0.5) * width;
          y = (0.5 - this.view.y * 0.5) * height;
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
  }
}
