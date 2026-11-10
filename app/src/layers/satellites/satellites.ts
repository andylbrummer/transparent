/**
 * Satellites where they are now: every object of a CelesTrak group
 * propagated with SGP4 and drawn at its true place and height.
 *
 * Eleven thousand Starlinks cannot each be propagated every frame on a
 * phone. So SGP4 runs for a slice of the group per frame - every satellite
 * every few seconds - and writes a position and a velocity in the inertial
 * (TEME) frame; the vertex shader carries each point along its velocity,
 * curved by the Earth's pull, for the seconds in between, and the whole
 * group is turned by sidereal time to sit over the rotating Earth. One
 * draw call, no per-frame allocation, and motion that is smooth at any
 * frame rate.
 *
 * The shader also works out, per satellite, whether it is in sunlight or
 * in the Earth's shadow (umbra and penumbra cones from the real Sun
 * direction) and whether it is above the user's horizon. From the surface
 * a line of sight to anything below the horizon passes through the
 * planet, so "below the horizon" is exactly "seen through the Earth":
 * those are drawn fainter. A sunlit satellite above the horizon while the
 * user stands in darkness - one actually visible to the eye - is drawn
 * larger.
 *
 * Orbit lines are one revolution ahead of the satellite, drawn in the
 * same inertial frame: there an orbit is the closed ellipse it really is,
 * the planet turns inside it, and a geostationary orbit is a ring. Drawn
 * Earth-fixed instead it would be the open rosette of a ground track,
 * which says less about the orbit and tangles when many are shown.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M, greenwichMeanSiderealTime, precessionMatrix, sunGeocentricAu } from '@transparent-earth/core';
import type { SatRec } from 'satellite.js';
import type { GroupLabel, LabelGroup } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { SEEN_THROUGH_EARTH, SpaceLines, skyDirectionOf } from '../../render/space-lines';
import type { FrameState, LayerContext, LayerInstance, StatusTone } from '../types';
import { loadGpGroup, type GpSet } from './gp-source';
import { LAYER_SPECS, NAMED_SIZE_FACTOR, labelText, type LayerSpec, type Naming } from './groups';
import { EARTH_GM, PENUMBRA_FLARE, UMBRA_TAPER, parseGpCsv, periodMinutes, propagateTeme, toSatrec, toSphericalWorld, type GpRecord } from './orbit-math';

/** Every satellite is re-propagated this often; between, the shader extrapolates (to within a metre or two). */
const REPROPAGATE_MS = 4000;
/** SGP4 runs per frame while a group is first filled or after the clock jumps. */
const FILL_PER_FRAME = 1500;
/** Satellites initialised per slice while loading, so a big group does not freeze the page. */
const INIT_SLICE = 1000;
/** A change of the clock larger than this between frames is a jump (a pinned time, a sleeping tab), not the passage of time. */
const JUMP_MS = 5000;
/** Seconds since the base instant are held in 32-bit floats: start afresh before they lose their milliseconds. */
const REBASE_MS = 6 * 3600 * 1000;
const ORBIT_SEGMENTS = 160;
const LABEL_REFRESH_MS = 20000;
const SUN_INTERVAL_MS = 1000;
/** Names of the long tail of a group, after the star names (6.4). */
const OTHER_NAMES_RANK = 6.45;
/** Element sets older than this against the shown time: positions are drawn dimmer and the chip says so. */
export const STALE_AGE_DAYS = 14;
/** The Sun this far below the user's horizon (sine of 6°): dark enough to see satellites. */
const DARK_SUN_SINE = Math.sin((-6 * Math.PI) / 180);

