/**
 * Side-by-side stereo for a Cardboard-style viewer: the phone's screen
 * split into a left and a right eye, each rendered from its own camera.
 *
 * Real eyes 6.4 cm apart see no depth in a planet - the nearest feature
 * under the far-side surface is thousands of km off - so the eyes are set
 * hyperstereo, CARDBOARD_BASELINE_M apart, the way a stereo aerial photo
 * is taken from two points far apart. The eyes look parallel, and each
 * eye's frustum is shifted sideways so a point CARDBOARD_CONVERGENCE_M
 * straight ahead lands at the same spot in both: content near that
 * distance sits at the screen, the far side of the planet behind it, and
 * the slabs and plumes
 * under the near horizon in front (disparityRad): about −0.4° at the
 * antipode and +1.7° at 1000 km; surface lines much
 * closer than that double, which is the price of seeing the interior in
 * depth. A shifted frustum rather than toed-in eyes: toe-in tilts the
 * two image planes against each other, which puts a vertical mismatch in
 * the corners.
 *
 * Where that spot lands is the viewer's business, not the app's: it must
 * sit under each lens, so the two spots are the image spacing apart (CSS
 * px, set by calibration; see ui/cardboard-calibration). Spots wider apart
 * than the lenses make the eyes turn outward, and the views never merge.
 *
 * Built on plain WebGL viewports rather than a WebXR immersive session, so
 * it keeps the app's own compass, true-north correction and DOM labels.
 */

import * as THREE from 'three';

/** Eye separation in metres. Tunable: wider reads deeper but doubles more of the near view. */
export const CARDBOARD_BASELINE_M = 40_000;
/** Distance in metres where the two eyes' views coincide. */
export const CARDBOARD_CONVERGENCE_M = 4_000_000;
/** Vertical field of view per eye, about what a Cardboard lens spreads one half-screen over. */
export const CARDBOARD_FOV_DEG = 80;

/** Angle off each eye's axis at which the point `convergenceM` straight ahead of the head lies. */
export function convergenceHalfAngleRad(baselineM: number, convergenceM: number): number {
  return Math.atan(baselineM / 2 / convergenceM);
}

/** Angular disparity (radians, positive = in front of the screen) of a point `distanceM` away. */
export function disparityRad(distanceM: number, baselineM = CARDBOARD_BASELINE_M, convergenceM = CARDBOARD_CONVERGENCE_M): number {
  return 2 * (Math.atan(baselineM / 2 / distanceM) - convergenceHalfAngleRad(baselineM, convergenceM));
}

export class StereoRig {
  readonly left = new THREE.PerspectiveCamera(CARDBOARD_FOV_DEG, 1, 0.1, 1e9);
  readonly right = new THREE.PerspectiveCamera(CARDBOARD_FOV_DEG, 1, 0.1, 1e9);
  private readonly offset = new THREE.Vector3();

  constructor(
    private readonly baselineM = CARDBOARD_BASELINE_M,
    private readonly convergenceM = CARDBOARD_CONVERGENCE_M
  ) {
    this.left.name = 'left-eye';
    this.right.name = 'right-eye';
  }

  /**
   * Place both eyes either side of the head camera, at its height above the
   * ground, for eye viewports eyeWidth×height CSS px whose convergence spots
   * are `spacingPx` apart, centred on the middle of the screen.
   *
   * The head's right axis is a straight line, not the ground: half a
   * baseline along it, a roll of 0.1° puts the low eye under the surface,
   * where the globe draws the ground's underside in place of the sky. So
   * each eye is pulled back to the head's distance from the Earth's centre;
   * a rolled head only narrows the baseline, by cos(roll).
   */
  update(head: THREE.PerspectiveCamera, eyeWidth: number, height: number, spacingPx: number): void {
    const convergenceTan = Math.tan(convergenceHalfAngleRad(this.baselineM, this.convergenceM));
    // NDC distance, in either eye, from the middle of its viewport in to its convergence spot.
    const spotInset = 1 - spacingPx / eyeWidth;
    const headRadius = head.position.length();
    for (const [eye, side] of [
      [this.left, -1],
      [this.right, 1],
    ] as const) {
      // Camera-local +x is the head's right.
      this.offset.set((side * this.baselineM) / 2, 0, 0).applyQuaternion(head.quaternion);
      eye.position.copy(head.position).add(this.offset).setLength(headRadius);
      eye.quaternion.copy(head.quaternion);
      eye.aspect = eyeWidth / height;
      eye.near = head.near;
      eye.far = head.far;
      eye.updateProjectionMatrix();
      // Frustum shift: a view-space point maps to x_ndc = P0·x/(−z) − P8. The
      // convergence point (x = −side·baseline/2, −z = convergence) must land at
      // the spot, −side·spotInset, so P8 = side·(spotInset − P0·convergenceTan).
      const e = eye.projectionMatrix.elements;
      e[8] = side * (spotInset - e[0] * convergenceTan);
      eye.projectionMatrixInverse.copy(eye.projectionMatrix).invert();
      eye.updateMatrixWorld();
    }
  }

  /**
   * Draw `scene` once per eye into its half of the canvas. `beforeEye` runs
   * first for each, for state that follows the camera (the globe's rays);
   * `afterEye`, if given, draws over the eye's half (the spyglass).
   */
  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    width: number,
    height: number,
    beforeEye: (eye: THREE.PerspectiveCamera) => void,
    afterEye?: (eye: THREE.PerspectiveCamera, viewport: { x: number; y: number; width: number; height: number }) => void
  ): void {
    const eyeWidth = Math.floor(width / 2);
    renderer.setScissorTest(true);
    for (const [camera, x] of [
      [this.left, 0],
      [this.right, eyeWidth],
    ] as const) {
      renderer.setViewport(x, 0, eyeWidth, height);
      renderer.setScissor(x, 0, eyeWidth, height);
      beforeEye(camera);
      renderer.render(scene, camera);
      afterEye?.(camera, { x, y: 0, width: eyeWidth, height });
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
  }
}
