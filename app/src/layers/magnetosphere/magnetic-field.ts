/**
 * The Earth's own magnetic field as a cage of field lines, traced through
 * the World Magnetic Model from a grid of footpoints around both
 * geomagnetic poles, with the poles marked.
 *
 * Lines run from the ground out to OUTER_RADII Earth radii. Those from low
 * magnetic latitudes arch over and come down in the other hemisphere;
 * those from near the poles leave the drawing and fade out - in reality
 * they are swept back into the magnetotail by the solar wind, which this
 * internal-field model knows nothing of (see the magnetopause layer).
 *
 * Nothing is drawn below ground. The model does hold down to the core-
 * mantle boundary as a potential field, but from where the user stands
 * the lines' short last legs through the mantle read as stray scratches,
 * not as a field.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M, WMM_VALID_FROM, WMM_VALID_UNTIL, decimalYear, geomagneticNorthPole, magneticDipPole } from '@transparent-earth/core';
import type { LabelGroup } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { SpaceLines, SpaceMarkers } from '../../render/space-lines';
import type { LayerContext, LayerInstance } from '../types';
import { SURFACE_KM, dipoleFootpoints, outwardSign, strengthColor, traceFieldLine, type TracedLine } from './field-lines';

/** How far out lines are followed, Earth radii: about where the real field stops being the Earth's alone. */
export const OUTER_RADII = 8;
/**
 * Geomagnetic latitudes of the footpoints. On a dipole a line from
 * latitude λ reaches 1/cos²λ Earth radii: these put the arches at about
 * 1.7, 2.4, 3.4, 4.5, 6 and 7.8 radii, then two rings of lines that
 * leave the drawing.
 */
export const FOOT_LATITUDES = [40, 50, 57, 62, 66, 69, 75, 82] as const;
const FOOT_LONGITUDES = 18;
/** Kilometres of the model to metres of the app's world, whose sphere is EARTH_RADIUS_M. */
const TO_WORLD = EARTH_RADIUS_M / SURFACE_KM;
const DEG = Math.PI / 180;

/** The model year for a date: WMM2025 runs 2025.0 - 2030.0 and is not extrapolated. */
export function modelYear(date: Date): { year: number; inRange: boolean } {
  const year = decimalYear(date);
  const clamped = Math.max(WMM_VALID_FROM, Math.min(WMM_VALID_UNTIL, year));
  return { year: clamped, inRange: clamped === year };
}

const BOUNDS = { minRadiusKm: SURFACE_KM, maxRadiusKm: SURFACE_KM * OUTER_RADII };

/** The lines from one ring of footpoints at a geomagnetic latitude. */
export function traceRing(latitude: number, year: number): TracedLine[] {
  return dipoleFootpoints([latitude], FOOT_LONGITUDES, year, SURFACE_KM + 1).map((foot) => traceFieldLine(foot, outwardSign(foot, year), year, BOUNDS));
}

/**
 * Every line of the cage. A ring that leaves the drawing in the north has
 * a twin in the south, which no northern foot reaches: those are traced
 * from the south as well. `pause`, if given, is awaited between rings so
 * that the tracing - a few hundred milliseconds in all - does not hold up
 * a frame.
 */
export async function traceCage(year: number, pause?: () => Promise<void>): Promise<TracedLine[]> {
  const lines: TracedLine[] = [];
  for (const latitude of FOOT_LATITUDES) {
    const ring = traceRing(latitude, year);
    lines.push(...ring);
    await pause?.();
    if (ring.some((line) => line.end === 'outer')) {
      lines.push(...traceRing(-latitude, year).filter((line) => line.end === 'outer'));
      await pause?.();
    }
  }
  return lines;
}

function surfacePoint(latDeg: number, lonDeg: number, out: Float32Array, offset: number): void {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  out[offset] = EARTH_RADIUS_M * Math.cos(lat) * Math.cos(lon);
  out[offset + 1] = EARTH_RADIUS_M * Math.cos(lat) * Math.sin(lon);
  out[offset + 2] = EARTH_RADIUS_M * Math.sin(lat);
}

