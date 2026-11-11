/**
 * The coastlines projected straight down onto a sphere inside the Earth:
 * without them a coloured ball down there says nothing about where its
 * patches lie. A point of the sphere faces the camera when p·c > r²; that
 * side is the veil over the far one, and its lines are fainter to match.
 */

import * as THREE from 'three';
import { outlineSegmentPositions, type OutlineData } from './outlines';

const VERTEX_SHADER = `
  uniform vec3 uCameraPos;
  uniform float uRadiusSq;
  varying float vNear;
  void main() {
    vNear = step(uRadiusSq, dot(position, uCameraPos));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAGMENT_SHADER = `
  varying float vNear;
  void main() {
    gl_FragColor = vec4(1.0, 1.0, 1.0, mix(0.42, 0.16, vNear));
  }
`;

export class ProjectedCoast {
  readonly object: THREE.LineSegments;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(outlines: OutlineData, radiusM: number, name: string, renderOrder: number) {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(outlineSegmentPositions(outlines.layers.coastline ?? [], outlines.quantumPerDegree, radiusM), 3)
    );
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: { uCameraPos: { value: new THREE.Vector3() }, uRadiusSq: { value: radiusM * radiusM } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.object = new THREE.LineSegments(this.geometry, this.material);
    this.object.name = name;
    this.object.frustumCulled = false;
    this.object.renderOrder = renderOrder;
    const cameraPos = this.material.uniforms.uCameraPos.value as THREE.Vector3;
    this.object.onBeforeRender = (_renderer, _scene, camera) => {
      cameraPos.setFromMatrixPosition(camera.matrixWorld);
    };
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
