/**
 * The way to a look that waits on the user (ViewControl.awaitedGaze): an
 * arrow at the edge of the view while the target is out of sight, with its
 * name, how far and which way; a ring on it once it can be seen, closing
 * while the user holds it at the centre. The pointer only points: it never
 * turns the view.
 *
 * "Can be seen" means inside the clear area: beneath the compass bar, above
 * a guide's play bar and within the safe area. A target under the bar projects onto the screen
 * and is still hidden, so it gets the arrow.
 *
 * In Cardboard the pointer is drawn once per eye, through each eye's camera so the two fuse (spec/guides.md §6.2):
 * a ring on a target within STEREO_ARROW_DEG of the centre, and otherwise an arrow that far from the centre, not at
 * the screen's edge, which the lenses blur. AR hides it; arrival is still counted there.
 */

import * as THREE from 'three';
import type { AwaitedGaze } from './actions';
import { targetKey } from './targets';
import { ARRIVE_DEG } from './view-control';

/** The part of the viewport nothing fixed covers, in viewport CSS px. */
export interface ClearArea {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Where the pointer goes this frame. Positions are CSS px from the clear area's top left. */
export type PointerPlacement =
  /** The target can be seen: a ring on it. */
  | { readonly kind: 'ring'; readonly xPx: number; readonly yPx: number }
  /** It cannot: an arrow at the clear area's edge, on the shortest turn toward it. */
  | {
      readonly kind: 'arrow';
      readonly xPx: number;
      readonly yPx: number;
      /** The edge the arrow sits on: its text is laid inward from there. */
      readonly edge: 'left' | 'right' | 'top' | 'bottom';
      /** The arrow's heading on screen, clockwise from straight up. */
      readonly turnRad: number;
      /** The turn in a word, for the text. */
      readonly way: 'left' | 'right' | 'up' | 'down';
      /** Angle from the view's centre to the target. */
      readonly offCentreDeg: number;
    };

/** The ring's radius and its border: a ring this far inside the clear area is not cut by its edge. */
export const RING_CLEAR_PX = 28;
/** How far inside the clear area's edge the arrow sits. */
export const EDGE_INSET_PX = 12;
/** Half the width of an arrow's text, about: an arrow on the top or bottom edge keeps this far from a corner, so its centred text stays on screen. */
const ARROW_TEXT_HALF_PX = 110;
/** The name sits this far above the ring's centre: a mark's text hangs under its ring, so the two do not overlap. */
const NAME_LIFT_PX = 30;

/** Where the arrow's box is anchored on its point, by edge, so its glyph is at the edge and its text inward. */
const ARROW_ANCHOR: Readonly<Record<'left' | 'right' | 'top' | 'bottom', string>> = {
  right: 'translate(-100%, -50%)',
  left: 'translate(0, -50%)',
  top: 'translate(-50%, 0)',
  bottom: 'translate(-50%, -100%)',
};

/** In Cardboard, how far from the view's centre the arrow sits; a target nearer than this gets the ring. */
export const STEREO_ARROW_DEG = 20;
/** In Cardboard, the edge an arrow's anchor takes from its way: the glyph outward, the text toward the centre. */
const WAY_EDGE: Readonly<Record<'left' | 'right' | 'up' | 'down', 'left' | 'right' | 'top' | 'bottom'>> = {
  left: 'left',
  right: 'right',
  up: 'top',
  down: 'bottom',
};

const AHEAD = new THREE.Vector3(0, 0, -1);
const inCamera = new THREE.Vector3();
const projected = new THREE.Vector3();
const atArrow = new THREE.Vector3();

/**
 * Where the pointer to the world direction `direction` goes for `camera`,
 * in a viewport `width` by `height` CSS px whose uncovered part is `clear`.
 */
export function placePointer(
  camera: THREE.PerspectiveCamera,
  direction: THREE.Vector3,
  width: number,
  height: number,
  clear: ClearArea
): PointerPlacement {
  camera.updateMatrixWorld();
  // A direction, not a point: the camera's position does not enter.
  const d = inCamera.copy(direction).transformDirection(camera.matrixWorldInverse);
  if (d.z < 0) {
    // The perspective divide does not care about length, so a direction projects as a point would.
    projected.copy(d).applyMatrix4(camera.projectionMatrix);
    const x = ((projected.x + 1) / 2) * width;
    const y = ((1 - projected.y) / 2) * height;
    if (
      x >= clear.left + RING_CLEAR_PX &&
      x <= clear.left + clear.width - RING_CLEAR_PX &&
      y >= clear.top + RING_CLEAR_PX &&
      y <= clear.top + clear.height - RING_CLEAR_PX
    ) {
      return { kind: 'ring', xPx: x - clear.left, yPx: y - clear.top };
    }
  }
  // On screen, y down. Straight behind, every way is as far: take the right.
  const across = Math.hypot(d.x, d.y);
  const ux = across < 1e-9 ? 1 : d.x / across;
  const uy = across < 1e-9 ? 0 : -d.y / across;
  // From the clear area's centre along u to the inset edge; a zero component gives Infinity, which min passes over.
  const tx = (clear.width / 2 - EDGE_INSET_PX) / Math.abs(ux);
  const ty = (clear.height / 2 - EDGE_INSET_PX) / Math.abs(uy);
  const t = Math.min(tx, ty);
  return {
    kind: 'arrow',
    xPx: clear.width / 2 + ux * t,
    yPx: clear.height / 2 + uy * t,
    edge: tx <= ty ? (ux > 0 ? 'right' : 'left') : uy > 0 ? 'bottom' : 'top',
    turnRad: Math.atan2(ux, -uy),
    // The edge and the way may differ: up and to the right on a tall screen meets the side edge, and says up.
    way: Math.abs(ux) >= Math.abs(uy) ? (ux > 0 ? 'right' : 'left') : uy < 0 ? 'up' : 'down',
    offCentreDeg: THREE.MathUtils.radToDeg(d.angleTo(AHEAD)),
  };
}

/**
 * Where the pointer to `direction` goes in one eye of Cardboard, for that eye's camera, in its viewport
 * `eyeWidth` by `height` CSS px: a ring on a target within STEREO_ARROW_DEG of the centre, otherwise an arrow that far
 * from the centre on the shortest turn. Both come through the eye's own projection, frustum shift and all, so the
 * two eyes' marks fuse into one.
 */
export function placeStereoPointer(camera: THREE.PerspectiveCamera, direction: THREE.Vector3, eyeWidth: number, height: number): PointerPlacement {
  camera.updateMatrixWorld();
  const d = inCamera.copy(direction).transformDirection(camera.matrixWorldInverse);
  const offCentreDeg = THREE.MathUtils.radToDeg(d.angleTo(AHEAD));
  if (offCentreDeg <= STEREO_ARROW_DEG) {
    projected.copy(d).applyMatrix4(camera.projectionMatrix);
    return { kind: 'ring', xPx: ((projected.x + 1) / 2) * eyeWidth, yPx: ((1 - projected.y) / 2) * height };
  }
  // Camera space has y up; the screen, y down.
  const across = Math.hypot(d.x, d.y);
  const ux = across < 1e-9 ? 1 : d.x / across;
  const uy = across < 1e-9 ? 0 : -d.y / across;
  const r = STEREO_ARROW_DEG * THREE.MathUtils.DEG2RAD;
  projected.copy(atArrow.set(Math.sin(r) * ux, -Math.sin(r) * uy, -Math.cos(r))).applyMatrix4(camera.projectionMatrix);
  const x = ((projected.x + 1) / 2) * eyeWidth;
  const y = ((1 - projected.y) / 2) * height;
  const way = Math.abs(ux) >= Math.abs(uy) ? (ux > 0 ? 'right' : 'left') : uy < 0 ? 'up' : 'down';
  return { kind: 'arrow', xPx: x, yPx: y, edge: WAY_EDGE[way], turnRad: Math.atan2(ux, -uy), way, offCentreDeg };
}

/** What a screen reader hears when the pointer goes up. */
function lookText(placement: PointerPlacement, name: string | null): string {
  if (placement.kind === 'ring') return name ? `Look for ${name}` : 'Look at the ring';
  const turn = `${Math.round(placement.offCentreDeg)}° ${placement.way}`;
  return name ? `Look for ${name}, ${turn}` : `Look ${turn}`;
}

function setShown(element: HTMLElement, shown: boolean): void {
  const display = shown ? '' : 'none';
  if (element.style.display !== display) element.style.display = display;
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

/** One eye's marks: the arrow with its text and glyph, the ring and the ring's name. */
class EyeMarks {
  readonly arrow: HTMLElement;
  readonly arrowText: HTMLElement;
  readonly glyph: HTMLElement;
  readonly ring: HTMLElement;
  readonly name: HTMLElement;

  constructor(root: HTMLElement) {
    const doc = root.ownerDocument;
    this.arrow = doc.createElement('div');
    this.arrow.className = 'gaze-pointer__arrow';
    this.arrowText = doc.createElement('span');
    this.arrowText.className = 'gaze-pointer__text';
    this.glyph = doc.createElement('span');
    this.glyph.className = 'gaze-pointer__glyph';
    this.glyph.textContent = '▲';
    this.arrow.append(this.arrowText, this.glyph);
    this.ring = doc.createElement('div');
    this.ring.className = 'gaze-pointer__ring';
    this.name = doc.createElement('div');
    this.name.className = 'gaze-pointer__name';
    // Their text changes every frame as the user turns; a reader hears the status instead.
    for (const element of [this.arrow, this.ring, this.name]) {
      element.style.display = 'none';
      element.setAttribute('aria-hidden', 'true');
    }
    root.append(this.arrow, this.ring, this.name);
  }

  hide(): void {
    setShown(this.arrow, false);
    setShown(this.ring, false);
    setShown(this.name, false);
  }

  /**
   * Show `placement`, its positions offset by `leftPx` (the eye's viewport, in stereo). `clampWidth` keeps an arrow on
   * the top or bottom edge far enough from a corner that its centred text stays on screen; null leaves it where it is.
   */
  show(placement: PointerPlacement, gaze: AwaitedGaze, leftPx: number, clampWidth: number | null): void {
    if (placement.kind === 'arrow') {
      setShown(this.ring, false);
      setShown(this.name, false);
      setShown(this.arrow, true);
      this.arrow.dataset.edge = placement.edge;
      const turn = `${Math.round(placement.offCentreDeg)}° ${placement.way}`;
      setText(this.arrowText, gaze.name ? `${gaze.name} · ${turn}` : turn);
      this.glyph.style.transform = `rotate(${placement.turnRad}rad)`;
      let x = placement.xPx;
      if (clampWidth !== null && (placement.edge === 'top' || placement.edge === 'bottom')) {
        const margin = Math.min(ARROW_TEXT_HALF_PX, clampWidth / 2);
        x = Math.min(Math.max(x, margin), clampWidth - margin);
      }
      this.arrow.style.transform = `translate(${leftPx + x}px, ${placement.yPx}px) ${ARROW_ANCHOR[placement.edge]}`;
    } else {
      setShown(this.arrow, false);
      setShown(this.ring, true);
      const x = leftPx + placement.xPx;
      // The ring closes as the user holds the target at the centre.
      this.ring.style.transform = `translate(${x}px, ${placement.yPx}px) scale(${1 - 0.5 * gaze.arriving})`;
      setShown(this.name, gaze.name !== null);
      if (gaze.name !== null) {
        setText(this.name, gaze.name);
        this.name.style.transform = `translate(${x}px, ${placement.yPx - NAME_LIFT_PX}px) translate(-50%, -100%)`;
      }
    }
  }
}

/** The two eyes' cameras and the viewport each draws into, in Cardboard. */
export interface StereoEyes {
  readonly left: THREE.PerspectiveCamera;
  readonly right: THREE.PerspectiveCamera;
  /** Changes with the screen; kept in one object the caller reuses, so a frame allocates nothing. */
  eyeWidth: number;
}

export class GazePointer {
  private readonly root: HTMLElement;
  /** The left eye's marks, the only ones on one screen, and the right eye's. */
  private readonly eyes: readonly [EyeMarks, EyeMarks];
  private readonly status: HTMLElement;
  private readonly forward = new THREE.Vector3();
  private visible = true;
  private clear: ClearArea = { left: 0, top: 0, width: 0, height: 0 };
  /**
   * The viewport size and the page's classes the clear area was measured at: measuring every frame would force a
   * layout every frame. A class on the body can move what covers the view, as a guide's play bar does at the foot.
   */
  private measuredKey = '';
  /** The look the status last announced, so it is announced once: its key, its name and where it is. */
  private announced: { readonly key: string; readonly name: string | null; readonly direction: THREE.Vector3 } | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'gaze-pointer';
    this.eyes = [new EyeMarks(this.root), new EyeMarks(this.root)];
    this.status = document.createElement('div');
    this.status.className = 'gaze-pointer__status';
    this.status.setAttribute('role', 'status');
    this.root.append(this.status);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.style.display = visible ? '' : 'none';
    // Hidden, there is no pointer to have announced: its instruction is taken back, and a look still waiting
    // when it is shown again is announced again. Emptying a live region reads nothing out.
    if (!visible && this.announced) {
      this.announced = null;
      this.status.textContent = '';
    }
  }

  /**
   * Show the way to `gaze` for this frame, in a viewport `width` by `height` CSS px; nothing for null. On one screen
   * through `camera`; in Cardboard, given `stereo`, once per eye through each eye's camera.
   */
  update(gaze: AwaitedGaze | null, camera: THREE.PerspectiveCamera, width: number, height: number, stereo: StereoEyes | null = null): void {
    if (!this.visible) return;
    this.root.classList.toggle('gaze-pointer--stereo', stereo !== null);
    const key = `${width}:${height}:${this.root.ownerDocument.body.className}`;
    if (key !== this.measuredKey) {
      this.measuredKey = key;
      const box = this.root.getBoundingClientRect();
      this.clear = { left: box.left, top: box.top, width: box.width, height: box.height };
    }
    if (!gaze) {
      this.eyes[0].hide();
      this.eyes[1].hide();
      this.announceEnd(camera);
      return;
    }
    let placement: PointerPlacement;
    if (stereo) {
      placement = placeStereoPointer(stereo.left, gaze.direction, stereo.eyeWidth, height);
      this.eyes[0].show(placement, gaze, 0, null);
      this.eyes[1].show(placeStereoPointer(stereo.right, gaze.direction, stereo.eyeWidth, height), gaze, stereo.eyeWidth, null);
    } else {
      placement = placePointer(camera, gaze.direction, width, height, this.clear);
      this.eyes[0].show(placement, gaze, 0, this.clear.width);
      this.eyes[1].hide();
    }
    this.announceStart(gaze, placement);
  }

  dispose(): void {
    this.root.remove();
  }

  /** Say once that the pointer is up for a look; the degrees that change as the user turns are not read out. */
  private announceStart(gaze: AwaitedGaze, placement: PointerPlacement): void {
    const key = targetKey(gaze.target);
    if (this.announced?.key === key) return;
    this.announced = { key, name: gaze.name, direction: gaze.direction };
    this.status.textContent = lookText(placement, gaze.name);
  }

  /**
   * Say the user found the look's target, when they did. Null does not say
   * why the look ended: one that arrived has its target beside the view's
   * centre, and one given up on (stopAwaitingGaze) most likely does not.
   * Telling them apart here keeps ViewControl's interface as it is.
   */
  private announceEnd(camera: THREE.PerspectiveCamera): void {
    if (!this.announced) return;
    const { name, direction } = this.announced;
    this.announced = null;
    const found = THREE.MathUtils.radToDeg(camera.getWorldDirection(this.forward).angleTo(direction)) <= ARRIVE_DEG;
    // Given up on, the instruction no longer holds: it is taken back, not left to be read later.
    this.status.textContent = found ? (name ? `Found ${name}` : 'Found it') : '';
  }
}
