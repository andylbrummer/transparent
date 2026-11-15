/**
 * Cardboard calibration: the image spacing that puts each eye's picture
 * under its lens, set by tilting the head while looking through the viewer.
 *
 * The browser cannot say how far apart a viewer's lenses are, or how many
 * CSS px make a millimetre on this screen, so the spacing is found by eye:
 * look at a star, tilt right to widen the spacing and left to narrow it
 * until its two images merge, then tap the viewer's button to keep it. A
 * tilt inside the dead zone holds the spacing, so a level head can study
 * the result. The rate grows with the tilt: small tilts for the last pixel,
 * large ones to sweep.
 *
 * The spacing is kept per device, in this browser's storage: it belongs to
 * this phone in this viewer.
 */

import * as THREE from 'three';

export const CALIBRATING_BODY_CLASS = 'cardboard-calibrating';
export const CARDBOARD_SPACING_STORAGE_KEY = 'transparent.cardboard.spacingPx';

/**
 * Where calibration starts: 63 mm, a common Cardboard lens spacing, at the
 * 160 CSS px an inch that Android and iOS lay phones out at. Nominal only;
 * the point of calibrating is to replace it.
 */
export const NOMINAL_SPACING_PX = Math.round((63 / 25.4) * 160);
/** 44 – 89 mm at 160 CSS px an inch: wider than any viewer's lens range. */
export const SPACING_RANGE_PX: readonly [number, number] = [280, 560];
export const TILT_DEAD_ZONE_RAD = (5 * Math.PI) / 180;
/** 4 px/s for each degree of tilt past the dead zone. */
export const SPACING_RATE_PX_PER_S_PER_RAD = (4 * 180) / Math.PI;
/** Reached at 20° of tilt: the whole range in about five seconds. */
export const MAX_SPACING_RATE_PX_PER_S = 60;

/** The stored spacing, or the nominal one if none is stored. A stored value that is not a spacing is reported and set aside. */
export function loadSpacingPx(stored: string | null): number {
  if (stored === null) return NOMINAL_SPACING_PX;
  const value = Number(stored);
  if (!Number.isFinite(value) || value < SPACING_RANGE_PX[0] || value > SPACING_RANGE_PX[1]) {
    console.error(`cardboard: stored image spacing ${JSON.stringify(stored)} is not in ${SPACING_RANGE_PX.join('–')} px; starting from ${NOMINAL_SPACING_PX}`);
    return NOMINAL_SPACING_PX;
  }
  return value;
}

/**
 * Roll of the screen: positive when its right edge is raised. In Cardboard
 * the screen's right is the head's, so a head tilted to the right shoulder
 * reads negative.
 */
export function headRollRad(head: THREE.Camera, observerUp: THREE.Vector3): number {
  const right = scratchRight.set(1, 0, 0).applyQuaternion(head.quaternion);
  return Math.asin(THREE.MathUtils.clamp(right.dot(observerUp), -1, 1));
}
const scratchRight = new THREE.Vector3();

/** Rate of change of the spacing (px/s) for a head roll: a tilt to the right widens it. */
export function spacingRatePxPerS(rollRad: number): number {
  const past = Math.abs(rollRad) - TILT_DEAD_ZONE_RAD;
  if (past <= 0) return 0;
  return -Math.sign(rollRad) * Math.min(MAX_SPACING_RATE_PX_PER_S, past * SPACING_RATE_PX_PER_S_PER_RAD);
}

export class CardboardCalibration {
  private spacing: number;
  private readonly overlay: HTMLElement;
  private readonly readouts: HTMLElement[];

  constructor(
    parent: HTMLElement,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'>
  ) {
    this.spacing = loadSpacingPx(storage.getItem(CARDBOARD_SPACING_STORAGE_KEY));
    this.overlay = document.createElement('div');
    this.overlay.id = 'cardboard-calibration';
    // One readout per eye, each centred on its eye's convergence spot: merged, they are one.
    this.readouts = [0, 1].map(() => {
      const readout = document.createElement('div');
      readout.className = 'cardboard-calibration__readout';
      this.overlay.appendChild(readout);
      return readout;
    });
    parent.appendChild(this.overlay);
  }

  spacingPx(): number {
    return this.spacing;
  }

  /** Move the spacing for `deltaMs` of head roll, and place the readouts on a screen width×height CSS px. */
  update(rollRad: number, deltaMs: number, width: number, height: number): void {
    const next = this.spacing + (spacingRatePxPerS(rollRad) * deltaMs) / 1000;
    this.spacing = THREE.MathUtils.clamp(next, SPACING_RANGE_PX[0], Math.min(SPACING_RANGE_PX[1], width));
    const text = `${Math.round(this.spacing)} px · tilt to merge · tap to keep`;
    for (const [i, readout] of this.readouts.entries()) {
      const side = i === 0 ? -1 : 1;
      readout.textContent = text;
      readout.style.left = `${width / 2 + (side * this.spacing) / 2}px`;
      readout.style.top = `${height / 2}px`;
    }
  }

  /** Keep the spacing for this device. */
  save(): void {
    const value = String(Math.round(this.spacing));
    try {
      this.storage.setItem(CARDBOARD_SPACING_STORAGE_KEY, value);
    } catch (error) {
      console.error('cardboard: could not keep the image spacing', error);
    }
  }

  dispose(): void {
    this.overlay.remove();
  }
}
