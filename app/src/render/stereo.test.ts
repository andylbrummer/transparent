import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { EYE_HEIGHT_M } from '../input/look';
import { CARDBOARD_BASELINE_M, CARDBOARD_CONVERGENCE_M, StereoRig, disparityRad } from './stereo';

const DEG = 180 / Math.PI;

/** A head standing at the north pole, looking level along +x, rolled clockwise by `rollDeg`. */
function headCamera(rollDeg = 0): THREE.PerspectiveCamera {
  const head = new THREE.PerspectiveCamera(60, 2, 0.1, 1e9);
  head.position.set(0, 0, EARTH_RADIUS_M + EYE_HEIGHT_M);
  head.up.set(0, 0, 1);
  head.lookAt(1e6, 0, EARTH_RADIUS_M + EYE_HEIGHT_M);
  head.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -rollDeg / DEG));
  head.updateMatrixWorld();
  return head;
}

describe('disparityRad', () => {
  it('is zero where the eyes converge, crossed nearer and uncrossed beyond', () => {
    expect(disparityRad(CARDBOARD_CONVERGENCE_M)).toBeCloseTo(0, 12);
    expect(disparityRad(1_000_000) * DEG).toBeCloseTo(1.72, 2);
    // The antipode: the farthest the view ever reaches, gently behind the screen.
    expect(disparityRad(12_742_000) * DEG).toBeCloseTo(-0.39, 2);
  });
});

describe('StereoRig', () => {
  it('sets the eyes a baseline apart along the head right, toed in to meet at the convergence distance', () => {
    const head = headCamera();
    const rig = new StereoRig();
    rig.update(head, 600, 1080);

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(head.quaternion);
    const between = rig.right.position.clone().sub(rig.left.position);
    expect(between.length() / CARDBOARD_BASELINE_M).toBeCloseTo(1, 5);
    expect(between.normalize().dot(right)).toBeCloseTo(1, 9);

    // Both eye axes pass through the point straight ahead at the convergence distance.
    const ahead = new THREE.Vector3(0, 0, -CARDBOARD_CONVERGENCE_M).applyQuaternion(head.quaternion).add(head.position);
    for (const eye of [rig.left, rig.right]) {
      const axis = new THREE.Vector3(0, 0, -1).applyQuaternion(eye.quaternion);
      const toAhead = ahead.clone().sub(eye.position).normalize();
      expect(axis.dot(toAhead)).toBeCloseTo(1, 9);
    }
    expect(rig.left.aspect).toBeCloseTo(600 / 1080, 9);
  });

  it('keeps both eyes at the head height when the head rolls, so neither is under the ground', () => {
    const head = headCamera(2);
    const rig = new StereoRig();
    rig.update(head, 600, 1080);

    const headRadius = head.position.length();
    for (const eye of [rig.left, rig.right]) {
      expect(eye.position.length() - headRadius).toBeCloseTo(0, 4);
    }
    const between = rig.right.position.clone().sub(rig.left.position);
    expect(between.length() / CARDBOARD_BASELINE_M).toBeCloseTo(Math.cos(2 / DEG), 5);
  });

  it('renders each eye into its own half of the canvas', () => {
    const viewports: number[][] = [];
    const scissors: number[][] = [];
    const rendered: string[] = [];
    const renderer = {
      setScissorTest: () => undefined,
      setViewport: (x: number, y: number, w: number, h: number) => viewports.push([x, y, w, h]),
      setScissor: (x: number, y: number, w: number, h: number) => scissors.push([x, y, w, h]),
      render: (_scene: THREE.Scene, camera: THREE.Camera) => rendered.push(camera.name),
    } as unknown as THREE.WebGLRenderer;
    const rig = new StereoRig();
    const before: string[] = [];
    rig.render(renderer, new THREE.Scene(), 1201, 540, (eye) => before.push(eye.name));

    expect(before).toEqual(['left-eye', 'right-eye']);
    expect(rendered).toEqual(['left-eye', 'right-eye']);
    expect(scissors).toEqual([
      [0, 0, 600, 540],
      [600, 0, 600, 540],
    ]);
    // Leaves the full canvas viewport for whatever draws next.
    expect(viewports.at(-1)).toEqual([0, 0, 1201, 540]);
  });
});
