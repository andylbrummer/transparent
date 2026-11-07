/**
 * Side-by-side stereo for a Cardboard-style viewer: the phone's screen
 * split into a left and a right eye, each rendered from its own camera.
 *
 * Real eyes 6.4 cm apart see no depth in a planet - the nearest feature
 * under the far-side surface is thousands of km off - so the eyes are set
 * hyperstereo, CARDBOARD_BASELINE_M apart, the way a stereo aerial photo
 * is taken from two points far apart. The eyes toe in to meet at
 * CARDBOARD_CONVERGENCE_M, so content near that distance sits at the
 * screen, the far side of the planet behind it, and the slabs and plumes
 * under the near horizon in front (disparityRad): about −0.4° at the
 * antipode and +1.7° at 1000 km; surface lines much
 * closer than that double, which is the price of seeing the interior in
 * depth.
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

/** Angle each eye turns inward so the eyes' axes cross at `convergenceM`. */
export function toeInRad(baselineM: number, convergenceM: number): number {
  return Math.atan(baselineM / 2 / convergenceM);
}

/** Angular disparity (radians, positive = in front of the screen) of a point `distanceM` away. */
export function disparityRad(distanceM: number, baselineM = CARDBOARD_BASELINE_M, convergenceM = CARDBOARD_CONVERGENCE_M): number {
  return 2 * (Math.atan(baselineM / 2 / distanceM) - toeInRad(baselineM, convergenceM));
}

export class StereoRig {
  readonly left = new THREE.PerspectiveCamera(CARDBOARD_FOV_DEG, 1, 0.1, 1e9);
  readonly right = new THREE.PerspectiveCamera(CARDBOARD_FOV_DEG, 1, 0.1, 1e9);
  private readonly offset = new THREE.Vector3();
  private readonly toeIn = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly baselineM = CARDBOARD_BASELINE_M,
    private readonly convergenceM = CARDBOARD_CONVERGENCE_M
  ) {
    this.left.name = 'left-eye';
    this.right.name = 'right-eye';
  }

  /** Place both eyes either side of the head camera, for eye viewports eyeWidth×height CSS px. */
  update(head: THREE.PerspectiveCamera, eyeWidth: number, height: number): void {
    const toeIn = toeInRad(this.baselineM, this.convergenceM);
    for (const [eye, side] of [
      [this.left, -1],
      [this.right, 1],
    ] as const) {
      // Camera-local +x is the head's right; local +y its up, so turning about it toes the eye in.
      this.offset.set((side * this.baselineM) / 2, 0, 0).applyQuaternion(head.quaternion);
      eye.position.copy(head.position).add(this.offset);
      this.toeIn.setFromAxisAngle(this.up, side * toeIn);
      eye.quaternion.copy(head.quaternion).multiply(this.toeIn);
      const aspect = eyeWidth / height;
      if (eye.aspect !== aspect || eye.near !== head.near || eye.far !== head.far) {
        eye.aspect = aspect;
        eye.near = head.near;
        eye.far = head.far;
        eye.updateProjectionMatrix();
      }
      eye.updateMatrixWorld();
    }
  }

  /**
   * Draw `scene` once per eye into its half of the canvas. `beforeEye` runs
   * first for each, for state that follows the camera (the globe's rays).
   */
  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    width: number,
    height: number,
    beforeEye: (eye: THREE.PerspectiveCamera) => void
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
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
  }
}
