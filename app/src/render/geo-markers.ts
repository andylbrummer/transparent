/**
 * Point symbols for things on or in the Earth that are not earthquakes:
 * volcanoes, impact craters, the deepest points of the oceans, landmarks.
 *
 * Each marker is a small screen-aligned shape - a triangle for a volcano,
 * as on any map - in its own colour and CSS-pixel size, with a dark rim
 * so it holds up over bright imagery. Shapes, not colours, are what tell
 * these apart from the catalogue's dots and rings: the depth ramp already
 * owns red-to-violet.
 *
 * Like everything else here they draw without a depth test, straight
 * through the planet.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { RENDER_ORDER } from './order';

export const MARKER_SHAPES = ['disc', 'triangle', 'ring', 'diamond', 'square', 'star', 'cross'] as const;
export type MarkerShape = (typeof MARKER_SHAPES)[number];

export interface GeoMarker {
  readonly lon: number;
  readonly lat: number;
  /** Metres above the sphere (negative: below). Default 0. */
  readonly altitudeM?: number;
  readonly shape: MarkerShape;
  /** 0xRRGGBB, drawn as given. */
  readonly color: number;
  /** Width of the symbol's box, CSS px. */
  readonly sizePx: number;
  /** Default 1. */
  readonly alpha?: number;
}

/** ECEF metres of a point `altitudeM` above the sphere. */
export function ecefAtAltitude(lonDeg: number, latDeg: number, altitudeM: number, target: THREE.Vector3): THREE.Vector3 {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const r = EARTH_RADIUS_M + altitudeM;
  return target.set(r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat));
}

export interface GeoMarkerBuffers {
  readonly positions: Float32Array;
  /** r, g, b (display values 0..1) and alpha. */
  readonly colors: Float32Array;
  /** Size in CSS px, then the shape's index in MARKER_SHAPES. */
  readonly styles: Float32Array;
}

/** Vertex buffers in the order given: later markers draw over earlier ones. */
export function buildGeoMarkerBuffers(markers: readonly GeoMarker[]): GeoMarkerBuffers {
  const positions = new Float32Array(markers.length * 3);
  const colors = new Float32Array(markers.length * 4);
  const styles = new Float32Array(markers.length * 2);
  const point = new THREE.Vector3();
  markers.forEach((marker, i) => {
    ecefAtAltitude(marker.lon, marker.lat, marker.altitudeM ?? 0, point).toArray(positions, i * 3);
    colors[i * 4] = ((marker.color >> 16) & 255) / 255;
    colors[i * 4 + 1] = ((marker.color >> 8) & 255) / 255;
    colors[i * 4 + 2] = (marker.color & 255) / 255;
    colors[i * 4 + 3] = marker.alpha ?? 1;
    styles[i * 2] = marker.sizePx;
    styles[i * 2 + 1] = MARKER_SHAPES.indexOf(marker.shape);
  });
  return { positions, colors, styles };
}

const VERTEX_SHADER = `
  attribute vec4 aColor;
  attribute vec2 aStyle;
  uniform float uPixelRatio;
  varying vec4 vColor;
  varying float vShape;
  varying float vSizePx;
  void main() {
    vColor = aColor;
    vShape = aStyle.y;
    // Room round the shape for its dark rim.
    vSizePx = aStyle.x * uPixelRatio + 5.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = vSizePx;
  }
`;

/**
 * Signed distance to each shape in a box of −1..1 (y up), negative inside.
 * Exported for the test that every shape fits its box and holds its centre
 * or, for the ring, does not.
 */
export const MARKER_SDF_GLSL = `
  float markerDistance(vec2 p, float shape) {
    vec2 a = abs(p);
    if (shape < 0.5) return length(p) - 0.86;
    if (shape < 1.5) {
      // Upright triangle: apex at the top, base along the bottom.
      vec2 q = vec2(a.x, p.y);
      return max(dot(q, vec2(0.8660254, 0.5)) - 0.46, -q.y - 0.72);
    }
    if (shape < 2.5) return abs(length(p) - 0.7) - 0.16;
    if (shape < 3.5) return (a.x + a.y - 0.92) * 0.7071;
    if (shape < 4.5) return max(a.x, a.y) - 0.72;
    if (shape < 5.5) return (sqrt(a.x) + sqrt(a.y) - 0.98) * 0.5;
    return min(max(a.x - 0.24, a.y - 0.9), max(a.y - 0.24, a.x - 0.9));
  }
`;

const FRAGMENT_SHADER = `
  varying vec4 vColor;
  varying float vShape;
  varying float vSizePx;
  ${MARKER_SDF_GLSL}
  void main() {
    vec2 p = (gl_PointCoord - 0.5) * 2.0;
    p.y = -p.y;
    // The shape fills the box less its margin; distance in device pixels.
    float inner = 0.5 * (vSizePx - 5.0);
    float d = markerDistance(p * (0.5 * vSizePx / inner), vShape) * inner;
    float fill = 1.0 - smoothstep(-0.6, 0.6, d);
    // A dark rim just outside the shape: a small symbol stays its own colour and still parts from what is behind.
    float rim = 0.75 * (1.0 - smoothstep(1.0, 2.2, d));
    float alpha = max(fill, rim);
    if (alpha <= 0.003) discard;
    gl_FragColor = vec4(vColor.rgb * mix(0.12, 1.0, fill), alpha * vColor.a);
  }
`;

export class GeoMarkers {
  readonly object: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  /** `pixelRatio` is shared by reference with the app's other point layers. */
  constructor(name: string, pixelRatio: { value: number }, renderOrder: number = RENDER_ORDER.quakes - 0.2) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: { uPixelRatio: pixelRatio },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.object = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.object.name = name;
    this.object.frustumCulled = false;
    this.object.renderOrder = renderOrder;
  }

  setMarkers(markers: readonly GeoMarker[]): void {
    const buffers = buildGeoMarkerBuffers(markers);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(buffers.colors, 4));
    geometry.setAttribute('aStyle', new THREE.BufferAttribute(buffers.styles, 2));
    this.object.geometry.dispose();
    this.object.geometry = geometry;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Segment endpoints (x0,y0,z0, x1,y1,z1, ...) of a circle on the sphere:
 * every point `radiusKm` along the ground from (lon, lat). For a ring drawn
 * at a crater's true size.
 */
export function groundCircleSegments(lonDeg: number, latDeg: number, radiusKm: number, steps: number, out: number[]): void {
  const centre = ecefAtAltitude(lonDeg, latDeg, 0, new THREE.Vector3()).normalize();
  // Any unit vector square to the centre, and the third of the frame.
  const east = new THREE.Vector3(0, 0, 1).cross(centre);
  if (east.lengthSq() < 1e-12) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(centre, east);
  const arc = (radiusKm * 1000) / EARTH_RADIUS_M;
  const along = Math.cos(arc) * EARTH_RADIUS_M;
  const across = Math.sin(arc) * EARTH_RADIUS_M;
  let previous: [number, number, number] | null = null;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const c = Math.cos(angle) * across;
    const s = Math.sin(angle) * across;
    const point: [number, number, number] = [
      centre.x * along + east.x * c + north.x * s,
      centre.y * along + east.y * c + north.y * s,
      centre.z * along + east.z * c + north.z * s,
    ];
    if (previous) out.push(...previous, ...point);
    previous = point;
  }
}
