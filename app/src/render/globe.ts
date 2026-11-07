/**
 * Raymarched transparent Earth renderer.
 *
 * A single fullscreen quad whose fragment shader follows each view ray
 * through every PREM boundary it crosses, front to back: the near-side
 * surface, down through mantle and core, and out through the far-side
 * surface. World space is ECEF (metres, origin at Earth's centre).
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M, type Vec3 } from '@transparent-earth/core';
import { PREM_LAYERS, premRadiiToMeters, premColors, premAlphas } from './prem';

/**
 * NASA GIBS Blue Marble (Next Generation) as one equirectangular image.
 * 4096×2048 keeps the texture at 32 MB of GPU memory, inside every phone's
 * max texture size, at ~10 km per texel — finer than a far-side pixel.
 */
export const BLUE_MARBLE_URL =
  'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap' +
  '&VERSION=1.3.0&LAYERS=BlueMarble_NextGeneration&CRS=EPSG:4326&BBOX=-90,-180,90,180' +
  '&WIDTH=4096&HEIGHT=2048&FORMAT=image/jpeg';

const LAYER_COUNT = PREM_LAYERS.length;

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

  #define LAYERS ${LAYER_COUNT}
  #define SURFACE ${LAYER_COUNT - 1}
  #define PI 3.141592653589793

  uniform vec3 uCameraPos;
  uniform mat3 uCameraRot;
  uniform float uAspect;
  uniform float uTanHalfFov;
  // |camera|^2 - r^2 per layer, computed on the CPU in double precision:
  // in float32 both terms are ~4e13 and their difference at the surface
  // (a few 1e7) would be lost to cancellation.
  uniform float uLayerC[LAYERS];
  uniform vec3 uLayerColors[LAYERS];
  uniform float uLayerAlphas[LAYERS];
  uniform sampler2D uSurface;
  uniform float uSurfaceReady;
  uniform vec3 uSunDir;

  const vec3 SPACE = vec3(0.01, 0.012, 0.03);

  // Ray/sphere roots for a sphere at the origin, given b = dot(ro, rd) and
  // c = |ro|^2 - r^2. Uses the cancellation-free form: one root from
  // -b +/- sqrt, the other from the product of roots (c).
  bool intersect(float b, float c, out float tEnter, out float tExit) {
    float disc = b * b - c;
    if (disc <= 0.0) return false;
    float s = sqrt(disc);
    float q = b < 0.0 ? -b + s : -b - s;
    float other = c / q;
    tEnter = min(q, other);
    tExit = max(q, other);
    return true;
  }

  vec2 equirectUv(vec3 n) {
    float lon = atan(n.y, n.x);
    float lat = asin(clamp(n.z, -1.0, 1.0));
    return vec2(lon / (2.0 * PI) + 0.5, lat / PI + 0.5);
  }

  // Composite one boundary crossing into the running colour/transmittance.
  // exiting: the ray leaves this sphere (seen from inside).
  void shadeBoundary(int i, vec3 p, vec3 rd, bool exiting, inout vec3 color, inout float trans) {
    vec3 n = normalize(p);
    float rim = pow(1.0 - abs(dot(n, rd)), 3.0);
    vec3 tint;
    float a;
    if (i == SURFACE) {
      vec3 albedo = uSurfaceReady > 0.5 ? texture2D(uSurface, equirectUv(n)).rgb : uLayerColors[i];
      // Night side stays legible: this is a geology view, not a photo.
      float daylight = smoothstep(-0.08, 0.15, dot(n, uSunDir));
      tint = albedo * mix(0.22, 1.0, daylight);
      // Near side: glass underfoot, solid toward the horizon. Far side: the
      // destination of the view, shown nearly opaque.
      a = exiting ? 0.9 : mix(0.06, 0.95, rim);
    } else {
      tint = uLayerColors[i];
      a = uLayerAlphas[i] * (0.12 + 0.88 * rim);
    }
    color += trans * a * tint;
    trans *= 1.0 - a;
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    vec3 rd = normalize(uCameraRot * vec3(uv.x * uAspect * uTanHalfFov, uv.y * uTanHalfFov, -1.0));
    vec3 ro = uCameraPos;
    float b = dot(ro, rd);

    vec3 color = vec3(0.0);
    float trans = 1.0;
    float tEnter, tExit;

    // Concentric spheres: every entry precedes every exit, entries run
    // outer to inner and exits inner to outer, so no sort is needed.
    for (int k = 0; k < LAYERS; k++) {
      int i = LAYERS - 1 - k;
      if (intersect(b, uLayerC[i], tEnter, tExit) && tEnter > 0.0) {
        shadeBoundary(i, ro + rd * tEnter, rd, false, color, trans);
      }
    }
    for (int i = 0; i < LAYERS; i++) {
      if (intersect(b, uLayerC[i], tEnter, tExit) && tExit > 0.0) {
        shadeBoundary(i, ro + rd * tExit, rd, true, color, trans);
      }
    }

    gl_FragColor = vec4(color + trans * SPACE, 1.0);
  }
