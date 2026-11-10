/**
 * The slow bodies of the lower mantle as shapes: the surface on which
 * SEMUCB-WM1's shear-velocity anomaly is −0.8 %, from 1,050 km down to
 * the core (app/public/geo/tomography-bodies-slow.bin,
 * tools/pipeline/generate_tomography_bodies.py).
 *
 * The depth slices show one level at a time; this shows what the levels
 * add up to - two continent-sized piles standing on the core under Africa
 * and the Pacific, with columns rising off them.
 *
 * They are drawn as the slabs are (src/layers/slabs), and for the same
 * reasons: a first pass writes their depth alone and the second draws
 * only the nearest surface, so a body hides its own far wall and the
 * bodies and slabs hide each other, without sorting; they are lit, so
 * the walls turn; and depth is drawn on them, as colour - dark on the
 * core, light at the top - and as a contour every 250 km. A body seen
 * through the core is dimmed, which is what tells the far side of the
 * mantle from the near one.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { ecefAtDepth } from '../../render/interior';
import { LABEL_KIND_ORDER, type GroupLabel } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { SLAB_DEPTH_GLSL } from '../slabs/slabs';
import type { LayerContext, LayerInstance } from '../types';
import { BODY_BASE_KM, BODY_COLORS, BODY_TOP_KM, TOMOGRAPHY_BODIES_ID } from './shells';

/** Depth contours drawn on the bodies, km. */
export const BODY_CONTOUR_KM = 250;

export interface BodyMesh {
  /** x, y, z per vertex, ECEF metres. */
  readonly positions: Float32Array;
  /** Three vertex numbers per triangle, wound to face outward. */
  readonly indices: Uint16Array;
}

