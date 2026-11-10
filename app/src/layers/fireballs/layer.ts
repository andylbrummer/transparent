import type { LayerDefinition } from '../types';

/** The fireballs' own colour: the blue-white of a meteor's flash, which nothing else on the map uses. */
export const FIREBALL_COLOR = 0x9fe8ff;

const fireballs: LayerDefinition = {
  id: 'fireballs',
  label: 'Fireballs (bolides) since 1988',
  section: 'Surface',
  order: 74,
  legend: `#${FIREBALL_COLOR.toString(16)}`,
  caption:
    '✦ 888 fireballs reported by U.S. Government sensors since 1988 · size by impact energy (0.05 – 440 kt TNT) · each at the height of its brightest flash (14 – 91 km up); fainter and on the ground where no height was reported',
  credits: [
    {
      what: 'Fireballs: time, position, altitude, velocity and energy',
      source: 'NASA/JPL Center for Near Earth Object Studies (CNEOS), Fireball and Bolide Data (U.S. Government sensors)',
      licence: 'NASA/JPL data, free use with credit (Courtesy NASA/JPL-Caltech)',
      url: 'https://cneos.jpl.nasa.gov/fireballs/',
    },
  ],
  load: async (context) => (await import('./fireballs')).createFireballLayer(context),
};

export default fireballs;