const POINT_VERTEX = `
  attribute vec3 aVelocity;
  attribute float aTime;
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uNow;
  uniform vec3 uSunDir;
  uniform vec3 uObserverUp;
  uniform float uPixelRatio;
  uniform float uDark;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    // Along the velocity, bent by gravity: a few seconds of a two-body orbit.
    float dt = uNow - aTime;
    float r = length(position);
    vec3 p = position + aVelocity * dt - (${EARTH_GM.toExponential(9)} * 0.5 * dt * dt / (r * r * r)) * position;
    // The Earth's shadow: full inside the umbra cone, none outside the penumbra cone.
    float along = dot(p, uSunDir);
    float perp = length(p - along * uSunDir);
    float lit = along >= 0.0 ? 1.0 : smoothstep(${EARTH_RADIUS_M.toFixed(1)} + along * ${UMBRA_TAPER.toFixed(8)}, ${EARTH_RADIUS_M.toFixed(1)} - along * ${PENUMBRA_FLARE.toFixed(8)}, perp);
    vec4 world = modelMatrix * vec4(p, 1.0);
    float above = step(0.0, dot(world.xyz - cameraPosition, uObserverUp));
    vColor = aColor * mix(0.5, 1.0, lit);
    // A satellite that never propagated (decayed, or elements too old) stays at the origin, unseen.
    vAlpha = mix(${SEEN_THROUGH_EARTH.toFixed(2)}, 1.0, above) * step(1.0, r);
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_PointSize = aSize * uPixelRatio * (1.0 + 0.7 * above * lit * uDark);
  }
`;