const place = (lat: number, lon: number): string =>
  `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;

export async function createMagneticFieldLayer(context: LayerContext): Promise<LayerInstance> {
  const { year, inRange } = modelYear(context.now());
  const traced = await traceCage(year, () => new Promise((resolve) => setTimeout(resolve, 0)));
  const segments = traced.reduce((sum, line) => sum + line.strengths.length - 1, 0);
  const positions = new Float32Array(segments * 6);
  const colors = new Float32Array(segments * 6);
  const alphas = new Float32Array(segments * 2);
  let s = 0;
  for (const line of traced) {
    const n = line.strengths.length;
    for (let i = 0; i < n - 1; i++) {
      for (let end = 0; end < 2; end++) {
        const p = i + end;
        const v = s * 2 + end;
        positions[v * 3] = line.points[p * 3] * 1000 * TO_WORLD;
        positions[v * 3 + 1] = line.points[p * 3 + 1] * 1000 * TO_WORLD;
        positions[v * 3 + 2] = line.points[p * 3 + 2] * 1000 * TO_WORLD;
        const t = strengthColor(line.strengths[p], colors, v * 3);
        // Lines that leave the drawing thin out toward where they leave it.
        const fade = line.end === 'outer' ? 1 - (p / (n - 1)) ** 2 : 1;
        alphas[v] = (0.28 + 0.5 * t) * fade;
      }
      s++;
    }
  }
  const lines = new SpaceLines(positions, colors, alphas, context.skyUniforms, {
    name: 'magnetic-field',
    // Under the satellites and their orbits.
    renderOrder: RENDER_ORDER.nearSpace - 0.2,
  });
  context.earthRoot.add(lines.object);

  // The poles: where the field is vertical (dip poles), and where the dipole's axis comes out (geomagnetic poles).
  const poleWorld: THREE.Vector3[] = [];
  let markers: SpaceMarkers;
  let labels: LabelGroup;
  {
    const dipNorth = magneticDipPole('north', year);
    const dipSouth = magneticDipPole('south', year);
    const axis = geomagneticNorthPole(year);
    const poles = [
      { name: 'North magnetic pole', lat: dipNorth.lat, lon: dipNorth.lon, color: [1, 0.85, 0.4] },
      { name: 'South magnetic pole', lat: dipSouth.lat, lon: dipSouth.lon, color: [1, 0.85, 0.4] },
      { name: 'Geomagnetic north pole', lat: axis.lat, lon: axis.lon, color: [0.5, 0.9, 1] },
      { name: 'Geomagnetic south pole', lat: -axis.lat, lon: axis.lon > 0 ? axis.lon - 180 : axis.lon + 180, color: [0.5, 0.9, 1] },
    ];
    const polePositions = new Float32Array(poles.length * 3);
    const poleColors = new Float32Array(poles.length * 3);
    poles.forEach((pole, i) => {
      surfacePoint(pole.lat, pole.lon, polePositions, i * 3);
      poleColors.set(pole.color, i * 3);
      poleWorld.push(new THREE.Vector3(polePositions[i * 3], polePositions[i * 3 + 1], polePositions[i * 3 + 2]));
    });
    markers = new SpaceMarkers(polePositions, poleColors, new Float32Array(poles.length).fill(13), context.skyUniforms, {
      name: 'magnetic-poles',
      shape: 'ring',
      belowHorizon: 1,
    });
    context.earthRoot.add(markers.object);
    labels = context.addLabels({
      // Among the sky's names, ahead of the stars': there are four, and they are what the lines converge on.
      rank: 6.32,
      style: { fontPx: 11, color: '#ffe9b0', offsetYPx: 15 },
      // Points on the ground, thinned with the sky's names: in stereo each sits on its pole.
      frame: 'space',
      labels: poles.map((pole, i) => ({ text: `${pole.name} · ${place(pole.lat, pole.lon)}`, priority: i, position: poleWorld[i] })),
    });
  }
  context.setStatus(
    inRange ? `WMM2025 at ${year.toFixed(1)}` : `WMM2025 at ${year.toFixed(1)}: the model does not cover the shown date`,
    inRange ? 'info' : 'stale'
  );

  return {
    setVisible(visible) {
      lines.object.visible = visible;
      markers.object.visible = visible;
      labels.setVisible(visible);
    },
    dispose() {
      lines.dispose();
      markers.dispose();
      labels.remove();
    },
  };
}
