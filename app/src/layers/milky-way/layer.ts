/**
 * The Milky Way behind the stars: NASA SVS Deep Star Maps 2020, cut into
 * HiPS tiles and drawn like a sky survey, so zooming in sharpens it to 1.7
 * arc minutes a pixel. It is not one of the one-at-a-time sky maps: dust,
 * gas or X-rays can be laid over its starlight.
 *
 * Two finishes of the same tiles, one at a time:
 * - plain, app/public/sky/milkyway (tools/pipeline/generate_milkyway.py):
 *   the starlight as Gaia measured it, toned for the eye;
 * - enhanced, app/public/sky/milkyway-enhanced (generate_milkyway_enhanced.py):
 *   finished as an astronomy book prints it - local contrast cutting the
 *   dust lanes, stronger colour, and the H-alpha glow of the nebulae in red.
 */

import type { Credit, LayerDefinition } from '../types';
import type { SurveySpec } from '../sky-survey/surveys';
import { H_ALPHA_CREDIT } from '../sky-maps/specs';

/** The deepest order written, for both finishes: beyond it the source is grain. */
const MILKY_WAY_MAX_ORDER = 2;

/**
 * How much of the plain map's light is added to the view. The tiles are
 * baked so the bulge nears white; at this gain the band reads clearly
 * against the stars while the globe, seen through it below the horizon,
 * keeps its colours (there the shared below-horizon dimming applies on top).
 */
export const MILKY_WAY_GAIN = 0.7;
/** The enhanced finish is meant to be looked at, not through: nearly all of its light. */
export const MILKY_WAY_ENHANCED_GAIN = 0.9;

const DEEP_STAR_MAPS_CREDIT: Credit = {
  what: 'Milky Way panorama (Deep Star Maps 2020)',
  source: 'NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC',
  licence: 'public domain, credit requested',
  url: 'https://svs.gsfc.nasa.gov/4851',
};

interface MilkyWayFinish {
  readonly id: string;
  readonly label: string;
  readonly order: number;
  readonly caption: string;
  /** Where the generator writes the tiles, under the site's base. */
  readonly tiles: string;
  readonly gain: number;
  readonly credits: readonly Credit[];
}

function milkyWayLayer(finish: MilkyWayFinish): LayerDefinition {
  return {
    id: finish.id,
    label: finish.label,
    section: 'Sky',
    order: finish.order,
    exclusiveGroup: 'milky-way',
    caption: finish.caption,
    credits: finish.credits,
    load: async (context) => {
      const spec: SurveySpec = {
        id: finish.id,
        label: finish.label,
        order: finish.order,
        caption: finish.caption,
        bases: [context.assetUrl(finish.tiles)],
        extension: 'jpg',
        minOrder: 0,
        maxOrder: MILKY_WAY_MAX_ORDER,
        frame: 'equatorial',
        // The tiles are black wherever there is no Milky Way: all of their light is added.
        floor: 0,
        gain: finish.gain,
        credits: finish.credits,
      };
      return (await import('../sky-survey/survey')).createSurveyLayer(context, spec);
    },
  };
}

const finishes: LayerDefinition[] = [
  milkyWayLayer({
    id: 'milky-way',
    label: 'Milky Way',
    order: 30,
    caption: 'the summed light of 1.7 billion Gaia stars too faint to draw one by one · zoom in for the dust lanes',
    tiles: 'sky/milkyway',
    gain: MILKY_WAY_GAIN,
    credits: [DEEP_STAR_MAPS_CREDIT],
  }),
  milkyWayLayer({
    id: 'milky-way-enhanced',
    label: 'Milky Way, enhanced',
    order: 31,
    caption: 'the Milky Way as an astronomy book prints it: dust lanes cut deeper, colours raised, glowing hydrogen in red',
    tiles: 'sky/milkyway-enhanced',
    gain: MILKY_WAY_ENHANCED_GAIN,
    credits: [DEEP_STAR_MAPS_CREDIT, H_ALPHA_CREDIT],
  }),
];

export default finishes;
