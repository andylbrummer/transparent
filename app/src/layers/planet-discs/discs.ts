/**
 * The planets close up: each drawn as the disc a telescope shows, at its
 * true place but MAGNIFICATION times life size, because the largest of
 * them is 1/30 of the Moon's width: at life size Jupiter is 50 pixels at
 * the narrowest zoom and nothing at all in a headset, which cannot zoom.
 *
 * Size, flattening, the pole's tilt, the face turned to the Earth and the
 * phase are computed (packages/core planet-discs, held to JPL Horizons);
 * Saturn's rings are in its equator with their real edges; the big moons
 * of Jupiter, Saturn and Neptune stand at their computed places, at the
 * same magnification, and go out when the planet hides or shadows them.
 *
 * Maps: app/public/sky/planets/ (tools/pipeline/generate_planet_maps.py).
 */

import * as THREE from 'three';
import {
  AU_KM,
  PLANET_MOON_NAMES,
  PLANET_NAMES,
  SATURN_RINGS,
  moonPlanet,
  moonRadiusKm,
  planetDisc,
  planetMoons,
  planetShape,
  type MoonSituation,
  type PlanetMoonName,
  type PlanetName,
  type Vec3Tuple,
} from '@transparent-earth/core';
import { RENDER_ORDER } from '../../render/order';
import { SkyPoints } from '../../render/sky-points';
import { MovingLabel } from '../sun/moving-label';
import { PLANET_COLORS } from '../planets/planets';
import { planetDiscState } from '../planets/disc-state';
import type { LayerContext, LayerInstance } from '../types';
import { DISC_FRAGMENT_SHADER, DISC_VERTEX_SHADER } from './shader';

/** How many times life size the discs and the moons' spacing are drawn. */
export const MAGNIFICATION = 40;

/** Planets with a baked map; the rest are one flat tone (PLANET_COLORS). */
export const MAPPED_PLANETS: readonly PlanetName[] = ['mars', 'jupiter', 'saturn', 'neptune'];
/** Bare rock, bright to the limb; the others are cloud decks that darken toward it. */
const ROCKY: readonly PlanetName[] = ['mercury', 'mars'];

/** After the Sun and its corona (sky + 0.01 … 0.04), before the Moon (0.06): a planet crosses the Sun and goes behind the Moon. */
const DISC_RENDER_ORDER = RENDER_ORDER.sky + 0.05;
const MOON_RENDER_ORDER = RENDER_ORDER.sky + 0.052;
/** Jupiter turns 0.01° a second and Io moves 0.002° of its orbit: once a second is plenty. */
const EPHEMERIS_INTERVAL_MS = 1000;
/** A moon is never drawn smaller than this, CSS px. */
const MOON_MIN_PX = 3;
/** Moons are named once their planet's family is spread at least this wide on the screen, CSS px. */
const MOON_LABEL_SPREAD_PX = 200;

/**
 * The rings' tint and how bright their scattered light is drawn against
 * the planet - drawing choices, set so the B ring is about as bright as
 * Saturn's disc, which it is.
 */
const RING_COLOR: Vec3Tuple = [0.95, 0.9, 0.8];
const RING_GAIN = 3;

/** How each moon's light looks - a drawing choice, as for the planets' points. */
export const MOON_COLORS: Readonly<Record<PlanetMoonName, Vec3Tuple>> = {
  io: [1.0, 0.92, 0.6],
  europa: [0.96, 0.95, 0.92],
  ganymede: [0.82, 0.78, 0.72],
  callisto: [0.62, 0.58, 0.54],
  tethys: [0.95, 0.95, 0.95],
  dione: [0.92, 0.92, 0.92],
  rhea: [0.9, 0.9, 0.9],
  titan: [0.95, 0.72, 0.4],
  iapetus: [0.8, 0.76, 0.7],
  triton: [0.92, 0.86, 0.84],
};

const capital = (name: string): string => name[0].toUpperCase() + name.slice(1);

/** Half-width of a planet's panel in equatorial radii: the disc, or Saturn's rings, with a margin for the soft edge. */
export function panelExtent(planet: PlanetName): number {
  if (planet !== 'saturn') return 1.06;
  const outer = Math.max(...SATURN_RINGS.map((band) => band.outerKm));
  return (outer / planetShape('saturn').equatorialRadiusKm) * 1.03;
}

/** Unit vectors toward celestial east and north at `direction` on the sky. */
export function skyAxes(direction: Vec3Tuple): { east: Vec3Tuple; north: Vec3Tuple } {
  const [x, y, z] = direction;
  const h = Math.hypot(x, y);
  const east: Vec3Tuple = [-y / h, x / h, 0];
  return { east, north: [-z * east[1], z * east[0], x * east[1] - y * east[0]] };
}

