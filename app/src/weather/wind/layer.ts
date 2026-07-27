/**
 * Three.js overlay layers driven by the solar/wind fields.
 *
 * - WindLayer: GPU particle streamlines over the globe, advected by the GFS
 *   wind field sampled from a DataTexture.
 * - TerminatorLayer: day/night mask shaded from the subsolar point.
 *
 * The advection maths these draw lives in ./advection, kept apart so it is
 * testable without a GL context.
 */

import * as THREE from 'three';
import type { GfsGrid, PressureLevel } from '@transparent-earth/core/gfs';
import {
  EARTH_RADIUS_M,
  maxWindSpeed,
  subsolarEcef,
  isDaylight,
} from '@transparent-earth/core';

const VERTEX_SHADER = /* glsl */ `
  uniform sampler2D windTexture;
  uniform float uTime;
  uniform float uSpeedScale;
  uniform float uParticleSize;
  uniform vec3 uSubsolar;
  uniform float uDayNightBlend;

  attribute float aSeed;
  attribute float aLife;

  varying float vAlpha;
  varying float vIsDay;

  // Sample wind at lat/lon from the GFS texture
  vec2 sampleWind(vec2 latLon) {
    // Map lat/lon to texture UV
    // lat [-90, 90] -> v [0, 1]
    // lon [-180, 180] -> u [0, 1]
    float u = (latLon.y + 180.0) / 360.0;
    float v = (latLon.x + 90.0) / 180.0;
    return texture2D(windTexture, vec2(u, v)).rg;
  }

  // Convert lat/lon to ECEF unit vector
  vec3 latLonToEcef(float lat, float lon) {
    float latRad = radians(lat);
    float lonRad = radians(lon);
    float cosLat = cos(latRad);
    return vec3(
      cosLat * cos(lonRad),
      cosLat * sin(lonRad),
      sin(latRad)
    );
  }

  // Convert ECEF to lat/lon
  vec2 ecefToLatLon(vec3 ecef) {
    float r = length(ecef);
    float lat = degrees(asin(ecef.z / r));
    float lon = degrees(atan2(ecef.y, ecef.x));
    return vec2(lat, lon);
  }

  // Wind (u,v) to ECEF velocity tangent vector
  vec3 windToVelocity(float lat, float lon, vec2 wind) {
    float latRad = radians(lat);
    float lonRad = radians(lon);
    float cosLat = cos(latRad);
    float sinLat = sin(latRad);
    float cosLon = cos(lonRad);
    float sinLon = sin(lonRad);

    vec3 eEast = vec3(-sinLon, cosLon, 0.0);
    vec3 eNorth = vec3(-sinLat * cosLon, -sinLat * sinLon, cosLat);

    return wind.x * eEast + wind.y * eNorth;
  }

  void main() {
    // Particle position based on seed and time (pseudo-random advection on CPU)
    // We use the seed to derive a stable initial lat/lon
    float seed = aSeed;
    float lat = fract(seed * 0.371) * 180.0 - 90.0;
    float lon = fract(seed * 0.573) * 360.0 - 180.0;

    // Sample wind and advect
    vec2 wind = sampleWind(vec2(lat, lon));
    vec3 vel = windToVelocity(lat, lon, wind);
    vec3 pos = latLonToEcef(lat, lon);

    // Simple Euler advection visualisation (particles drift with wind)
    float dt = 0.016; // ~60fps
    vec3 drift = vel * dt * uSpeedScale;
    pos += drift * 0.001; // scale to visual size
    pos = normalize(pos); // reproject to sphere

    // Day/night test
    float dayDot = dot(pos, normalize(uSubsolar));
    vIsDay = step(0.0, dayDot);

    // Fade based on life and day/night
    vAlpha = aLife * (0.3 + 0.7 * vIsDay * uDayNightBlend);

    vec4 mvPosition = modelViewMatrix * vec4(pos * ${EARTH_RADIUS_M.toFixed(1)}, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uParticleSize * (300.0 / -mvPosition.z);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uNightColor;

  varying float vAlpha;
  varying float vIsDay;

  void main() {
    // Circular particle
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;

    // Soft edge
    float alpha = vAlpha * smoothstep(0.5, 0.2, dist);

    vec3 color = mix(uNightColor, uColor, vIsDay);
    gl_FragColor = vec4(color, alpha);
  }
`;

export interface WindLayerConfig {
  particleCount: number;
  particleSize: number;
  speedScale: number;
  color: THREE.Color;
  nightColor: THREE.Color;
  pressureLevel: PressureLevel;
}

export const DEFAULT_WIND_CONFIG: WindLayerConfig = {
  particleCount: 8192,
  particleSize: 2.0,
  speedScale: 1.0,
  color: new THREE.Color(0x88ccff),
  nightColor: new THREE.Color(0x224466),
  pressureLevel: 250,
};

/**
 * WindLayer manages GPU particle advection from a GFS wind texture.
 */
