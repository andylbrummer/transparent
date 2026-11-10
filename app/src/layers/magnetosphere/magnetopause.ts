/**
 * The magnetopause: where the solar wind's pressure stops the Earth's
 * magnetic field. A MODEL surface - Shue et al. (1998) - sized by the
 * solar wind SWPC measures at L1 right now and pointed at where the Sun
 * really is. The real boundary ripples and breathes around it; this is
 * its average place for the present wind.
 *
 * Drawn as a wire cage: a bullet nose about ten Earth radii sunward,
 * flaring back into the tail, which is cut off at TAIL_ANGLE.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M, sunGeocentricAu } from '@transparent-earth/core';
import { SpaceLines, skyDirectionOf } from '../../render/space-lines';
import { MovingLabel } from '../sun/moving-label';
import type { LayerContext, LayerInstance } from '../types';
import {
  SOLAR_WIND_PATH,
  dynamicPressureNPa,
  fetchSwpcJson,
  loadSpaceWeatherSnapshot,
  parseSolarWind,
  parseSwpcTime,
  readingStatus,
  shueMagnetopause,
  shueRadius,
  type SolarWind,
} from './space-weather';

const MERIDIANS = 24;
const STEPS = 56;
const RINGS = 9;
const RING_SEGMENTS = 64;
/** The tail is drawn out to this angle from the Sun's direction: about 40 Earth radii downwind. */
const TAIL_ANGLE = (148 * Math.PI) / 180;
const REFRESH_MS = 5 * 60 * 1000;
const SUN_INTERVAL_MS = 1000;
const COLOR = [1, 0.62, 0.42] as const;

/** "nose 10.4 R⊕ · wind 676 km/s, 1.6 /cm³, Bz +2.1 nT". */
export function windText(wind: SolarWind): string {
  const model = shueMagnetopause(wind.bzNt, dynamicPressureNPa(wind.densityCm3, wind.speedKmS));
  const bz = `${wind.bzNt >= 0 ? '+' : '−'}${Math.abs(wind.bzNt).toFixed(1)}`;
  return `nose ${model.r0.toFixed(1)} R⊕ · wind ${Math.round(wind.speedKmS)} km/s, ${wind.densityCm3.toFixed(1)} /cm³, Bz ${bz} nT`;
}

export async function createMagnetopauseLayer(context: LayerContext): Promise<LayerInstance> {
  const segments = MERIDIANS * STEPS + RINGS * RING_SEGMENTS;
  const positions = new Float32Array(segments * 6);
  const colors = new Float32Array(segments * 6);
  const alphas = new Float32Array(segments * 2);
  for (let v = 0; v < segments * 2; v++) colors.set(COLOR, v * 3);
  const lines = new SpaceLines(positions, colors, alphas, context.skyUniforms, { name: 'magnetopause', dynamic: true });
  // Inertial axes; turned each second so that its own +x looks at the Sun.
  context.inertialRoot.add(lines.object);
  const label = new MovingLabel(context, 6.325, { fontPx: 11, color: '#ffc8a8' });

  const nose = new THREE.Vector3();
  const noseWorld = new THREE.Vector3();
  const sunDir = new THREE.Vector3(1, 0, 0);
  const toInertial = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0);
  let shown: { wind: SolarWind; fromNetwork: boolean } | null = null;
  let noseRadii = 10;
  let lastFetch = -Infinity;
  let lastSunMs = NaN;
  let busy = false;
  let disposed = false;
  let status = '';

  function build(wind: SolarWind): void {
    const model = shueMagnetopause(wind.bzNt, dynamicPressureNPa(wind.densityCm3, wind.speedKmS));
    noseRadii = model.r0;
    let v = 0;
    const put = (theta: number, phi: number): void => {
      const r = shueRadius(model, theta) * EARTH_RADIUS_M;
      const sin = Math.sin(theta);
      positions[v * 3] = r * Math.cos(theta);
      positions[v * 3 + 1] = r * sin * Math.cos(phi);
      positions[v * 3 + 2] = r * sin * Math.sin(phi);
      // Strong at the nose, thinning down the tail.
      alphas[v] = 0.55 * (1 - 0.8 * (theta / TAIL_ANGLE));
      v++;
    };
    for (let m = 0; m < MERIDIANS; m++) {
      const phi = (m / MERIDIANS) * 2 * Math.PI;
      for (let i = 0; i < STEPS; i++) {
        put((i / STEPS) * TAIL_ANGLE, phi);
        put(((i + 1) / STEPS) * TAIL_ANGLE, phi);
      }
    }
    for (let ring = 1; ring <= RINGS; ring++) {
      const theta = (ring / RINGS) * TAIL_ANGLE;
      for (let i = 0; i < RING_SEGMENTS; i++) {
        put(theta, (i / RING_SEGMENTS) * 2 * Math.PI);
        put(theta, ((i + 1) / RING_SEGMENTS) * 2 * Math.PI);
      }
    }
    lines.positions.needsUpdate = true;
    lines.alphas.needsUpdate = true;
  }

  function show(wind: SolarWind, fromNetwork: boolean): void {
    if (disposed) return;
    shown = { wind, fromNetwork };
    build(wind);
    status = '';
  }

  async function refresh(): Promise<void> {
    if (busy || disposed) return;
    busy = true;
    try {
      const wind = parseSolarWind(await fetchSwpcJson(context, SOLAR_WIND_PATH));
      if (!wind) throw new Error('no complete solar wind reading');
      show(wind, true);
    } catch (error) {
      // A reading already showing stays: an older real one beats the snapshot.
      if (shown === null) {
        console.error('magnetopause: live solar wind unavailable, using the baked snapshot', error);
        const snapshot = (await loadSpaceWeatherSnapshot(context)).solarWind;
        show({ timeMs: parseSwpcTime(snapshot.time), speedKmS: snapshot.speedKmS, densityCm3: snapshot.densityCm3, bzNt: snapshot.bzNt }, false);
      }
    } finally {
      busy = false;
    }
  }

  lastFetch = performance.now();
  await refresh();
  if (shown === null) throw new Error('no solar wind, live or baked');

  return {
    setVisible(visible) {
      lines.object.visible = visible;
      label.setVisible(visible);
    },
    update(frame) {
      const wall = performance.now();
      if (wall - lastFetch > REFRESH_MS) {
        lastFetch = wall;
        void refresh();
      }
      const dateMs = frame.date.getTime();
      if (!(Math.abs(dateMs - lastSunMs) < SUN_INTERVAL_MS)) {
        lastSunMs = dateMs;
        const sun = sunGeocentricAu(frame.date);
        sunDir.set(sun[0], sun[1], sun[2]).normalize();
        lines.object.quaternion.setFromUnitVectors(X, sunDir);
      }
      if (shown) {
        const next = readingStatus('solar wind', shown.wind.timeMs, shown.fromNetwork, dateMs, `nose ${noseRadii.toFixed(1)} R⊕`);
        if (next.text !== status) {
          status = next.text;
          context.setStatus(next.text, next.tone);
          label.set(`Magnetopause (model) · ${windText(shown.wind)}`, 14);
        }
      }
      // The nose, in the world, as a direction from the eye among the stars.
      nose.copy(sunDir).multiplyScalar(noseRadii * EARTH_RADIUS_M);
      noseWorld.copy(nose).applyQuaternion(context.inertialRoot.quaternion);
      toInertial.copy(context.inertialRoot.quaternion).invert();
      skyDirectionOf(noseWorld, frame.camera, toInertial, label.position);
    },
    dispose() {
      disposed = true;
      lines.dispose();
      label.dispose();
    },
  };
}
