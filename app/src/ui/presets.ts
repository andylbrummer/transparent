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
    id: 'enhanced-sky',
    label: 'Enhanced sky',
    description:
      'the whole sphere of the sky as an astronomy book prints it: the Milky Way finished for looks, with glowing nebulae, and Hubble’s pictures to zoom into',
    // Not Webb: its patches are too small to find without the rings it draws, and the rings clutter the plates.
    on: ['sky-whole', 'stars', 'milky-way-enhanced', 'survey-hst'],
  },
  {
    id: 'stars-and-dust',
    label: 'Stars and dust',
    description: 'the Galaxy’s starlight with the far-infrared glow of the dust that hides it: the dark lanes light up',
    on: [...SKY_THROUGH, 'stars', 'milky-way', 'map-dust-100um'],
  },
  {
    id: 'through-the-dust',
    label: 'Through the dust',
    description: 'near-infrared light passes the dust: the Galaxy’s bulge and centre, hidden from the eye, in full',
    on: [...SKY_THROUGH, 'stars', 'survey-2mass'],
  },
  {
    id: 'glowing-gas',
    label: 'Glowing gas',
    description: 'hydrogen lit by hot young stars over the starlight: Orion, the Gum Nebula and the star-forming arms',
    on: [...SKY_THROUGH, 'stars', 'milky-way', 'map-h-alpha', 'deep-sky-objects'],
  },
  {
    id: 'high-energy',
    label: 'High-energy sky',
    description: 'gamma rays from the Galaxy’s plane and beyond, with the pulsars and supernova remnants that make them',
    on: [...SKY_THROUGH, 'stars', 'map-gamma-fermi', 'pulsars', 'supernova-remnants'],
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
export function presetVisibility(preset: Pick<LayerPreset, 'on'>, switches: readonly LayerSwitch[]): LayerVisibility {
  const on = new Set(preset.on);
  return Object.fromEntries(switches.map((s) => [s.id, on.has(s.id)]));
}

/** Whether the switches stand exactly as `preset` sets them. */
export function matchesPreset(preset: LayerPreset, visibility: LayerVisibility, switches: readonly LayerSwitch[]): boolean {
  const on = new Set(preset.on);
  return switches.every((s) => visibility[s.id] === on.has(s.id));
}
