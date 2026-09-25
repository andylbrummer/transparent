import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GlobeRenderer } from './globe';

describe('GlobeRenderer', () => {
  it('never frustum-culls its fullscreen quad', () => {
    expect(new GlobeRenderer().getMesh().frustumCulled).toBe(false);
  });

  it('tracks the camera position and orientation', () => {
    const globe = new GlobeRenderer();
    const camera = new THREE.PerspectiveCamera(45, 2, 0.1, 1e9);
    camera.position.set(0, 0, 40_000_000);
    camera.lookAt(0, 0, 0);
    camera.rotateZ(0.3);

    globe.update(camera);

    const uniforms = (globe.getMesh().material as THREE.ShaderMaterial).uniforms;
    expect(uniforms.uCameraPos.value.z).toBe(40_000_000);
    const expected = new THREE.Matrix3().setFromMatrix4(
      new THREE.Matrix4().makeRotationFromQuaternion(camera.quaternion)
    );
    expect(uniforms.uCameraRot.value.elements).toEqual(expected.elements);
    expect(uniforms.uAspect.value).toBe(2);
  });
});