export class WindLayer {
  private readonly scene: THREE.Scene;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.BufferGeometry;
  private readonly points: THREE.Points;
  private windTexture: THREE.DataTexture | null = null;
  private grid: GfsGrid | null = null;
  private config: WindLayerConfig;
  private disposed = false;

  constructor(scene: THREE.Scene, config: Partial<WindLayerConfig> = {}) {
    this.scene = scene;
    this.config = { ...DEFAULT_WIND_CONFIG, ...config };

    this.geometry = this.createGeometry();
    this.material = this.createMaterial();
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  private createGeometry(): THREE.BufferGeometry {
    const count = this.config.particleCount;
    const seeds = new Float32Array(count);
    const lives = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      seeds[i] = Math.random();
      lives[i] = Math.random();
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geom.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
    return geom;
  }

  private createMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        windTexture: { value: null },
        uTime: { value: 0 },
        uSpeedScale: { value: this.config.speedScale },
        uParticleSize: { value: this.config.particleSize },
        uSubsolar: { value: new THREE.Vector3(1, 0, 0) },
        uDayNightBlend: { value: 1.0 },
        uColor: { value: this.config.color },
        uNightColor: { value: this.config.nightColor },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  /**
   * Update the wind grid. Creates a new DataTexture from the GFS grid data.
   */
  setGrid(grid: GfsGrid): void {
    this.grid = grid;

    // Normalise wind speeds for the texture
    const maxSpeed = maxWindSpeed(grid);
    const scale = maxSpeed > 0 ? 1 / maxSpeed : 1;

    const texData = new Float32Array(grid.width * grid.height * 2);
    for (let i = 0; i < grid.data.length; i++) {
      texData[i] = grid.data[i] * scale;
    }

    const texture = new THREE.DataTexture(
      texData,
      grid.width,
      grid.height,
      THREE.RGFormat,
      THREE.FloatType
    );
    texture.needsUpdate = true;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    if (this.windTexture) {
      this.windTexture.dispose();
    }
    this.windTexture = texture;
    this.material.uniforms.windTexture.value = texture;
    this.material.uniforms.uSpeedScale.value = this.config.speedScale * maxSpeed;
  }

  /**
   * Update the day/night terminator based on current UTC time.
   */
  updateTerminator(utc: Date): void {
    const ss = subsolarEcef(utc);
    this.material.uniforms.uSubsolar.value.set(ss.x, ss.y, ss.z);
  }

  /**
   * Set the day/night blend factor (0 = no day/night shading, 1 = full).
   */
  setDayNightBlend(blend: number): void {
    this.material.uniforms.uDayNightBlend.value = Math.max(0, Math.min(1, blend));
  }

  /**
   * Per-frame update. Call from the render loop.
   */
  update(_deltaTime: number, elapsedTime: number): void {
    this.material.uniforms.uTime.value = elapsedTime;
  }

  /**
   * Show/hide the wind layer.
   */
  setVisible(visible: boolean): void {
    this.points.visible = visible;
  }

  get visible(): boolean {
    return this.points.visible;
  }

  /**
   * Dispose of GPU resources.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
    if (this.windTexture) {
      this.windTexture.dispose();
    }
  }
}

/**
 * TerminatorLayer — renders a day/night mask as a sphere overlay.
 * Uses a shader that fades the night side based on the subsolar point.
 */
export class TerminatorLayer {
  private readonly scene: THREE.Scene;
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private disposed = false;

  constructor(scene: THREE.Scene, radius: number = EARTH_RADIUS_M * 1.001) {
    this.scene = scene;

    const geometry = new THREE.SphereGeometry(radius, 64, 32);
    this.material = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSubsolar;
        uniform float uNightIntensity;
        uniform vec3 uNightColor;

        varying vec3 vNormal;
        varying vec3 vPosition;

        void main() {
          // Transform subsolar to view space (approximate: assume sphere at origin)
          vec3 normal = normalize(vNormal);
          vec3 subsolarDir = normalize(uSubsolar);

          float dayDot = dot(normal, subsolarDir);

          // Soft terminator with ~0.5° angular transition
          float dayFactor = smoothstep(-0.01, 0.01, dayDot);

          vec3 night = uNightColor * uNightIntensity;
          vec3 color = mix(night, vec3(0.0), dayFactor);

          gl_FragColor = vec4(color, (1.0 - dayFactor) * 0.4);
        }
      `,
      uniforms: {
        uSubsolar: { value: new THREE.Vector3(1, 0, 0) },
        uNightIntensity: { value: 0.8 },
        uNightColor: { value: new THREE.Color(0x051020) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /**
   * Update the terminator based on current UTC time.
   */
  updateTerminator(utc: Date): void {
    const ss = subsolarEcef(utc);
    this.material.uniforms.uSubsolar.value.set(ss.x, ss.y, ss.z);
  }

  /**
   * Set the night intensity (0 = no night overlay, 1 = full).
   */
  setNightIntensity(intensity: number): void {
    this.material.uniforms.uNightIntensity.value = Math.max(0, Math.min(1, intensity));
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
