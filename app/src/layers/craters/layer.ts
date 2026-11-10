import type { LayerDefinition } from '../types';

/** The craters' own colour: a lime no boundary, fault or depth uses. */
export const CRATER_COLOR = 0xc9f25a;
/** Structures at least this wide get a ring at their true size on the ground, km. */
export const TRUE_RING_MIN_KM = 10;

const craters: LayerDefinition = {
  id: 'impact-craters',
  label: 'Impact craters',
  section: 'Surface',
  order: 62,
  legend: `#${CRATER_COLOR.toString(16)}`,
  caption: `◯ the 187 proven impact structures of 100 m and more, with diameter and age · those over ${TRUE_RING_MIN_KM} km are ringed at their true size`,
  credits: [
    {
      what: 'Impact structures: positions, diameters and recommended ages',
      source:
        'Schmieder, M. & Kring, D.A. (2020), Earth’s Impact Events Through Geologic Time, Astrobiology 20(1), 91–141, doi:10.1089/ast.2019.2085, Table 1',
      licence: 'CC BY 4.0',
      url: 'https://doi.org/10.1089/ast.2019.2085',
    },
  ],
  load: async (context) => (await import('./craters')).createCraterLayer(context),
};

export default craters;