/** Where a moon is drawn: its offset from the planet stretched `magnification` times. */
export function magnifiedDirection(planet: Vec3Tuple, moon: Vec3Tuple, magnification: number): Vec3Tuple {
  const v: [number, number, number] = [
    planet[0] + (moon[0] - planet[0]) * magnification,
    planet[1] + (moon[1] - planet[1]) * magnification,
    planet[2] + (moon[2] - planet[2]) * magnification,
  ];
  const k = 1 / Math.hypot(v[0], v[1], v[2]);
  return [v[0] * k, v[1] * k, v[2] * k];
}

/**
 * "Io", "Io · in Jupiter’s shadow", "Io · crossing Jupiter"; nothing for a
 * moon behind its planet, whose name would sit on the disc that hides it.
 */
export function moonLabelText(moon: PlanetMoonName, situation: MoonSituation): string {
  const planet = capital(moonPlanet(moon));
  const name = capital(moon);
  if (situation === 'occulted') return '';
  if (situation === 'eclipsed') return `${name} · in ${planet}’s shadow`;
  if (situation === 'transit') return `${name} · crossing ${planet}`;
  return name;
}

/** A moon the planet hides or shadows gives no light. */
export function moonShines(situation: MoonSituation): boolean {
  return situation === 'clear' || situation === 'transit';
}

interface PlanetPanel {
  readonly planet: PlanetName;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly direction: THREE.Vector3;
}

async function loadMap(context: LayerContext, planet: PlanetName): Promise<THREE.Texture | null> {
  try {
    const texture = await new THREE.TextureLoader().loadAsync(context.assetUrl(`sky/planets/${planet}.jpg`));
    texture.colorSpace = THREE.NoColorSpace;
    // No mipmaps: the atan seam at longitude 180 would pick the coarsest level along a line.
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    return texture;
  } catch {
    // The disc is still right in size, tilt and phase without its map: one flat tone.
    return null;
  }
}

