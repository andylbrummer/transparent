/**
 * Raymarched transparent Earth renderer.
 * Uses a single fullscreen quad with a fragment shader that raymarches
 * through PREM interior shells.
 */

import * as THREE from 'three';
import { PREM_LAYERS, premRadiiToMeters, premColors, premAlphas, EARTH_RADIUS_M } from './prem';

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;

  uniform vec3 uCameraPos;
  uniform mat3 uCameraRot;
  uniform float uEarthRadius;
  uniform float uAspect;
  uniform float uTanHalfFov;
  uniform int uLayerCount;
  uniform float uLayerRadii[5];
  uniform vec3 uLayerColors[5];
  uniform float uLayerAlphas[5];
  uniform float uTime;

  #define MAX_STEPS 64
  #define MAX_DIST 15000000.0
  #define EPS 1000.0

  struct Hit {
    float t;
    int layer;
  };

  // Analytic sphere intersection (ray origin, direction, center, radius)
  bool sphereIntersect(vec3 ro, vec3 rd, vec3 center, float radius, out float tEnter, out float tExit) {
    vec3 oc = ro - center;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - radius * radius;
    float discriminant = b * b - c;
    if (discriminant < 0.0) return false;
    float sqrtD = sqrt(discriminant);
    tEnter = -b - sqrtD;
    tExit = -b + sqrtD;
    return true;
  }

  // Find the nearest shell intersection along the ray
  Hit marchShells(vec3 ro, vec3 rd) {
    Hit hit;
    hit.t = MAX_DIST;
    hit.layer = -1;

    for (int i = 0; i < 5; i++) {
      if (i >= uLayerCount) break;
      float tEnter, tExit;
      if (sphereIntersect(ro, rd, vec3(0.0), uLayerRadii[i], tEnter, tExit)) {
        if (tEnter > 0.0 && tEnter < hit.t) {
          hit.t = tEnter;
          hit.layer = i;
        }
      }
    }
    return hit;
  }

  void main() {
    // Ray direction from camera through pixel. Scaling by aspect and the
    // half-FOV tangent keeps the planet circular instead of stretching it
    // to the viewport, and keeps the framing consistent with the camera.
    vec2 uv = vUv * 2.0 - 1.0;
    vec3 rd = normalize(uCameraRot * vec3(uv.x * uAspect * uTanHalfFov, uv.y * uTanHalfFov, -1.0));
    vec3 ro = uCameraPos;

    // Background color (dark space)
    vec3 color = vec3(0.02, 0.02, 0.04);
    float alpha = 1.0;

    // Raymarch through shells from outside in
    vec3 p = ro;
    float t = 0.0;

    for (int step = 0; step < MAX_STEPS; step++) {
      Hit hit = marchShells(p, rd);
      if (hit.t >= MAX_DIST) break;

      // Move to intersection point
      t += hit.t + EPS;
      p = ro + rd * t;

      if (hit.layer >= 0) {
        vec3 layerColor = uLayerColors[hit.layer];
        float layerAlpha = uLayerAlphas[hit.layer];

        // Fresnel-like transparency: more transparent when looking straight down (nadir)
        // and more opaque at grazing angles (horizon)
        float nDotV = abs(dot(normalize(p), rd));
        float fresnel = pow(1.0 - nDotV, 2.0);
        layerAlpha *= (0.3 + 0.7 * fresnel);

        color = mix(color, layerColor, layerAlpha * alpha);
        alpha *= (1.0 - layerAlpha);

        if (alpha < 0.01) break;
      }
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface GlobeUniforms {
  uCameraPos: THREE.Vector3;
  uCameraRot: THREE.Matrix3;
  uEarthRadius: number;
  uLayerCount: number;
  uLayerRadii: Float32Array;
  uLayerColors: Float32Array;
  uLayerAlphas: Float32Array;
  uTime: number;
}

export class GlobeRenderer {
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private clock = new THREE.Clock();

  constructor() {
    const uniforms = {
      uCameraPos: { value: new THREE.Vector3(0, 0, EARTH_RADIUS_M + 2) },
      uCameraRot: { value: new THREE.Matrix3().identity() },
      uEarthRadius: { value: EARTH_RADIUS_M },
      uAspect: { value: 1 },
      uTanHalfFov: { value: Math.tan((60 * Math.PI) / 180 / 2) },
      uLayerCount: { value: PREM_LAYERS.length },
      uLayerRadii: { value: premRadiiToMeters() },
      uLayerColors: { value: premColors() },
      uLayerAlphas: { value: premAlphas() },
      uTime: { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
  }

  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  update(camera: THREE.Camera): void {
    const elapsed = this.clock.getElapsedTime();
    this.material.uniforms.uTime.value = elapsed;

    // Track the camera's own framing so the raymarch matches what a
    // rasterised scene through the same camera would show.
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const perspective = camera as THREE.PerspectiveCamera;
      this.material.uniforms.uAspect.value = perspective.aspect;
      this.material.uniforms.uTanHalfFov.value = Math.tan(
        (perspective.fov * Math.PI) / 180 / 2
      );
    }

    // Camera position in world space (relative to floating origin)
    this.material.uniforms.uCameraPos.value.copy(camera.position);

    // Camera rotation matrix (extract from quaternion)
    const rot = new THREE.Matrix4().makeRotationFromQuaternion(camera.quaternion);
    const mat3 = new THREE.Matrix3();
    mat3.setFromMatrix4(rot);
    this.material.uniforms.uCameraRot.value.copy(mat3);
  }

  setCameraPosition(pos: THREE.Vector3): void {
    this.material.uniforms.uCameraPos.value.copy(pos);
  }

  setCameraRotation(quat: THREE.Quaternion): void {
    const rot = new THREE.Matrix4().makeRotationFromQuaternion(quat);
    const mat3 = new THREE.Matrix3();
    mat3.setFromMatrix4(rot);
    this.material.uniforms.uCameraRot.value.copy(mat3);
  }
}
