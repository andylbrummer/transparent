/**
 * Subducting slabs drawn as what they are: plates of rock, tens of km
 * thick, bending down into the mantle. Geometry is Slab2's (see mesh.ts).
 *
 * Seen through the planet a slab is anywhere from under the user's feet to
 * 12,000 km off, from above, below or edge-on, and several often overlap
 * on screen. Three things make them read as solids rather than as a haze:
 *
 * - They occlude each other. Nothing else in the scene depth-tests, so the
 *   depth buffer is free: the slabs first write their depth alone, then
 *   draw only their nearest surface, blended over the globe behind. A fold
 *   hides what is behind it, as a solid's would, and no sorting is needed.
 *   The camera's own depth range (0.1 m to 1e9 m) leaves no precision at
 *   these distances, so both passes write a logarithmic depth of their own.
 * - They are lit: partly from the eye, partly from straight above, so a
 *   sheet darkens where it steepens and the dip shows from any side. A
 *   sheet seen at a grazing angle is more opaque, as a real one would be.
 * - Depth is drawn on them: the colour of DEPTH_RAMP - the same as the
 *   earthquakes, which draw over the plates afterwards and so sit visibly
 *   on and in them - with a contour every 20 km, brighter every 100 km,
 *   and a bright rim along each plate's outline.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { DEPTH_RAMP_GLSL, ecefAtDepth } from '../../render/interior';
import { LABEL_KIND_ORDER, type GroupLabel, type LabelGroup } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { SLAB_DEPTH_GLSL } from '../../render/slab-depth';
import type { LayerContext, LayerInstance } from '../types';
import { buildSlabMesh, parseSlabFile, slabDepthMarks, type SlabGrid } from './mesh';

/**
 * Depth contours drawn on the plates, km. The two fine ones show only where
 * they have room - on a plate close by, which has no outline or bright
 * contour in view to give its shape.
 */
export const SLAB_CONTOUR_KM = { finest: 1, fine: 5, minor: 20, major: 100 } as const;

/** How much of its face a plate keeps right under the user: enough to colour its lines' ground, not the far side. */
const NEAR_FACE_ALPHA = 0.06;

const VERTEX_SHADER = `
  attribute vec2 aInfo;
  uniform float uDepthBias;
  ${SLAB_DEPTH_GLSL}
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDepthKm;
  varying float vPart;
  varying float vEdgeKm;
  varying float vViewDistance;
  void main() {
    // The mesh is in ECEF metres under an unrotated root: object space is world space.
    vWorld = position;
    vNormal = normal;
    vDepthKm = (${EARTH_RADIUS_M.toFixed(1)} - length(position)) / 1000.0;
    vPart = aInfo.x;
    vEdgeKm = aInfo.y;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDistance = -viewPosition.z;
    gl_Position = projectionMatrix * viewPosition;
    // The slabs' own depth (see slab-depth.ts), set here rather than per
    // pixel: a shader that writes depth is run before the depth test, so the
    // colour pass would shade every hidden face in full and only then drop
    // it. Between the vertices of a 20 km mesh the logarithm is as good as
    // straight, and both passes interpolate alike.
    gl_Position.z = (2.0 * (slabDepth(vViewDistance) - uDepthBias) - 1.0) * gl_Position.w;
  }
`;

// The other solids in the mantle (the tomography bodies) write the same depth
// - that is what lets them and the slabs hide each other - and take it from here.
export { SLAB_DEPTH_GLSL };

/**
 * slabPresence: how solid a plate is drawn at a distance. A slab under the
 * user's feet would otherwise wall off everything below it - and even as a
 * faint tint it muddies the whole far side, since it fills the view - so
 * close to, the plate's faces clear and its lines carry the shape; below
 * half presence it no longer hides the slabs behind it either.
 */
const SLAB_PRESENCE_GLSL = `
  float slabPresence(float viewDistance) {
    return smoothstep(2.0e5, 1.5e6, viewDistance);
  }
`;

const DEPTH_FRAGMENT_SHADER = `
  varying float vViewDistance;
  ${SLAB_PRESENCE_GLSL}
  void main() {
    if (slabPresence(vViewDistance) < 0.5) discard;
    gl_FragColor = vec4(0.0);
  }
`;