export async function createPlanetDiscsLayer(context: LayerContext): Promise<LayerInstance> {
  const maps = await Promise.all(PLANET_NAMES.map((planet) => (MAPPED_PLANETS.includes(planet) ? loadMap(context, planet) : null)));
  const missing = MAPPED_PLANETS.filter((planet) => maps[PLANET_NAMES.indexOf(planet)] === null);
  if (missing.length > 0) context.setStatus('maps missing', 'error');
  const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  blank.needsUpdate = true;
  const geometry = new THREE.PlaneGeometry(2, 2);

  const panels: PlanetPanel[] = PLANET_NAMES.map((planet, i) => {
    const material = new THREE.ShaderMaterial({
      vertexShader: DISC_VERTEX_SHADER,
      fragmentShader: DISC_FRAGMENT_SHADER,
      uniforms: {
        uMap: { value: maps[i] ?? blank },
        uHasMap: { value: maps[i] ? 1 : 0 },
        uColor: { value: new THREE.Vector3(...PLANET_COLORS[planet]) },
        uRight: { value: new THREE.Vector3(1, 0, 0) },
        uUp: { value: new THREE.Vector3(0, 0, 1) },
        uView: { value: new THREE.Vector3(0, -1, 0) },
        uSun: { value: new THREE.Vector3(0, -1, 0) },
        uAxisRatio: { value: planetShape(planet).axisRatio },
        uExtent: { value: panelExtent(planet) },
        uRings: { value: planet === 'saturn' ? 1 : 0 },
        uScatter: { value: ROCKY.includes(planet) ? 1 : 0 },
        uRingColor: { value: new THREE.Vector3(...RING_COLOR) },
        uRingGain: { value: RING_GAIN },
        uObserverUp: context.skyUniforms.uObserverUp,
        uBelowHorizon: context.skyUniforms.uBelowHorizon,
      },
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
      // The panel faces outward; it is seen from inside the sphere.
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `planet-disc-${planet}`;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = DISC_RENDER_ORDER;
    context.skyRoot.add(mesh);
    return { planet, mesh, material, direction: new THREE.Vector3() };
  });

  const moonCount = PLANET_MOON_NAMES.length;
  const moonColors = new Float32Array(moonCount * 3);
  PLANET_MOON_NAMES.forEach((moon, i) => moonColors.set(MOON_COLORS[moon], i * 3));
  const moonAlphas = new Float32Array(moonCount).fill(1);
  const moonPoints = new SkyPoints(
    new Float32Array(moonCount * 3),
    new Float32Array(moonCount).fill(MOON_MIN_PX),
    moonColors,
    context.skyUniforms,
    { name: 'planet-moons', shape: 'disc', additive: false, renderOrder: MOON_RENDER_ORDER },
    moonAlphas
  );
  context.skyRoot.add(moonPoints.object);
  const moonSize = moonPoints.object.geometry.getAttribute('aSize') as THREE.BufferAttribute;
  const moonAlpha = moonPoints.object.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
  // Under the planets' names (6.35): a moon's name gives way to its planet's.
  const moonLabels = PLANET_MOON_NAMES.map(() => new MovingLabel(context, 6.36, { fontPx: 10, color: '#d8d2c4' }, 2));
  /** Per moon: its drawn diameter and its family's spread, both in radians on the screen's scale, and its label. */
  const moonDiameterRad = new Float64Array(moonCount);
  const moonSpreadRad = new Float64Array(moonCount);
  const moonText: string[] = PLANET_MOON_NAMES.map(() => '');

  const basis = new THREE.Matrix4();
  const toBody = new THREE.Matrix3();
  let heightCss = window.innerHeight;
  let lastMs = NaN;

  const place = (date: Date): void => {
    for (const panel of panels) {
      const disc = planetDisc(panel.planet, date);
      const p = disc.ephemeris.positionAu;
      const direction: Vec3Tuple = [p[0] / disc.ephemeris.distanceAu, p[1] / disc.ephemeris.distanceAu, p[2] / disc.ephemeris.distanceAu];
      const { east, north } = skyAxes(direction);
      const half =
        (panelExtent(panel.planet) * planetShape(panel.planet).equatorialRadiusKm * MAGNIFICATION) / (disc.ephemeris.distanceAu * AU_KM);
      panel.direction.set(direction[0], direction[1], direction[2]);
      basis.set(
        east[0] * half, north[0] * half, direction[0], direction[0],
        east[1] * half, north[1] * half, direction[1], direction[1],
        east[2] * half, north[2] * half, direction[2], direction[2],
        0, 0, 0, 1
      );
      panel.mesh.matrix.copy(basis);
      panel.mesh.matrixWorldNeedsUpdate = true;
      const m = disc.bodyToIcrs;
      // ICRS → the planet's own axes: the transpose of body → ICRS.
      toBody.set(m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]);
      const uniforms = panel.material.uniforms;
      (uniforms.uRight.value as THREE.Vector3).set(east[0], east[1], east[2]).applyMatrix3(toBody);
      (uniforms.uUp.value as THREE.Vector3).set(north[0], north[1], north[2]).applyMatrix3(toBody);
      (uniforms.uView.value as THREE.Vector3).set(disc.toEarthBody[0], disc.toEarthBody[1], disc.toEarthBody[2]);
      (uniforms.uSun.value as THREE.Vector3).set(disc.toSunBody[0], disc.toSunBody[1], disc.toSunBody[2]);

      const views = planetMoons(panel.planet, disc, date);
      const spreadKm = Math.max(0, ...views.map((view) => Math.hypot(view.offsetKm[0], view.offsetKm[1], view.offsetKm[2])));
      for (const view of views) {
        const i = PLANET_MOON_NAMES.indexOf(view.moon);
        const at = magnifiedDirection(direction, view.direction, MAGNIFICATION);
        moonPoints.positions.setXYZ(i, at[0], at[1], at[2]);
        moonAlpha.setX(i, moonShines(view.situation) ? 1 : 0);
        moonDiameterRad[i] = (2 * moonRadiusKm(view.moon) * MAGNIFICATION) / (disc.ephemeris.distanceAu * AU_KM);
        moonSpreadRad[i] = (2 * spreadKm * MAGNIFICATION) / (disc.ephemeris.distanceAu * AU_KM);
        moonText[i] = moonLabelText(view.moon, view.situation);
        // A hidden moon's name stays where the moon would be: that is where it will come out.
        moonLabels[i].position.set(at[0], at[1], at[2]);
      }
    }
    moonPoints.positions.needsUpdate = true;
    moonAlpha.needsUpdate = true;
  };

  return {
    setVisible(next) {
      for (const panel of panels) panel.mesh.visible = next;
      moonPoints.object.visible = next;
      for (const label of moonLabels) label.setVisible(next);
      planetDiscState.magnification = next ? MAGNIFICATION : 0;
    },
    setResolution(_widthCss, height) {
      heightCss = height;
    },
    update(frame) {
      const ms = frame.date.getTime();
      if (!(Math.abs(ms - lastMs) < EPHEMERIS_INTERVAL_MS)) {
        lastMs = ms;
        place(frame.date);
      }
      const pxPerRad = heightCss / ((frame.camera.fov * Math.PI) / 180);
      for (let i = 0; i < moonCount; i++) {
        const sizePx = Math.max(MOON_MIN_PX, moonDiameterRad[i] * pxPerRad);
        moonSize.setX(i, sizePx);
        const named = moonSpreadRad[i] * pxPerRad >= MOON_LABEL_SPREAD_PX;
        moonLabels[i].set(named ? moonText[i] : '', Math.max(10, Math.ceil((sizePx / 2 + 8) / 4) * 4));
      }
      moonSize.needsUpdate = true;
    },
    dispose() {
      planetDiscState.magnification = 0;
      for (const panel of panels) {
        panel.mesh.removeFromParent();
        panel.material.dispose();
      }
      geometry.dispose();
      blank.dispose();
      for (const map of maps) map?.dispose();
      moonPoints.dispose();
      for (const label of moonLabels) label.dispose();
    },
  };
}
