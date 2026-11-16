import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SPYGLASS_DEG } from '../ui/spyglass';
import { CARDBOARD_FOV_DEG, StereoRig } from './stereo';
import { lensRadiusPx, projectDirection } from './spyglass-lens';

function headCamera(): THREE.PerspectiveCamera {
  const head = new THREE.PerspectiveCamera(60, 1, 0.1, 1e9);
  head.position.set(0, 0, 6_371_000);
  head.lookAt(1, 0, 6_371_000);
  head.updateMatrixWorld();
  return head;
}

describe('projectDirection', () => {
  it("puts a direction where each eye's projection puts a point far along it", () => {
    const rig = new StereoRig();
    const head = headCamera();
    rig.update(head, 600, 1080, 400);
    const direction = new THREE.Vector3(1, 0.1, 0.05).normalize();
    for (const eye of [rig.left, rig.right]) {
      const ndc = new THREE.Vector2();
      expect(projectDirection(eye, direction, ndc)).toBe(true);
      // Far enough that the 40 km baseline is nothing; within the far plane.
      const far = direction.clone().multiplyScalar(5e8).add(eye.position).project(eye);
      expect(ndc.x).toBeCloseTo(far.x, 3);
      expect(ndc.y).toBeCloseTo(far.y, 3);
    }
  });

  it('reports a direction behind the eye', () => {
    const head = headCamera();
    expect(projectDirection(head, new THREE.Vector3(-1, 0, 0), new THREE.Vector2())).toBe(false);
  });
});

describe('lensRadiusPx', () => {
  it('spans SPYGLASS_DEG of the eye: the tangent of its half over that of the half field', () => {
    const rig = new StereoRig();
    rig.update(headCamera(), 600, 1080, 400);
    const expected = (Math.tan(THREE.MathUtils.degToRad(SPYGLASS_DEG / 2)) / Math.tan(THREE.MathUtils.degToRad(CARDBOARD_FOV_DEG / 2))) * 540;
    expect(lensRadiusPx(rig.left, 1080)).toBeCloseTo(expected, 6);
  });
});
