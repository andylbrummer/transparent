import type { LayerDefinition } from '../types';

/** Falls: a pink no rock, plate or depth uses. */
export const FALL_COLOR = 0xff9bd2;
/** The great finds are iron: steel blue-grey. */
export const FIND_COLOR = 0xb9c7dc;

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

const meteorites: LayerDefinition = {
  id: 'meteorite-falls',
  label: 'Meteorites: falls and great masses',
  section: 'Surface',
  order: 75,
  legend: `linear-gradient(to right, ${hex(FALL_COLOR)} 0% 70%, ${hex(FIND_COLOR)} 70% 100%)`,
  caption:
    '◆ 1,096 meteorites seen to fall and then picked up, 860 – 2013 · ■ the 48 largest ever found, 1 – 60 t · size by mass · catalogue as of 2013',
  credits: [
    {
      what: 'Meteorite falls and finds: name, year, mass, class, place',
      source:
        'Meteorite Landings, NASA Open Data Portal; from the Meteoritical Bulletin Database of The Meteoritical Society',
      licence: 'no licence stated by the portal (U.S. Government open data listing)',
      url: 'https://data.nasa.gov/dataset/meteorite-landings',
    },
  ],
  load: async (context) => (await import('./meteorites')).createMeteoriteLayer(context),
};

export default meteorites;
