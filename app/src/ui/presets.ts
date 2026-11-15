/**
 * Layer presets: named views of the app, one tap each in the layers panel.
 *
 * A preset is the whole set of switches it turns on; every other switch
 * goes off, so a preset gives the same view whatever was on before. The
 * Earth's own surface and shells are switches like the rest, so the sky
 * presets can take the planet out of the way and the interior one can
 * leave only what is inside.
 */

import type { LayerSwitch, LayerVisibility } from './layers-panel';

export interface LayerPreset {
  readonly id: string;
  readonly label: string;
  /** One line under the presets, for whoever hovers or focuses one. */
  readonly description: string;
  /** Switch ids turned on; every other switch is off. */
  readonly on: readonly string[];
}

const SHELLS = ['shell-moho', 'shell-670', 'shell-core', 'shell-inner-core'];
/** The sky seen through the planet: without it the sky presets show only the half above the horizon. */
const SKY_THROUGH = ['sky-below-horizon'];

export const LAYER_PRESETS: readonly LayerPreset[] = [
  {
    id: 'inside',
    label: 'Inside the Earth',
    description: 'the planet’s interior alone: shells, slabs, plumes, earthquakes and the deep mantle, no surface or sky',
    on: [
      ...SHELLS,
      'quakes',
      'slabs',
      'plumes',
      'tomography-slow-bodies',
      'ulvz',
      'depth-ladder',
      'deep-labels',
      'subduction-labels',
      'hotspot-labels',
    ],
  },
  {
    id: 'surface',
    label: 'Surface',
    description: 'the far side’s land and sea floor: coasts, rivers, volcanoes, craters, ice and the places named',
    on: [
      'globe-surface',
      'political',
      'rivers-lakes',
      'volcanoes',
      'impact-craters',
      'undersea-features',
      'glaciers',
      'high-mountains',
      'place-labels',
      'volcano-labels',
    ],
  },
  {
    id: 'tectonics',
    label: 'Tectonics',
    description: 'plates and what drives them: boundaries, spreading, motion, slabs, plumes and earthquakes',
    on: [
      'globe-surface',
      'political',
      'boundaries',
      'spreading',
      'plate-motion',
      'quakes',
      'slabs',
      'plumes',
      'volcanoes',
      'shell-core',
      'plate-labels',
      'subduction-labels',
      'hotspot-labels',
      'quake-labels',
    ],
  },
  {
    id: 'weather',
    label: 'Weather now',
    description: 'the atmosphere today: clouds, rain, surface wind, storms and day and night',
    on: ['globe-surface', 'political', 'clouds', 'precipitation', 'wind-10m', 'cyclones-live', 'hazards-live', 'day-night', 'place-labels'],
  },
  {
    id: 'near-space',
    label: 'Near space',
    description: 'around the Earth: satellites, the magnetic field, the aurora and the Moon’s orbit',
    on: [
      'globe-surface',
      'political',
      'sat-stations',
      'sat-gnss',
      'sat-geo',
      'magnetic-field',
      'magnetopause',
      'aurora',
      'moon-orbit',
      'moon',
      'stars',
      ...SKY_THROUGH,
    ],
  },
  {
    id: 'solar-system',
    label: 'Solar system',
    description: 'the Sun, Moon, planets, small bodies and probes, all around the sky with the Earth out of the way',
    on: [
      ...SKY_THROUGH,
      'stars',
      'sun',
      'moon',
      'planets',
      'planet-discs',
      'dwarf-planets-asteroids',
      'comets',
      'asteroid-belt-cloud',
      'neo-approaches',
      'spacecraft-deep',
      'spacecraft-lagrange',
    ],
  },
  {
    id: 'deep-space',
    label: 'Deep space',
    description: 'the galaxy and its neighbours: the Milky Way, clusters, nebulae, nearby stars and galaxies',
    on: [
      ...SKY_THROUGH,
      'stars',
      'milky-way',
      'constellations',
      'deep-sky-objects',
      'globular-clusters',
      'supernova-remnants',
      'nearby-stars',
      'exoplanet-hosts',
      'pulsars',
      'nearby-galaxies',
      'sky-landmarks',
    ],
  },
  {
    id: 'cosmology',
    label: 'Cosmology',
    description: 'the universe at large: the microwave background, the galaxy web, quasars and the most distant bursts',
    on: [
      ...SKY_THROUGH,
      'map-cmb-planck',
      'galaxy-survey',
      'galaxy-clusters',
      'quasars',
      'gamma-ray-bursts',
      'fast-radio-bursts',
      'gw-events',
      'sky-landmarks',
    ],
  },
  {
    id: 'nothing',
    label: 'Clear all',
    description: 'every layer off, the Earth included: a blank view to build from',
    on: [],
  },
];

/** The view the app opens with: each switch at its own default. */
export function defaultPreset(switches: readonly LayerSwitch[]): LayerPreset {
  return {
    id: 'default',
    label: 'Default',
    description: 'the view the app opens with',
    on: switches.filter((s) => !s.defaultOff).map((s) => s.id),
  };
}

/** Every switch on or off as `preset` has it. */
export function presetVisibility(preset: LayerPreset, switches: readonly LayerSwitch[]): LayerVisibility {
  const on = new Set(preset.on);
  return Object.fromEntries(switches.map((s) => [s.id, on.has(s.id)]));
}

/** Whether the switches stand exactly as `preset` sets them. */
export function matchesPreset(preset: LayerPreset, visibility: LayerVisibility, switches: readonly LayerSwitch[]): boolean {
  const on = new Set(preset.on);
  return switches.every((s) => visibility[s.id] === on.has(s.id));
}