`;

export class GlobeRenderer {
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private readonly rotation = new THREE.Matrix4();
  private readonly layerRadii = premRadiiToMeters();

  constructor() {
    const uniforms = {
      uCameraPos: { value: new THREE.Vector3(0, 0, EARTH_RADIUS_M + 2) },
      uCameraRot: { value: new THREE.Matrix3().identity() },
      uAspect: { value: 1 },
      uTanHalfFov: { value: Math.tan((60 * Math.PI) / 180 / 2) },
      uLayerC: { value: new Float32Array(LAYER_COUNT) },
      uLayerColors: { value: premColors() },
      uLayerAlphas: { value: premAlphas() },
      uSurface: { value: null as THREE.Texture | null },
      uSurfaceReady: { value: 0 },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
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
    // A fullscreen quad placed in clip space by the vertex shader: its world
    // bounds say nothing about visibility, so culling would drop the planet
    // whenever the origin leaves the frustum (e.g. looking at the limb).
    this.mesh.frustumCulled = false;
  }

  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  /**
   * Drape an equirectangular image (lon -180..180 left to right, north up)
   * on the surface shell. No mipmaps: the atan seam at the antimeridian
   * would otherwise pick the coarsest level along a visible line.
   */
  setSurfaceImagery(texture: THREE.Texture): void {
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    this.material.uniforms.uSurface.value = texture;
    this.material.uniforms.uSurfaceReady.value = 1;
  }

  /** Point the daylight at the subsolar direction (ECEF, any length). */
  setSunDirection(subsolar: Vec3): void {
    (this.material.uniforms.uSunDir.value as THREE.Vector3).set(subsolar.x, subsolar.y, subsolar.z).normalize();
  }

  update(camera: THREE.Camera): void {
    // Track the camera's own framing so the raymarch matches what a
    // rasterised scene through the same camera would show.
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const perspective = camera as THREE.PerspectiveCamera;
      this.material.uniforms.uAspect.value = perspective.aspect;
      this.material.uniforms.uTanHalfFov.value = Math.tan(
        (perspective.fov * Math.PI) / 180 / 2
      );
    }

    this.material.uniforms.uCameraPos.value.copy(camera.position);

    // Double precision here, so the shader never subtracts two ~4e13 floats.
    const layerC = this.material.uniforms.uLayerC.value as Float32Array;
    const distanceSq = camera.position.lengthSq();
    for (let i = 0; i < LAYER_COUNT; i++) {
      layerC[i] = distanceSq - this.layerRadii[i] * this.layerRadii[i];
    }

    // Runs every frame: reuse the scratch matrix rather than allocating.
    this.rotation.makeRotationFromQuaternion(camera.quaternion);
    this.material.uniforms.uCameraRot.value.setFromMatrix4(this.rotation);
  }
}
