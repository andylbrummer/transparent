import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createViewRayUniforms, readProjectionFrame, updateViewRayUniforms } from './view-ray';

describe('readProjectionFrame', () => {
  it('matches fov and aspect for an ordinary camera', () => {
    const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 1e9);
    const frame = { aspect: 0, tanHalfFov: 0, centerX: 9, centerY: 9 };
    expect(readProjectionFrame(camera, frame)).toBe(true);
    expect(frame.aspect).toBeCloseTo(1.6, 12);
    expect(frame.tanHalfFov).toBeCloseTo(Math.tan((25 * Math.PI) / 180), 12);
    expect(frame.centerX).toBe(0);
    expect(frame.centerY).toBe(0);
  });

  it('follows a frustum set straight into the matrix, as WebXR does, off-centre included', () => {
    // A camera whose fov field says 50° but whose matrix is an off-centre frustum.
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1e9);
    const near = 0.1;
    const [left, right, bottom, top] = [-0.06, 0.04, -0.09, 0.07];
    camera.projectionMatrix.makePerspective(left, right, top, bottom, near, 1e9);
    const uniforms = createViewRayUniforms();
    updateViewRayUniforms(uniforms, camera);
    // The ray through each frustum corner, as the shader builds it, must hit that corner.
    for (const [ndcX, ndcY, x, y] of [
      [-1, -1, left, bottom],
      [1, 1, right, top],
    ]) {
      const rayX = (ndcX + uniforms.uCenter.value.x) * uniforms.uAspect.value * uniforms.uTanHalfFov.value;
      const rayY = (ndcY + uniforms.uCenter.value.y) * uniforms.uTanHalfFov.value;
      expect(rayX).toBeCloseTo(x / near, 9);
      expect(rayY).toBeCloseTo(y / near, 9);
    }
  });

  it('declines a camera that is not perspective', () => {
    const frame = { aspect: 0, tanHalfFov: 0, centerX: 0, centerY: 0 };
    expect(readProjectionFrame(new THREE.OrthographicCamera(), frame)).toBe(false);
  });
});
