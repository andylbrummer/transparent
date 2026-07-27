/**
 * TerminatorLayer — renders the day/night mask as a sphere overlay.
 *
 * Shades the night side from the subsolar point, so the boundary tracks real
 * solar position rather than an imagery product. Named for the layer it draws;
 * the underlying solar geometry lives in @transparent-earth/core/terminator.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M, subsolarEcef } from '@transparent-earth/core';

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