const POINT_FRAGMENT = `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.55, 1.0, r)) * vAlpha * uOpacity;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

interface Satellite {
  readonly record: GpRecord;
  readonly satrec: SatRec;
  readonly sourceIndex: number;
  readonly naming: Naming | null;
}

/** The chip: whose elements, how old against the shown time. */
export function elementsStatus(
  origin: GpSet['origin'],
  medianEpochMs: number,
  clockMs: number
): { text: string; tone: StatusTone } {
  const date = new Date(medianEpochMs);
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const ageDays = Math.abs(clockMs - medianEpochMs) / 86400000;
  if (ageDays > STALE_AGE_DAYS) return { text: `elements of ${day}, ${Math.round(ageDays)} d from the shown time · approximate`, tone: 'stale' };
  if (origin === 'baked') return { text: `offline · elements of ${day}`, tone: 'stale' };
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  if (origin === 'cached') return { text: `cached · elements of ${day} ${time} UTC`, tone: 'stale' };
  return { text: `live · elements of ${day.replace(/ \d{4}$/, '')} ${time} UTC`, tone: 'live' };
}

const yieldToPage = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function loadSatellites(context: LayerContext, spec: LayerSpec): Promise<{ satellites: Satellite[]; origin: GpSet['origin'] }> {
  const sets = await Promise.all(spec.sources.map((source) => loadGpGroup(context, source.group)));
  const satellites: Satellite[] = [];
  const seen = new Set<number>();
  for (let sourceIndex = 0; sourceIndex < sets.length; sourceIndex++) {
    const records = parseGpCsv(sets[sourceIndex].text);
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      // The same satellite can be in two groups (Sentinel-3 is both weather and Earth resources).
      if (seen.has(record.norad)) continue;
      seen.add(record.norad);
      satellites.push({ record, satrec: toSatrec(record), sourceIndex, naming: spec.naming(record, sourceIndex) });
      if (satellites.length % INIT_SLICE === 0) await yieldToPage();
    }
  }
  if (satellites.length === 0) throw new Error('no element sets');
  // Named ones first: they are propagated first, and their labels are placed in this order.
  satellites.sort((a, b) => (a.naming?.priority ?? 99) - (b.naming?.priority ?? 99));
  const rank = { baked: 0, cached: 1, live: 2 } as const;
  const origin = sets.reduce<GpSet['origin']>((worst, set) => (rank[set.origin] < rank[worst] ? set.origin : worst), 'live');
  return { satellites, origin };
}

export async function createSatelliteLayer(context: LayerContext, id: string): Promise<LayerInstance> {
  const spec = LAYER_SPECS[id];
  if (!spec) throw new Error(`no satellite layer "${id}"`);
  const { satellites, origin } = await loadSatellites(context, spec);
  const count = satellites.length;
  const epochs = satellites.map((s) => s.record.epochMs).sort((a, b) => a - b);
  const medianEpochMs = epochs[epochs.length >> 1];

  // Turned by sidereal time each frame: its children are in TEME metres.
  const inertial = new THREE.Group();
  inertial.name = `${id}-teme`;
  context.earthRoot.add(inertial);

  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const times = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  satellites.forEach((satellite, i) => {
    colors.set(spec.sources[satellite.sourceIndex].color, i * 3);
    sizes[i] = spec.sizePx * (satellite.naming && satellite.naming.priority === 0 ? NAMED_SIZE_FACTOR : 1);
  });
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const velocityAttribute = new THREE.BufferAttribute(velocities, 3).setUsage(THREE.DynamicDrawUsage);
  const timeAttribute = new THREE.BufferAttribute(times, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('aVelocity', velocityAttribute);
  geometry.setAttribute('aTime', timeAttribute);
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setDrawRange(0, 0);
  const sunDir = new THREE.Vector3(1, 0, 0);
  const opacity = { value: 1 };
  const material = new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    uniforms: {
      uNow: { value: 0 },
      uSunDir: { value: sunDir },
      uDark: { value: 0 },
      uOpacity: opacity,
      uObserverUp: context.skyUniforms.uObserverUp,
      uPixelRatio: context.skyUniforms.uPixelRatio,
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = id;
  points.frustumCulled = false;
  points.renderOrder = RENDER_ORDER.nearSpace + 0.1;
  inertial.add(points);

  // Orbit lines: one revolution each, rebuilt one orbit per frame.
  const orbiting: number[] = [];
  satellites.forEach((satellite, i) => {
    if (spec.orbit(satellite.record, satellite.naming)) orbiting.push(i);
  });
  const orbitPositions = new Float32Array(orbiting.length * ORBIT_SEGMENTS * 6);
  let lines: SpaceLines | null = null;
  if (orbiting.length > 0) {
    const alphas = new Float32Array(orbiting.length * ORBIT_SEGMENTS * 2);
    const lineColors = new Float32Array(orbiting.length * ORBIT_SEGMENTS * 6);
    // Many orbits in one shell (a navigation constellation) overlap into planes: keep each faint.
    const strength = orbiting.length > 12 ? 0.3 : 0.75;
    orbiting.forEach((satelliteIndex, o) => {
      const color = spec.sources[satellites[satelliteIndex].sourceIndex].color;
      for (let v = 0; v < ORBIT_SEGMENTS * 2; v++) {
        // Brightest just ahead of the satellite, fading round to where it has just been.
        const along = ((v + 1) >> 1) / ORBIT_SEGMENTS;
        alphas[o * ORBIT_SEGMENTS * 2 + v] = strength * (1 - 0.8 * along);
        lineColors.set(color, (o * ORBIT_SEGMENTS * 2 + v) * 3);
      }
    });
    lines = new SpaceLines(orbitPositions, lineColors, alphas, context.skyUniforms, { name: `${id}-orbits`, dynamic: true });
    lines.object.visible = false;
    inertial.add(lines.object);
  }

  const named: number[] = [];
  satellites.forEach((satellite, i) => {
    if (satellite.naming) named.push(i);
  });
  // Names. The label layer keeps a separate allowance for names on the sky, which the ground's own names cannot
  // use up: so each is given as the direction from the eye, among the stars, and moved every frame.
  const labelWorld = named.map(() => new THREE.Vector3());
  const labelPoints = named.map(() => new THREE.Vector3());
  const toInertial = new THREE.Quaternion();
  let labelTexts: string[] = [];
  let labels: LabelGroup[] = [];

  const state = [0, 0, 0, 0, 0, 0];
  const world = [0, 0, 0];
  let visible = false;
  let baseMs = NaN;
  let lastMs = NaN;
  let cursor = 0;
  let filled = 0;
  /** Satellites propagated since the clock last moved: at `count`, a pinned clock has nothing left to do. */
  let settled = 0;
  let orbitCursor = 0;
  let orbitsBuilt = 0;
  let orbitsSettled = 0;
  let lastSunMs = NaN;
  let lastLabelWall = -Infinity;
  let status = '';

  function propagateInto(index: number, dateMs: number): void {
    const satellite = satellites[index];
    const o = index * 3;
    if (propagateTeme(satellite.satrec, satellite.record.epochMs, dateMs, state)) {
      toSphericalWorld(state[0], state[1], state[2], positions, o);
      velocities[o] = state[3] * 1000;
      velocities[o + 1] = state[4] * 1000;
      velocities[o + 2] = state[5] * 1000;
    } else {
      positions[o] = positions[o + 1] = positions[o + 2] = 0;
      velocities[o] = velocities[o + 1] = velocities[o + 2] = 0;
    }
    times[index] = (dateMs - baseMs) / 1000;
  }

  function propagateSlice(dateMs: number, budget: number): void {
    const start = cursor;
    const n = Math.min(budget, count);
    for (let k = 0; k < n; k++) {
      propagateInto(cursor, dateMs);
      cursor = cursor + 1 === count ? 0 : cursor + 1;
    }
    for (const attribute of [positionAttribute, velocityAttribute, timeAttribute]) {
      const size = attribute.itemSize;
      attribute.clearUpdateRanges();
      if (start + n <= count) {
        attribute.addUpdateRange(start * size, n * size);
      } else {
        attribute.addUpdateRange(start * size, (count - start) * size);
        attribute.addUpdateRange(0, (start + n - count) * size);
      }
      attribute.needsUpdate = true;
    }
    if (filled < count) {
      filled = Math.min(count, filled + n);
      geometry.setDrawRange(0, filled);
    }
  }

  function buildOrbit(o: number, dateMs: number): void {
    const satellite = satellites[orbiting[o]];
    const stepMs = (periodMinutes(satellite.record.meanMotion) * 60000) / ORBIT_SEGMENTS;
    const base = o * ORBIT_SEGMENTS * 6;
    let ok = true;
    for (let k = 0; k <= ORBIT_SEGMENTS && ok; k++) {
      ok = propagateTeme(satellite.satrec, satellite.record.epochMs, dateMs + k * stepMs, state);
      if (!ok) break;
      toSphericalWorld(state[0], state[1], state[2], world);
      // Each inner point ends one segment and begins the next.
      if (k > 0) orbitPositions.set(world, base + (k - 1) * 6 + 3);
      if (k < ORBIT_SEGMENTS) orbitPositions.set(world, base + k * 6);
    }
    if (!ok) orbitPositions.fill(0, base, base + ORBIT_SEGMENTS * 6);
    const attribute = lines!.positions;
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(base, ORBIT_SEGMENTS * 6);
    attribute.needsUpdate = true;
  }

  /** Where satellite `index` is at `seconds` on the shader's clock, Earth-fixed metres: the shader's arithmetic. */
  function placeNow(index: number, seconds: number, cosG: number, sinG: number, out: THREE.Vector3): void {
    const o = index * 3;
    const dt = seconds - times[index];
    const x = positions[o];
    const y = positions[o + 1];
    const z = positions[o + 2];
    const r = Math.hypot(x, y, z);
    const pull = r > 1 ? (EARTH_GM * 0.5 * dt * dt) / (r * r * r) : 0;
    const px = x + velocities[o] * dt - pull * x;
    const py = y + velocities[o + 1] * dt - pull * y;
    out.set(cosG * px + sinG * py, -sinG * px + cosG * py, z + velocities[o + 2] * dt - pull * z);
  }

  function refreshLabels(): void {
    const texts = named.map((index, i) => {
      const p = labelWorld[i];
      const r = p.length();
      // Not propagated: no label.
      if (r < 1) return '';
      return labelText(satellites[index].naming!, (r - EARTH_RADIUS_M) / 1000, (Math.atan2(p.y, p.x) * 180) / Math.PI);
    });
    if (texts.length === labelTexts.length && texts.every((text, i) => text === labelTexts[i])) return;
    labelTexts = texts;
    for (const group of labels) group.remove();
    const first: GroupLabel[] = [];
    const rest: GroupLabel[] = [];
    texts.forEach((text, i) => {
      const priority = satellites[named[i]].naming!.priority;
      if (text !== '') (priority === 0 ? first : rest).push({ text, priority: priority + i / 1000, position: labelPoints[i] });
    });
    // The best-known names go ahead of the stars' names; the long tail waits its turn after them.
    const style = { fontPx: 10, color: spec.labelColor, offsetYPx: 11 };
    labels = [
      context.addLabels({ rank: spec.labelRank, style, frame: 'sky', labels: first }),
      context.addLabels({ rank: OTHER_NAMES_RANK, style, frame: 'sky', labels: rest }),
    ];
    for (const group of labels) group.setVisible(visible);
  }

  function update(frame: FrameState): void {
    const dateMs = frame.date.getTime();
    const gmst = greenwichMeanSiderealTime(frame.date);
    // Earth-fixed = TEME turned by -GMST about the pole.
    inertial.rotation.z = -gmst;

    const jumped = !(Math.abs(dateMs - lastMs) < JUMP_MS) || dateMs - baseMs > REBASE_MS;
    if (jumped) {
      baseMs = dateMs;
      cursor = 0;
      filled = 0;
      orbitsBuilt = 0;
      geometry.setDrawRange(0, 0);
      if (lines) lines.object.visible = false;
      lastSunMs = NaN;
    }
    if (dateMs !== lastMs) {
      settled = 0;
      orbitsSettled = 0;
    }
    lastMs = dateMs;

    if (settled < count) {
      const budget = filled < count ? FILL_PER_FRAME : Math.max(1, Math.min(FILL_PER_FRAME, Math.ceil((count * frame.deltaMs) / REPROPAGATE_MS)));
      propagateSlice(dateMs, budget);
      settled += budget;
    }
    material.uniforms.uNow.value = (dateMs - baseMs) / 1000;

    if (lines && filled >= count && orbitsSettled < orbiting.length) {
      buildOrbit(orbitCursor, dateMs);
      orbitCursor = orbitCursor + 1 === orbiting.length ? 0 : orbitCursor + 1;
      orbitsSettled++;
      if (orbitsBuilt < orbiting.length && ++orbitsBuilt === orbiting.length) lines.object.visible = visible;
    }

    if (!(Math.abs(dateMs - lastSunMs) < SUN_INTERVAL_MS)) {
      lastSunMs = dateMs;
      // The Sun's direction in the frame of the points: ICRS carried to the equator of date.
      const sun = sunGeocentricAu(frame.date);
      const p = precessionMatrix(frame.date);
      sunDir.set(p[0] * sun[0] + p[1] * sun[1] + p[2] * sun[2], p[3] * sun[0] + p[4] * sun[1] + p[5] * sun[2], p[6] * sun[0] + p[7] * sun[1] + p[8] * sun[2]).normalize();
      // The same direction Earth-fixed, against the user's zenith: is it night where they stand?
      const up = context.skyUniforms.uObserverUp.value;
      const c = Math.cos(gmst);
      const s = Math.sin(gmst);
      const sineAltitude = (c * sunDir.x + s * sunDir.y) * up.x + (-s * sunDir.x + c * sunDir.y) * up.y + sunDir.z * up.z;
      material.uniforms.uDark.value = sineAltitude < DARK_SUN_SINE ? 1 : 0;

      const next = elementsStatus(origin, medianEpochMs, dateMs);
      opacity.value = Math.abs(dateMs - medianEpochMs) > STALE_AGE_DAYS * 86400000 ? 0.55 : 1;
      lines?.setOpacity(opacity.value);
      if (next.text !== status) {
        status = next.text;
        context.setStatus(next.text, next.tone);
      }
    }

    if (named.length > 0 && filled >= count) {
      const seconds = (dateMs - baseMs) / 1000;
      const c = Math.cos(gmst);
      const s = Math.sin(gmst);
      toInertial.copy(context.inertialRoot.quaternion).invert();
      for (let i = 0; i < named.length; i++) {
        placeNow(named[i], seconds, c, s, labelWorld[i]);
        skyDirectionOf(labelWorld[i], frame.camera, toInertial, labelPoints[i]);
      }
      const wall = performance.now();
      if (jumped || wall - lastLabelWall > LABEL_REFRESH_MS || labels.length === 0) {
        lastLabelWall = wall;
        refreshLabels();
      }
    }
  }

  return {
    setVisible(next) {
      visible = next;
      points.visible = next;
      if (lines) lines.object.visible = next && orbitsBuilt >= orbiting.length;
      for (const group of labels) group.setVisible(next);
    },
    update,
    dispose() {
      inertial.removeFromParent();
      geometry.dispose();
      material.dispose();
      lines?.dispose();
      for (const group of labels) group.remove();
    },
  };
}