const COLOR_FRAGMENT_SHADER = `
  uniform float uOpacity;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDepthKm;
  varying float vPart;
  varying float vEdgeKm;
  varying float vViewDistance;
  ${SLAB_PRESENCE_GLSL}
  ${DEPTH_RAMP_GLSL}

  // 1 on a contour of the interval, 0 away from it; lines widthPx wide, fading out where they would crowd.
  float contour(float depthKm, float interval, float widthPx) {
    float perPixel = max(fwidth(depthKm), 1.0e-6);
    float distancePx = abs(mod(depthKm + 0.5 * interval, interval) - 0.5 * interval) / perPixel;
    float crowding = smoothstep(4.0, 9.0, interval / perPixel);
    return (1.0 - smoothstep(widthPx * 0.5, widthPx * 0.5 + 1.0, distancePx)) * crowding;
  }

  void main() {
    bool wall = vPart > 1.5;
    bool bottom = !wall && vPart > 0.5;
    float presence = slabPresence(vViewDistance);
    // Close to, a plate is its upper face's lines and nothing else: the
    // underside and the cut edges would only repeat them, and a plate
    // underfoot covers every pixel several times over.
    if (presence <= 0.0 && (wall || bottom)) discard;

    vec3 n = normalize(vNormal);
    vec3 toEye = normalize(cameraPosition - vWorld);
    vec3 up = normalize(vWorld);
    float facing = abs(dot(n, toEye));
    float level = abs(dot(n, up));

    vec3 ramp = depthRampSrgb(vDepthKm);
    // Kept well under the ramp's own brightness: the earthquakes drawn over
    // a plate are the ramp at full strength, and must stand out against it.
    float light = 0.20 + 0.30 * facing + 0.22 * level;
    // The underside is the same rock in shadow; the cut edge catches the light.
    if (bottom) light *= 0.75;
    if (wall) light = 0.62 + 0.20 * facing;
    vec3 color = ramp * light;
    float alpha = wall ? 0.85 : (bottom ? 0.62 : 0.68);
    // A sheet seen edge-on puts more of itself along the line of sight.
    alpha = 1.0 - pow(1.0 - alpha, 1.0 / max(facing, 0.35));
    alpha *= mix(wall || bottom ? 0.0 : ${NEAR_FACE_ALPHA.toFixed(2)}, 1.0, presence);

    if (!wall) {
      float minor = contour(vDepthKm, ${SLAB_CONTOUR_KM.minor.toFixed(1)}, 1.0);
      float major = contour(vDepthKm, ${SLAB_CONTOUR_KM.major.toFixed(1)}, 1.8);
      // The underside's lines go with its face; the upper face keeps its own however close.
      float lines = bottom ? presence : 1.0;
      if (!bottom) {
        // The fine lines belong to the near view: further off the 20 km lines do their work.
        float near = 1.0 - presence;
        // Faint: a plate underfoot lays them across the whole view of the far side.
        float fine = max(contour(vDepthKm, ${SLAB_CONTOUR_KM.fine.toFixed(1)}, 1.2), 0.4 * contour(vDepthKm, ${SLAB_CONTOUR_KM.finest.toFixed(1)}, 1.0)) * near;
        color = mix(color, mix(ramp, vec3(1.0), 0.25), fine);
        alpha = max(alpha, fine * 0.45);
        // And the 20 km lines, dark on a lit plate, turn bright where the plate has cleared.
        color = mix(color, mix(ramp * 0.45, mix(ramp, vec3(1.0), 0.4), near), minor * mix(0.55, 1.0, near));
        alpha = max(alpha, minor * near * 0.7);
      } else {
        color = mix(color, ramp * 0.45, minor * 0.55);
      }
      color = mix(color, mix(ramp, vec3(1.0), 0.72), major);
      alpha = max(alpha, major * 0.95 * lines);
      // The outline: a rim two pixels wide where the distance to the edge runs
      // out. A pixel's size on the plate comes from the position, not from
      // the distance's own slope, which jumps between the slivers at the edge.
      // The smaller of its two spans: the one not stretched by a slanting view.
      float kmPerPixel = max(min(length(dFdx(vWorld)), length(dFdy(vWorld))) / 1000.0, 1.0e-4);
      float rim = 1.0 - smoothstep(1.5, 2.5, vEdgeKm / kmPerPixel);
      color = mix(color, mix(ramp, vec3(1.0), 0.5), rim);
      alpha = max(alpha, rim * 0.95 * lines);
    }

    gl_FragColor = vec4(color, alpha * uOpacity);
  }
`;

