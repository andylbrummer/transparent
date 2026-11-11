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
  uniform vec2 uCenter;
  vec3 viewRay() {
    vec2 ndc = vUv * 2.0 - 1.0 + uCenter;
    return normalize(uCameraRot * vec3(ndc.x * uAspect * uTanHalfFov, ndc.y * uTanHalfFov, -1.0));
  }
`;

export interface ViewRayUniforms {
  [uniform: string]: THREE.IUniform;
  uCameraRot: { value: THREE.Matrix3 };
  uAspect: { value: number };
  uTanHalfFov: { value: number };
  /** Where the view axis crosses the screen, in NDC with the sign flipped: non-zero for an off-centre frustum. */
  uCenter: { value: THREE.Vector2 };
}

export function createViewRayUniforms(): ViewRayUniforms {
  return {
    uCameraRot: { value: new THREE.Matrix3() },
    uAspect: { value: 1 },
    uTanHalfFov: { value: Math.tan(Math.PI / 6) },
    uCenter: { value: new THREE.Vector2() },
  };
}

const scratch = new THREE.Matrix4();

/** A perspective frustum as the ray shaders use it. */
export interface ProjectionFrame {
  aspect: number;
  tanHalfFov: number;
  centerX: number;
  centerY: number;
}

/**
 * Read the frustum from the projection matrix itself, not from `fov` and
 * `aspect`: a WebXR eye camera carries only the matrix the device gives
 * (its `fov` field is never set), and an AR phone's frustum is a little
 * off-centre. False for a camera that is not perspective.
 *
 * For view z = -1 a perspective matrix maps x to x_ndc = P0·x − P8, so
 * x = (x_ndc + P8) / P0; likewise y with P5 and P9.
 */
export function readProjectionFrame(camera: THREE.Camera, out: ProjectionFrame): boolean {
  const e = camera.projectionMatrix.elements;
  if (e[11] !== -1) return false;
  out.tanHalfFov = 1 / e[5];
  out.aspect = e[5] / e[0];
  out.centerX = e[8];
  out.centerY = e[9];
  return true;
}

const frame: ProjectionFrame = { aspect: 1, tanHalfFov: 1, centerX: 0, centerY: 0 };

/** Point the view-ray uniforms at `camera`. */
export function updateViewRayUniforms(uniforms: ViewRayUniforms, camera: THREE.Camera): void {
  if (readProjectionFrame(camera, frame)) {
    uniforms.uAspect.value = frame.aspect;
    uniforms.uTanHalfFov.value = frame.tanHalfFov;
    uniforms.uCenter.value.set(frame.centerX, frame.centerY);
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
