/**
 * Raymarched transparent Earth renderer.
 *
 * A single fullscreen quad whose fragment shader follows each view ray
 * through every PREM boundary it crosses, front to back: the near-side
 * surface, down through mantle and core, and out through the far-side
 * surface. World space is ECEF (metres, origin at Earth's centre).
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
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

/** Brightening applied to the surface imagery unless an override asks for its own. */
export const DEFAULT_SURFACE_GAIN = 1.4;

/**
 * Night falls between the Sun 1° above the horizon and 12° below it - the
 * end of nautical twilight - so the terminator is the soft band it is from
 * orbit, not a line.
 */
export const TWILIGHT_SUN_ELEVATION_DEG = { start: 1, end: -12 } as const;

const LAYER_COUNT = PREM_LAYERS.length;
const DEG = Math.PI / 180;

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
  uniform float uSurfaceGain;
  // The night side: an image of the unlit Earth, shown where the Sun is down.
  uniform sampler2D uNight;
  uniform float uNightReady;
  uniform vec3 uSunDirection;
  // Sine of the horizon's elevation (negative: a dip below level), from the
  // CPU - in float32, 1 - (R / |camera|)^2 at eye height rounds to zero.
  uniform float uHorizonSin;
  // Angle one pixel subtends, so the horizon line stays a pixel wide at any zoom.
  uniform float uPixelAngle;

  const vec3 SPACE = vec3(0.01, 0.012, 0.03);
  const vec3 HORIZON_COLOR = vec3(0.75, 0.85, 1.0);
  const float HORIZON_ALPHA = 0.55;

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
  void shadeBoundary(int i, vec3 p, vec3 rd, inout vec3 color, inout float trans) {
    vec3 n = normalize(p);
    float rim = pow(1.0 - abs(dot(n, rd)), 3.0);
    vec3 tint;
    float a;
    if (i == SURFACE) {
      vec3 albedo = uSurfaceReady > 0.5 ? texture2D(uSurface, equirectUv(n)).rgb : uLayerColors[i];
      // Unlit and boosted: this is a geology view, not a photo, so land
      // masses must read clearly through the shells.
      tint = min(albedo * uSurfaceGain, vec3(1.0));
      if (uNightReady > 0.5) {
        // Shaded here, on the surface alone: laid over the finished picture
        // it would also darken the mantle and core in front of the night side.
        float night = smoothstep(${Math.sin(TWILIGHT_SUN_ELEVATION_DEG.start * DEG).toFixed(4)}, ${Math.sin(TWILIGHT_SUN_ELEVATION_DEG.end * DEG).toFixed(4)}, dot(n, uSunDirection));
        vec3 texel = texture2D(uNight, equirectUv(n)).rgb;
        float glow = max(texel.r, max(texel.g, texel.b));
        // Unlit ground stays dim; lit ground is lifted toward the sodium glow it has from orbit.
        vec3 lights = texel * mix(0.6, 1.0, smoothstep(0.25, 0.6, glow)) + vec3(1.0, 0.78, 0.45) * smoothstep(0.3, 0.95, glow);
        tint = mix(tint, min(lights, vec3(1.0)), night * mix(0.78, 1.0, smoothstep(0.3, 0.7, glow)));
      }
      // Only ever reached on exit: the far side, the destination of the
      // view, shown nearly opaque.
      a = 0.9;
    } else {
      // Glass shells: clear face-on - eight face-on crossings of even a few
      // percent each stack into a haze over the far side - so only the rim,
      // where the ray grazes the boundary, draws the structure.
      tint = uLayerColors[i];
      a = uLayerAlphas[i] * rim;
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
    // The surface entry is skipped: the ground underfoot is glass. Every ray
    // below the horizon enters within ~4 km of the user, so shading it would
    // tint the whole view with one local texel and hide nearby continents.
    for (int k = 1; k < LAYERS; k++) {
      int i = LAYERS - 1 - k;
      if (intersect(b, uLayerC[i], tEnter, tExit) && tEnter > 0.0) {
        shadeBoundary(i, ro + rd * tEnter, rd, color, trans);
      }
    }
    for (int i = 0; i < LAYERS; i++) {
      if (intersect(b, uLayerC[i], tEnter, tExit) && tExit > 0.0) {
        shadeBoundary(i, ro + rd * tExit, rd, color, trans);
      }
    }
    color += trans * SPACE;

    // With the ground clear, a drawn horizon is what keeps "level" legible.
    float elevationSin = dot(rd, normalize(ro));
    float horizon = 1.0 - smoothstep(0.5 * uPixelAngle, 1.5 * uPixelAngle, abs(elevationSin - uHorizonSin));
    color = mix(color, HORIZON_COLOR, horizon * HORIZON_ALPHA);

    gl_FragColor = vec4(color, 1.0);
  }
`;

export class GlobeRenderer {
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private readonly rotation = new THREE.Matrix4();
  private readonly layerRadii = premRadiiToMeters();
  private baseImagery: THREE.Texture | null = null;
  private overrideImagery: THREE.Texture | null = null;
  private overrideGain = DEFAULT_SURFACE_GAIN;

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
      uSurfaceGain: { value: DEFAULT_SURFACE_GAIN },
      uNight: { value: null as THREE.Texture | null },
      uNightReady: { value: 0 },
      uSunDirection: { value: new THREE.Vector3(1, 0, 0) },
      uHorizonSin: { value: 0 },
      uPixelAngle: { value: 0.002 },
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
   * would otherwise pick the coarsest level along a visible line. Colour
   * space stays untagged: this raw shader writes no output encoding, so a
   * linear-decoded sample would be shown as if sRGB, crushing mid-tones.
   */
  setSurfaceImagery(texture: THREE.Texture): void {
    this.baseImagery = this.prepareImagery(texture);
    this.applyImagery();
  }

  /**
   * Show `texture` in place of the base imagery - another map of the same
   * surface, chosen in the layers panel - or pass null to go back to the
   * base. The base stays loaded, so going back costs nothing. The caller
   * owns the texture and disposes of it after replacing or clearing it.
   * `gain` multiplies its colours; dim maps such as night lights want more.
   */
  setSurfaceOverride(texture: THREE.Texture | null, gain: number = DEFAULT_SURFACE_GAIN): void {
    this.overrideImagery = texture ? this.prepareImagery(texture) : null;
    this.overrideGain = gain;
    this.applyImagery();
  }

  /**
   * Shade the night side of the surface with `texture` - the Earth unlit,
   * equirectangular like the imagery - or stop with null. Where the night
   * is comes from sunDirection, which the caller keeps current. The caller
   * owns the texture and disposes of it after clearing it.
   */
  setNightSide(texture: THREE.Texture | null): void {
    this.material.uniforms.uNight.value = texture ? this.prepareImagery(texture) : null;
    this.material.uniforms.uNightReady.value = texture ? 1 : 0;
  }

  /** Unit vector from the Earth's centre toward the Sun, ECEF: written by whoever calls setNightSide. */
  get sunDirection(): THREE.Vector3 {
    return this.material.uniforms.uSunDirection.value as THREE.Vector3;
  }

  /** Whether the surface shows an image - the base or an override - rather than its flat colour. */
  hasSurfaceImagery(): boolean {
    return this.material.uniforms.uSurfaceReady.value === 1;
  }

  private prepareImagery(texture: THREE.Texture): THREE.Texture {
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  private applyImagery(): void {
    const shown = this.overrideImagery ?? this.baseImagery;
    this.material.uniforms.uSurface.value = shown;
    this.material.uniforms.uSurfaceReady.value = shown ? 1 : 0;
    this.material.uniforms.uSurfaceGain.value = this.overrideImagery ? this.overrideGain : DEFAULT_SURFACE_GAIN;
  }

  /** viewportHeightPx: drawing-buffer height, which sets the horizon line's width. */
  update(camera: THREE.Camera, viewportHeightPx: number): void {
    // Track the camera's own framing so the raymarch matches what a
    // rasterised scene through the same camera would show.
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const perspective = camera as THREE.PerspectiveCamera;
      const tanHalfFov = Math.tan((perspective.fov * Math.PI) / 180 / 2);
      this.material.uniforms.uAspect.value = perspective.aspect;
      this.material.uniforms.uTanHalfFov.value = tanHalfFov;
      this.material.uniforms.uPixelAngle.value = (2 * tanHalfFov) / viewportHeightPx;
    }

    this.material.uniforms.uCameraPos.value.copy(camera.position);

    // Double precision here, so the shader never subtracts two ~4e13 floats.
    const layerC = this.material.uniforms.uLayerC.value as Float32Array;
    const distanceSq = camera.position.lengthSq();
    for (let i = 0; i < LAYER_COUNT; i++) {
      layerC[i] = distanceSq - this.layerRadii[i] * this.layerRadii[i];
    }
    const surfaceRadius = this.layerRadii[LAYER_COUNT - 1];
    const tangentSq = Math.max(0, 1 - (surfaceRadius * surfaceRadius) / distanceSq);
    this.material.uniforms.uHorizonSin.value = -Math.sqrt(tangentSq);

    // Runs every frame: reuse the scratch matrix rather than allocating.
    this.rotation.makeRotationFromQuaternion(camera.quaternion);
    this.material.uniforms.uCameraRot.value.setFromMatrix4(this.rotation);
  }
}
