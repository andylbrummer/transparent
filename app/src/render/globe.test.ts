import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { DEFAULT_SURFACE_GAIN, GlobeRenderer, TWILIGHT_SUN_ELEVATION_DEG } from './globe';
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

    globe.update(camera, 800);

    const uniforms = (globe.getMesh().material as THREE.ShaderMaterial).uniforms;
    expect(uniforms.uCameraPos.value.z).toBe(40_000_000);
    const expected = new THREE.Matrix3().setFromMatrix4(
      new THREE.Matrix4().makeRotationFromQuaternion(camera.quaternion)
    );
    expect(uniforms.uCameraRot.value.elements).toEqual(expected.elements);
    expect(uniforms.uAspect.value).toBe(2);
    // One pixel of an 800 px tall, 45° view: keeps the horizon a pixel wide.
    expect(uniforms.uPixelAngle.value).toBeCloseTo((2 * Math.tan((22.5 * Math.PI) / 180)) / 800, 12);
  });

  it('precomputes each shell term in double precision for a camera at the surface', () => {
    const globe = new GlobeRenderer();
    const camera = new THREE.PerspectiveCamera();
    // 1.5 m above the crust: in float32, |p|^2 - r^2 would cancel to noise.
    camera.position.set(EARTH_RADIUS_M + 1.5, 0, 0);

    globe.update(camera, 800);

    const uniforms = (globe.getMesh().material as THREE.ShaderMaterial).uniforms;
    const layerC = uniforms.uLayerC.value as Float32Array;
    const crust = layerC[PREM_LAYERS.length - 1];
    expect(crust).toBeCloseTo(2 * EARTH_RADIUS_M * 1.5 + 1.5 * 1.5, -1);
    // Horizon dips by sqrt(2h/R) ~ 0.04° at 1.5 m: below float32's 1 - x resolution.
    expect(uniforms.uHorizonSin.value).toBeCloseTo(-Math.sqrt((2 * 1.5) / EARTH_RADIUS_M), 7);
    expect(uniforms.uHorizonSin.value).toBeLessThan(0);
    const innerCoreRadius = PREM_LAYERS[0].radiusKm * 1000;
    expect(layerC[0]).toBeCloseTo((EARTH_RADIUS_M + 1.5) ** 2 - innerCoreRadius ** 2, -7);
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
    // The raw shader writes no output encoding, so samples must not be linearised.
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
  });

  it('shows an override in place of the base imagery and goes back to the base', () => {
    const globe = new GlobeRenderer();
    const uniforms = (globe.getMesh().material as THREE.ShaderMaterial).uniforms;
    const base = new THREE.Texture();
    const nightLights = new THREE.Texture();

    // An override can arrive before the base has loaded, or when it never does.
    globe.setSurfaceOverride(nightLights, 3);
    expect(uniforms.uSurface.value).toBe(nightLights);
    expect(uniforms.uSurfaceReady.value).toBe(1);
    expect(uniforms.uSurfaceGain.value).toBe(3);
    expect(nightLights.generateMipmaps).toBe(false);

    globe.setSurfaceImagery(base);
    expect(uniforms.uSurface.value).toBe(nightLights);

    globe.setSurfaceOverride(null);
    expect(uniforms.uSurface.value).toBe(base);
    expect(uniforms.uSurfaceGain.value).toBe(DEFAULT_SURFACE_GAIN);
  });

  it('shades the night side into the surface itself, not over the interior', () => {
    const globe = new GlobeRenderer();
    const material = globe.getMesh().material as THREE.ShaderMaterial;
    const uniforms = material.uniforms;
    expect(uniforms.uNightReady.value).toBe(0);
    const night = new THREE.Texture();
    globe.setNightSide(night);
    expect(uniforms.uNight.value).toBe(night);
    expect(uniforms.uNightReady.value).toBe(1);
    expect(night.generateMipmaps).toBe(false);
    globe.sunDirection.set(0, 1, 0);
    expect(uniforms.uSunDirection.value.y).toBe(1);
    // The night is mixed into the surface's own colour, before that colour is
    // composited behind the shells in front of it.
    const shader = material.fragmentShader;
    const nightAt = shader.indexOf('uNightReady > 0.5');
    expect(nightAt).toBeGreaterThan(shader.indexOf('if (i == SURFACE)'));
    expect(nightAt).toBeLessThan(shader.indexOf('color += trans * a * tint'));
    // Twilight from the Sun 1° up to 12° down.
    expect(shader).toContain(`smoothstep(${Math.sin((TWILIGHT_SUN_ELEVATION_DEG.start * Math.PI) / 180).toFixed(4)}, ${Math.sin((TWILIGHT_SUN_ELEVATION_DEG.end * Math.PI) / 180).toFixed(4)}`);
    globe.setNightSide(null);
    expect(uniforms.uNightReady.value).toBe(0);
  });

  it('says whether the surface shows an image at all', () => {
    const globe = new GlobeRenderer();
    expect(globe.hasSurfaceImagery()).toBe(false);
    globe.setSurfaceOverride(new THREE.Texture());
    expect(globe.hasSurfaceImagery()).toBe(true);
    globe.setSurfaceOverride(null);
    expect(globe.hasSurfaceImagery()).toBe(false);
  });

  it('falls back to the flat surface colour when an override is cleared with no base', () => {
    const globe = new GlobeRenderer();
    const uniforms = (globe.getMesh().material as THREE.ShaderMaterial).uniforms;
    globe.setSurfaceOverride(new THREE.Texture());
    globe.setSurfaceOverride(null);
    expect(uniforms.uSurfaceReady.value).toBe(0);
  });
});