/** The fragment shader, for the test that it colours by the shared ramp. */
export const SLAB_FRAGMENT_SHADER = COLOR_FRAGMENT_SHADER;
/** The vertex shader, for the test that the slabs' depth is the one the earthquakes are tested against. */
export const SLAB_VERTEX_SHADER = VERTEX_SHADER;

/** Names for the slabs, each on its plate; the bigger slabs rank first. */
export function slabNameLabels(grids: readonly SlabGrid[]): GroupLabel[] {
  return grids.map(({ entry }) => ({
    text: `${entry.name} slab`,
    priority: -entry.vertexCount,
    position: ecefAtDepth(entry.label.lon, entry.label.lat, entry.label.depthKm, new THREE.Vector3()),
  }));
}

/** "300 km" on each bright contour of each slab. */
export function slabDepthLabels(grids: readonly SlabGrid[]): GroupLabel[] {
  return grids.flatMap((grid) =>
    slabDepthMarks(grid, SLAB_CONTOUR_KM.major).map((mark) => ({
      text: `${mark.contourKm} km`,
      priority: -grid.entry.vertexCount,
      position: ecefAtDepth(mark.lon, mark.lat, mark.depthKm, new THREE.Vector3()),
    }))
  );
}

export async function createSlabLayer(context: LayerContext): Promise<LayerInstance> {
  const response = await fetch(context.assetUrl('geo/slabs.bin'));
  if (!response.ok) throw new Error(`slabs.bin: HTTP ${response.status}`);
  const { grids } = parseSlabFile(await response.arrayBuffer());
  const mesh = buildSlabMesh(grids);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('aInfo', new THREE.BufferAttribute(mesh.info, 2));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

  const depthMaterial = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: DEPTH_FRAGMENT_SHADER,
    uniforms: { uDepthBias: { value: 0 } },
    side: THREE.DoubleSide,
    colorWrite: false,
    depthTest: true,
    depthWrite: true,
  });
  const colorMaterial = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: COLOR_FRAGMENT_SHADER,
    // A hair nearer than the depth pass wrote, so its own surface always passes.
    uniforms: { uOpacity: { value: 1 }, uDepthBias: { value: 4.0e-6 } },
    side: THREE.DoubleSide,
    // The shader lights both faces alike and the depth pass has already
    // chosen the surface: drawing back faces then front faces would only
    // send every triangle twice.
    forceSinglePass: true,
    transparent: true,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    depthWrite: false,
  });
  const group = new THREE.Group();
  group.name = 'slabs';
  for (const [material, order] of [
    [depthMaterial, RENDER_ORDER.interior],
    [colorMaterial, RENDER_ORDER.interior + 0.01],
  ] as const) {
    const object = new THREE.Mesh(geometry, material);
    object.frustumCulled = false;
    object.renderOrder = order;
    group.add(object);
  }
  context.earthRoot.add(group);

  const subduction = LABEL_KIND_ORDER.indexOf('subduction');
  const labels: LabelGroup[] = [
    context.addLabels({
      rank: subduction - 0.5,
      style: { fontPx: 11, color: '#ffc9b8', italic: true, bold: true },
      frame: 'earth',
      labels: slabNameLabels(grids),
    }),
    // Last of all: depth figures fill what room the names leave.
    context.addLabels({
      rank: LABEL_KIND_ORDER.length,
      style: { fontPx: 9, color: '#f2f2f2' },
      frame: 'earth',
      labels: slabDepthLabels(grids),
    }),
  ];

  return {
    setVisible(visible) {
      group.visible = visible;
      for (const label of labels) label.setVisible(visible);
    },
    dispose() {
      for (const label of labels) label.remove();
      group.removeFromParent();
      geometry.dispose();
      depthMaterial.dispose();
      colorMaterial.dispose();
    },
  };
}
