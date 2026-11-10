/**
 * Shared by the fullscreen layers (surface shells, sky maps): the vertex
 * shader that pins a quad to the screen, the GLSL that turns a pixel into
 * its view ray, and the per-render uniforms that feed it.
 *
 * The uniforms are written in onBeforeRender, from the camera actually
 * drawing - so each eye of a stereo pair gets its own rays.
 */

import * as THREE from 'three';

export const FULLSCREEN_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Declares the uniforms and `vec3 viewRay()`: the world-space unit ray through this pixel. */
export const VIEW_RAY_GLSL = `
  varying vec2 vUv;
  uniform mat3 uCameraRot;
  uniform float uAspect;
  uniform float uTanHalfFov;
  vec3 viewRay() {
    vec2 ndc = vUv * 2.0 - 1.0;
    return normalize(uCameraRot * vec3(ndc.x * uAspect * uTanHalfFov, ndc.y * uTanHalfFov, -1.0));
  }
`;

export interface ViewRayUniforms {
  [uniform: string]: THREE.IUniform;
  uCameraRot: { value: THREE.Matrix3 };
  uAspect: { value: number };
  uTanHalfFov: { value: number };
}

export function createViewRayUniforms(): ViewRayUniforms {
  return {
    uCameraRot: { value: new THREE.Matrix3() },
    uAspect: { value: 1 },
    uTanHalfFov: { value: Math.tan(Math.PI / 6) },
  };
}

const scratch = new THREE.Matrix4();

/** Point the view-ray uniforms at `camera`. */
export function updateViewRayUniforms(uniforms: ViewRayUniforms, camera: THREE.Camera): void {
  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const perspective = camera as THREE.PerspectiveCamera;
    uniforms.uAspect.value = perspective.aspect;
    uniforms.uTanHalfFov.value = Math.tan((perspective.fov * Math.PI) / 360);
  }
  // matrixWorld, not .quaternion: a stereo eye may hang off a parent rig.
  uniforms.uCameraRot.value.setFromMatrix4(scratch.extractRotation(camera.matrixWorld));
}

/** A screen-filling quad drawn by `material`, never culled. */
export function createFullscreenQuad(material: THREE.ShaderMaterial, name: string, renderOrder: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  return mesh;
}
