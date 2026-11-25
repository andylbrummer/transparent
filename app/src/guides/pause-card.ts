/**
 * The pause card (spec/guides.md §11): in Cardboard, a paused guide puts up Back, Resume and Next, with Leave beneath,
 * in the scene where the wearer was looking when it paused, and each is chosen by looking at it for DWELL_MS. It is
 * not a standing menu: it is up only while the guide is paused in the viewer.
 *
 * Fixed on the scene, not the head, so the wearer can look from one choice to another. Drawn once per eye through
 * each eye's camera, so the two copies fuse. Nothing is chosen until the view has first left every choice: the card
 * opens with Resume under the gaze, and must not resume at once.
 */

import * as THREE from 'three';

export type PauseChoice = 'back' | 'resume' | 'next' | 'leave';

/** Looking at a choice this long chooses it: the spyglass's stare, which must not fire by accident either. */
export const PAUSE_DWELL_MS = 1200;
/** A choice is under the gaze within this of its centre: the choices stand CHOICE_SPACING_DEG apart. */
export const PAUSE_CAPTURE_DEG = 7;
/**
 * How far apart the choices stand, degrees, from where the wearer was looking. The viewer shows about 4.7 px a degree
 * across an eye, so this keeps a choice about 100 px from the next, clear of its neighbour's box.
 */
export const CHOICE_SPACING_DEG = 22;

/** Each choice, its words and where it stands from the view's centre at the pause: degrees right and up. */
const CHOICES: readonly { readonly choice: PauseChoice; readonly label: string; readonly rightDeg: number; readonly upDeg: number }[] = [
  { choice: 'back', label: 'Back', rightDeg: -CHOICE_SPACING_DEG, upDeg: 0 },
  { choice: 'resume', label: 'Resume', rightDeg: 0, upDeg: 0 },
  { choice: 'next', label: 'Next', rightDeg: CHOICE_SPACING_DEG, upDeg: 0 },
  { choice: 'leave', label: 'Leave', rightDeg: 0, upDeg: -0.7 * CHOICE_SPACING_DEG },
];

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const inCamera = new THREE.Vector3();

export class PauseCard {
  private readonly root: HTMLElement;
  /** Per eye, one element per choice, in CHOICES order. */
  private readonly items: readonly (readonly HTMLElement[])[];
  /** Where each choice stands, world unit vectors, set at open. */
  private readonly directions = CHOICES.map(() => new THREE.Vector3());
  private open_ = false;
  /** Whether the view has left every choice since the card opened. */
  private armed = false;
  /** The choice under the gaze and how long it has been there. */
  private under: number | null = null;
  private heldMs = 0;
  /** The dwell each item shows, so a frame that changes nothing leaves the page alone. */
  private shownDwell = CHOICES.map(() => 0);

  constructor(parent: HTMLElement) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'pause-card';
    this.root.hidden = true;
    // The guide's notice says it is paused, as a live region; the card is for looking at.
    this.root.setAttribute('aria-hidden', 'true');
    this.items = [0, 1].map(() =>
      CHOICES.map(({ choice, label }) => {
        const item = doc.createElement('div');
        item.className = 'pause-card__item';
        item.dataset.choice = choice;
        item.textContent = label;
        this.root.appendChild(item);
        return item;
      })
    );
    parent.appendChild(this.root);
  }

  isOpen(): boolean {
    return this.open_;
  }

  /** Put the card up where `head` looks now. */
  open(head: THREE.Camera): void {
    head.updateMatrixWorld();
    head.getWorldDirection(forward);
    right.set(1, 0, 0).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()));
    up.crossVectors(right, forward);
    CHOICES.forEach(({ rightDeg, upDeg }, i) => {
      this.directions[i]
        .copy(forward)
        .addScaledVector(right, Math.tan(THREE.MathUtils.degToRad(rightDeg)))
        .addScaledVector(up, Math.tan(THREE.MathUtils.degToRad(upDeg)))
        .normalize();
    });
    this.open_ = true;
    this.armed = false;
    this.under = null;
    this.heldMs = 0;
    this.root.hidden = false;
  }

  close(): void {
    this.open_ = false;
    this.root.hidden = true;
    this.under = null;
    this.heldMs = 0;
    this.showDwell(null, 0);
  }

  /** One frame with the head looking along `headForward`: the choice made, once a dwell completes; else null. */
  update(headForward: THREE.Vector3, deltaMs: number): PauseChoice | null {
    if (!this.open_) return null;
    let under: number | null = null;
    for (let i = 0; i < this.directions.length; i++) {
      if (THREE.MathUtils.radToDeg(headForward.angleTo(this.directions[i])) <= PAUSE_CAPTURE_DEG) under = i;
    }
    if (!this.armed) {
      if (under === null) this.armed = true;
      return null;
    }
    this.heldMs = under !== null && under === this.under ? this.heldMs + deltaMs : 0;
    this.under = under;
    this.showDwell(under, Math.min(1, this.heldMs / PAUSE_DWELL_MS));
    if (under === null || this.heldMs < PAUSE_DWELL_MS) return null;
    const { choice } = CHOICES[under];
    this.close();
    return choice;
  }

  /** Place each eye's copy, through `left` and `right`, eye viewports `eyeWidth` by `height` CSS px side by side. */
  place(left: THREE.PerspectiveCamera, rightEye: THREE.PerspectiveCamera, eyeWidth: number, height: number): void {
    if (!this.open_) return;
    [left, rightEye].forEach((camera, eye) => {
      camera.updateMatrixWorld();
      this.items[eye].forEach((item, i) => {
        const d = inCamera.copy(this.directions[i]).transformDirection(camera.matrixWorldInverse);
        if (d.z >= 0) {
          item.style.display = 'none';
          return;
        }
        d.applyMatrix4(camera.projectionMatrix);
        const x = eye * eyeWidth + ((d.x + 1) / 2) * eyeWidth;
        const y = ((1 - d.y) / 2) * height;
        // Each eye's copy stays in its own half: past the middle it would be seen by the wrong eye.
        const inEye = x >= eye * eyeWidth && x <= (eye + 1) * eyeWidth;
        item.style.display = inEye ? '' : 'none';
        item.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      });
    });
  }

  dispose(): void {
    this.root.remove();
  }

  private showDwell(under: number | null, fraction: number): void {
    CHOICES.forEach((_, i) => {
      const dwell = i === under ? Math.round(fraction * 20) / 20 : 0;
      if (dwell === this.shownDwell[i]) return;
      this.shownDwell[i] = dwell;
      for (const eye of this.items) {
        eye[i].style.setProperty('--dwell', String(dwell));
        eye[i].classList.toggle('pause-card__item--under', i === under);
      }
    });
  }
}