/** Parse tomography-bodies-slow.bin (layout in generate_tomography_bodies.py). */
export function parseBody(buffer: ArrayBuffer, quantum: number): BodyMesh {
  if (buffer.byteLength < 8) throw new Error(`tomography body is cut short: ${buffer.byteLength} bytes`);
  const view = new DataView(buffer);
  const vertices = view.getUint32(0, true);
  const count = view.getUint32(4, true);
  const end = 8 + vertices * 6 + count * 2;
  if (end > buffer.byteLength) throw new Error(`tomography body is cut short: needs ${end} bytes, has ${buffer.byteLength}`);
  if (count % 3 !== 0) throw new Error(`tomography body: ${count} indices are not whole triangles`);
  const scale = EARTH_RADIUS_M / quantum;
  const positions = new Float32Array(vertices * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = view.getInt16(8 + 2 * i, true) * scale;
  const indices = new Uint16Array(count);
  const at = 8 + vertices * 6;
  for (let i = 0; i < count; i++) {
    indices[i] = view.getUint16(at + 2 * i, true);
    if (indices[i] >= vertices) throw new Error(`tomography body: index ${indices[i]} of ${vertices} vertices`);
  }
  return { positions, indices };
}

/** A connected piece of a body, as the bake measured it (tomography-bodies.json). */
export interface BodyPiece {
  readonly volumeMillionKm3: number;
  /** The direction of its centre of volume and its mean depth. */
  readonly centre: { readonly lon: number; readonly lat: number; readonly depthKm: number };
  readonly topKm: number;
  readonly bottomKm: number;
}

interface BodiesMeta {
  readonly quantum: number;
  readonly thresholdPercent: number;
  readonly meshes: readonly { readonly name: string; readonly file: string; readonly pieces: readonly BodyPiece[] }[];
}

/**
 * The name the literature gives a slow piece centred here (e.g. Garnero,
 * McNamara & Shim 2016, Nature Geoscience 9, 481): there are two large
 * low-shear-velocity provinces, one under Africa and one under the Pacific.
 * Elsewhere: no name.
 */
export function provinceName(lon: number, lat: number): string | null {
  if (Math.abs(lat) > 50) return null;
  if (lon > -30 && lon < 60) return 'African LLSVP';
  if (lon > 150 || lon < -110) return 'Pacific LLSVP';
  return null;
}

/** Names for the two biggest slow pieces, each at its centre: the model and the contour are part of the name. */
export function provinceLabels(pieces: readonly BodyPiece[], thresholdPercent: number): GroupLabel[] {
  return pieces.slice(0, 2).flatMap((piece, i) => {
    const name = provinceName(piece.centre.lon, piece.centre.lat);
    if (!name) return [];
    return [
      {
        text: `${name} · −${thresholdPercent} % contour (model)`,
        priority: i,
        position: ecefAtDepth(piece.centre.lon, piece.centre.lat, piece.centre.depthKm, new THREE.Vector3()),
      },
    ];
  });
}

const VERTEX_SHADER = `
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vViewDistance;
  void main() {
    // The mesh is in ECEF metres under an unrotated root: object space is world space.
    vWorld = position;
    vNormal = normal;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDistance = -viewPosition.z;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

/**
 * bodyOpen: a body stands on the core, and from the other side of the
 * planet it is its flat base that faces the user - a red patch with no
 * shape. So the base is left open where it faces the eye, and the view
 * goes up into the body to its roof: the columns show as light rings
 * of contours, as a hill does on a map.
 */
const BODY_OPEN_GLSL = `
  bool bodyOpen(vec3 world, vec3 outward, vec3 ray) {
    float depthKm = (${EARTH_RADIUS_M.toFixed(1)} - length(world)) / 1000.0;
    return depthKm > ${(BODY_BASE_KM - 6).toFixed(1)} && dot(outward, ray) < 0.0 && dot(normalize(world), outward) < -0.5;
  }
`;

const DEPTH_FRAGMENT_SHADER = `
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vViewDistance;
  ${SLAB_DEPTH_GLSL}
  ${BODY_OPEN_GLSL}
  void main() {
    if (bodyOpen(vWorld, normalize(vNormal), normalize(vWorld - cameraPosition))) discard;
    gl_FragDepth = slabDepth(vViewDistance);
    gl_FragColor = vec4(0.0);
  }
`;

const km = (value: number): string => value.toFixed(1);

const COLOR_FRAGMENT_SHADER = `
  uniform vec3 uTop;
  uniform vec3 uBase;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vViewDistance;
  ${SLAB_DEPTH_GLSL}
  ${BODY_OPEN_GLSL}

  void main() {
    vec3 n = normalize(vNormal);
    vec3 toFragment = vWorld - cameraPosition;
    float range = length(toFragment);
    vec3 ray = toFragment / range;
    if (bodyOpen(vWorld, n, ray)) discard;
    float depthKm = (${EARTH_RADIUS_M.toFixed(1)} - length(vWorld)) / 1000.0;

    // Depth as colour: dark on the core, lightest where the body is cut off at the top.
    float height = clamp((${km(BODY_BASE_KM)} - depthKm) / ${km(BODY_BASE_KM - BODY_TOP_KM)}, 0.0, 1.0);
    vec3 color = mix(uBase, uTop, pow(height, 0.8));

    // Lit like a lamp held over the user's left shoulder, whichever face of the wall is seen:
    // a light fixed to the view models a shape the same from any side of the planet.
    vec3 nView = normalize(mat3(viewMatrix) * n);
    if (nView.z < 0.0) nView = -nView;
    float lambert = max(dot(nView, normalize(vec3(-0.5, 0.6, 0.62))), 0.0);
    color *= 0.42 + 0.78 * lambert;

    // A contour every ${BODY_CONTOUR_KM} km of depth, fading out where they would crowd.
    float perPixel = max(fwidth(depthKm), 1.0e-6);
    float interval = ${km(BODY_CONTOUR_KM)};
    float distancePx = abs(mod(depthKm + 0.5 * interval, interval) - 0.5 * interval) / perPixel;
    float line = (1.0 - smoothstep(0.6, 1.6, distancePx)) * smoothstep(5.0, 12.0, interval / perPixel);
    color = mix(color, mix(uTop, vec3(1.0), 0.6), 0.7 * line);

    // A wall seen edge-on catches the light: the outline of the body.
    float rim = pow(1.0 - nView.z, 3.0);
    color = mix(color, mix(uTop, vec3(1.0), 0.5), 0.5 * rim);

    float alpha = 0.78;
    // Overhead, a body would wall off everything below the user: near to, it thins to a tint
    // and its contours and outline carry the shape.
    alpha *= mix(0.2, 1.0, smoothstep(1.5e6, 4.5e6, range));
    alpha = max(alpha, max(0.75 * line, 0.6 * rim));
    // Behind the core: the ray meets the core's sphere before it gets here.
    float coreRadius = ${((EARTH_RADIUS_M - BODY_BASE_KM * 1000) * 0.985).toFixed(1)};
    float along = -dot(cameraPosition, ray);
    float missSq = dot(cameraPosition, cameraPosition) - along * along;
    float entry = along - sqrt(max(coreRadius * coreRadius - missSq, 0.0));
    if (missSq < coreRadius * coreRadius && entry > 0.0 && entry < range) {
      alpha *= 0.5;
    }

    // A hair nearer than the depth pass wrote, so its own surface always passes.
    gl_FragDepth = slabDepth(vViewDistance) - 4.0e-6;
    gl_FragColor = vec4(color, alpha);
  }
`;

/** The fragment shader, for the test that it draws depth the way the caption says. */
export const BODY_FRAGMENT_SHADER = COLOR_FRAGMENT_SHADER;

/** Display channels of 0xRRGGBB, written as they are. */
const displayColor = (hex: number): THREE.Vector3 => new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

export async function createTomographyBodiesLayer(context: LayerContext): Promise<LayerInstance> {
  const meta = await context.fetchJson<BodiesMeta>(context.assetUrl('geo/tomography-bodies.json'));
  const entry = meta.meshes.find((mesh) => mesh.name === 'slow');
  if (!entry) throw new Error('tomography-bodies.json has no "slow" mesh');
  const response = await fetch(context.assetUrl(`geo/${entry.file}`));
  if (!response.ok) throw new Error(`${entry.file}: HTTP ${response.status}`);
  const parsed = parseBody(await response.arrayBuffer(), meta.quantum);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(parsed.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(parsed.indices, 1));
  geometry.computeVertexNormals();

  const depthMaterial = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: DEPTH_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    colorWrite: false,
    depthTest: true,
    depthWrite: true,
  });
  const colorMaterial = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: COLOR_FRAGMENT_SHADER,
    uniforms: { uTop: { value: displayColor(BODY_COLORS.top) }, uBase: { value: displayColor(BODY_COLORS.base) } },
    side: THREE.DoubleSide,
    // The depth pass has chosen the surface; back faces then front faces would send every triangle twice.
    forceSinglePass: true,
    transparent: true,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    depthWrite: false,
  });
  // Over the depth slices (outlines + 0.5), which they stand on, and before the slabs,
  // which then draw over the bodies behind them and are hidden by the ones in front.
  const order = RENDER_ORDER.outlines + 0.6;
  const group = new THREE.Group();
  group.name = TOMOGRAPHY_BODIES_ID;
  for (const [material, renderOrder] of [
    [depthMaterial, order],
    [colorMaterial, order + 0.01],
  ] as const) {
    const object = new THREE.Mesh(geometry, material);
    object.frustumCulled = false;
    object.renderOrder = renderOrder;
    group.add(object);
  }
  context.earthRoot.add(group);

  const names = provinceLabels(entry.pieces, meta.thresholdPercent);
  const labels =
    names.length > 0
      ? context.addLabels({
          rank: LABEL_KIND_ORDER.indexOf('deep') - 0.5,
          style: { fontPx: 11, color: '#ffd9a8', italic: true, bold: true },
          frame: 'earth',
          labels: names,
        })
      : null;

  return {
    setVisible(visible) {
      group.visible = visible;
      labels?.setVisible(visible);
    },
    dispose() {
      labels?.remove();
      group.removeFromParent();
      geometry.dispose();
      depthMaterial.dispose();
      colorMaterial.dispose();
    },
  };
}
