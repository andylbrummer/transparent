import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { GlobeRenderer } from './globe';
import { PREM_LAYERS } from './prem';

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

  it('precomputes each shell term in double precision for a camera at the surface', () => {
    const globe = new GlobeRenderer();
    const camera = new THREE.PerspectiveCamera();
    // 1.5 m above the crust: in float32, |p|^2 - r^2 would cancel to noise.
    camera.position.set(EARTH_RADIUS_M + 1.5, 0, 0);

    globe.update(camera);

    const uniforms = (globe.getMesh().material as THREE.ShaderMaterial).uniforms;
    const layerC = uniforms.uLayerC.value as Float32Array;
    const crust = layerC[PREM_LAYERS.length - 1];
    expect(crust).toBeCloseTo(2 * EARTH_RADIUS_M * 1.5 + 1.5 * 1.5, -1);
    const innerCoreRadius = PREM_LAYERS[0].radiusKm * 1000;
    expect(layerC[0]).toBeCloseTo((EARTH_RADIUS_M + 1.5) ** 2 - innerCoreRadius ** 2, -7);
  });

  it('normalises the sun direction it is given', () => {
    const globe = new GlobeRenderer();
    globe.setSunDirection({ x: 0, y: 3 * EARTH_RADIUS_M, z: 0 });
    const uniforms = (globe.getMesh().material as THREE.ShaderMaterial).uniforms;
    expect((uniforms.uSunDir.value as THREE.Vector3).toArray()).toEqual([0, 1, 0]);
  });

  it('marks the surface imagery ready once a texture is set', () => {
    const globe = new GlobeRenderer();
    const uniforms = (globe.getMesh().material as THREE.ShaderMaterial).uniforms;
    expect(uniforms.uSurfaceReady.value).toBe(0);
    const texture = new THREE.Texture();
    globe.setSurfaceImagery(texture);
    expect(uniforms.uSurface.value).toBe(texture);
    expect(uniforms.uSurfaceReady.value).toBe(1);
    expect(texture.generateMipmaps).toBe(false);
  });
});
