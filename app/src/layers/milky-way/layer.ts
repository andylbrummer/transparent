/**
 * The Milky Way behind the stars: NASA SVS Deep Star Maps 2020, cut into
 * HiPS tiles in app/public/sky/milkyway (tools/pipeline/
 * generate_milkyway.py) and drawn like a sky survey, so zooming in
 * sharpens it to 1.7 arc minutes a pixel. It is not one of the
 * one-at-a-time sky maps: dust, gas or X-rays can be laid over its
 * starlight.
 */

import type { LayerDefinition } from '../types';
import type { SurveySpec } from '../sky-survey/surveys';

/** Where generate_milkyway.py writes the tiles, under the site's base. */
const MILKY_WAY_TILES = 'sky/milkyway';
/** The deepest order written: beyond it the source is grain. */
const MILKY_WAY_MAX_ORDER = 2;

/**
 * How much of the map's light is added to the view. The tiles are baked
 * so the bulge nears white; at this gain the band reads clearly against
 * the stars while the globe, seen through it below the horizon, keeps its
 * colours (there the shared below-horizon dimming applies on top).
 */
export const MILKY_WAY_GAIN = 0.7;

const milkyWay: LayerDefinition = {
  id: 'milky-way',
  label: 'Milky Way',
  section: 'Sky',
  order: 30,
  caption: 'the summed light of 1.7 billion Gaia stars too faint to draw one by one · zoom in for the dust lanes',
  credits: [
    {
      what: 'Milky Way panorama (Deep Star Maps 2020)',
      source: 'NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC',
      licence: 'public domain, credit requested',
      url: 'https://svs.gsfc.nasa.gov/4851',
    },
  ],
  load: async (context) => {
    const spec: SurveySpec = {
      id: milkyWay.id,
      label: milkyWay.label,
      order: milkyWay.order ?? 0,
      caption: milkyWay.caption ?? '',
      bases: [context.assetUrl(MILKY_WAY_TILES)],
      extension: 'jpg',
      minOrder: 0,
      maxOrder: MILKY_WAY_MAX_ORDER,
      frame: 'equatorial',
      // The tiles are black wherever there is no Milky Way: all of their light is added.
      floor: 0,
      gain: MILKY_WAY_GAIN,
      credits: milkyWay.credits,
    };
    return (await import('../sky-survey/survey')).createSurveyLayer(context, spec);
  },
};

export default milkyWay;
