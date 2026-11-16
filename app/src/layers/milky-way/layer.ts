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
 *   dust lanes, stronger colour, the H-alpha glow of the nebulae in red,
 *   and Andromeda and the other bright galaxies Gaia barely records, cut
 *   from the Digitized Sky Survey's colour plates, with the bright nebulae
 *   cut from them starless. Around each the tiles go deeper, to about a
 *   thousand pixels across it, and its name is on the sky (cutouts.json
 *   beside the tiles).
 */

import * as THREE from 'three';
import { raDecToUnit } from '@transparent-earth/core';
import type { LabelGroup } from '../../render/labels';
import type { Credit, LayerContext, LayerDefinition } from '../types';
import { DeepTiles, type DeepTilesFile } from '../sky-survey/coverage';
import { DSS_COLOR_CREDIT, ESA_TILES, type SurveySpec } from '../sky-survey/surveys';
import { H_ALPHA_CREDIT } from '../sky-maps/specs';
import { NEARBY_GALAXIES_CREDIT } from '../deep-sky/specs';

/** The deepest order written for the whole sky, for both finishes: beyond it the source is grain. */
const MILKY_WAY_MAX_ORDER = 2;
/** Cut-out names: ranked just over the stars' names, like the deep-sky showpieces; under the object's core, not on it. */
const CUTOUT_LABEL_RANK = 6.39;
const CUTOUT_LABEL_STYLES = {
  galaxy: { fontPx: 11, color: '#ffe3c8', italic: true, offsetYPx: 14 },
  nebula: { fontPx: 11, color: '#ffc4d4', italic: true, offsetYPx: 14 },
} as const;
type CutoutKind = keyof typeof CUTOUT_LABEL_STYLES;

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
  /** Under the tiles: the galaxies and nebulae drawn deeper than the whole sky, with their names. */
  readonly cutouts?: string;
}

/** What generate_milkyway_enhanced.py writes as cutouts.json. */
interface CutoutsFile extends DeepTilesFile {
  /** Largest first. */
  readonly cutouts: readonly { readonly label: string; readonly kind: CutoutKind; readonly ra: number; readonly dec: number }[];
}

async function loadCutouts(context: LayerContext, file: string): Promise<{ deepTiles: DeepTiles; labels: LabelGroup[] }> {
  const data = await context.fetchJson<CutoutsFile>(context.assetUrl(file));
  const ranked = data.cutouts.map((cutout, priority) => ({ ...cutout, priority }));
  const labels = (Object.keys(CUTOUT_LABEL_STYLES) as CutoutKind[]).map((kind) =>
    context.addLabels({
      rank: CUTOUT_LABEL_RANK,
      style: CUTOUT_LABEL_STYLES[kind],
      frame: 'sky',
      labels: ranked
        .filter((cutout) => cutout.kind === kind)
        .map((cutout) => ({ text: cutout.label, priority: cutout.priority, position: new THREE.Vector3(...raDecToUnit(cutout.ra, cutout.dec)) })),
    }),
  );
  return { deepTiles: DeepTiles.parse(data), labels };
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
      const cutouts = finish.cutouts ? await loadCutouts(context, finish.cutouts) : null;
      const spec: SurveySpec = {
        id: finish.id,
        label: finish.label,
        order: finish.order,
        caption: finish.caption,
        bases: [context.assetUrl(finish.tiles)],
        extension: 'jpg',
        minOrder: 0,
        maxOrder: cutouts ? cutouts.deepTiles.maxOrder : MILKY_WAY_MAX_ORDER,
        frame: 'equatorial',
        // The tiles are black wherever there is no Milky Way: all of their light is added.
        floor: 0,
        gain: finish.gain,
        credits: finish.credits,
      };
      const survey = (await import('../sky-survey/survey')).createSurveyLayer(context, spec, cutouts?.deepTiles ?? null);
      if (!cutouts) return survey;
      return {
        ...survey,
        setVisible(visible) {
          survey.setVisible(visible);
          for (const labels of cutouts.labels) labels.setVisible(visible);
        },
        dispose() {
          survey.dispose();
          for (const labels of cutouts.labels) labels.remove();
        },
      };
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
    caption:
      'the Milky Way as an astronomy book prints it: dust lanes cut deeper, colours raised, glowing hydrogen in red, Andromeda, the bright galaxies and the nebulae from photographic plates, named, sharp to their spiral arms and filaments when zoomed in',
    tiles: 'sky/milkyway-enhanced',
    cutouts: 'sky/milkyway-enhanced/cutouts.json',
    gain: MILKY_WAY_ENHANCED_GAIN,
    credits: [DEEP_STAR_MAPS_CREDIT, H_ALPHA_CREDIT, DSS_COLOR_CREDIT, ESA_TILES, NEARBY_GALAXIES_CREDIT],
  }),
];

export default finishes;
