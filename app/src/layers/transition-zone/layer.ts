import type { Credit, LayerDefinition } from '../types';
import { transitionZoneId } from './boundaries';
import { TRANSITION_ZONE_LEGEND } from './shade';

const CREDITS: readonly Credit[] = [
  {
    what: 'Depth of the 410 and 660 km discontinuities from SS precursors, corrected for 3-D structure',
    source:
      'Waszek, L., Tauzin, B., Schmerr, N.C., Ballmer, M.D. & Afonso, J.C. (2021), A poorly mixed mantle transition zone and its thermal state inferred from seismic waves, Nature Geoscience 14, 949–955, doi:10.1038/s41561-021-00850-w; data in the ISC Seismological Dataset Repository, doi:10.31905/7M3LMG8X',
    licence: 'no stated licence: the readme asks only that Waszek et al. (2021) be cited, as it is here',
    url: 'https://doi.org/10.31905/7M3LMG8X',
  },
  {
    what: 'Coastlines projected onto the boundaries',
    source: 'Natural Earth',
    licence: 'public domain',
    url: 'https://www.naturalearthdata.com/',
  },
];

const COMMON =
  'green where it is raised, violet where it is pushed down, clear within 2 km of its average · ' +
  'from waves that bounced off its underside, smoothed to thousands of km · coastlines projected down for bearings';

const upper: LayerDefinition = {
  id: transitionZoneId('410'),
  label: 'Top of the transition zone (the 410)',
  section: 'Inside the Earth',
  order: 55,
  legend: TRANSITION_ZONE_LEGEND,
  caption:
    'where olivine turns to a denser form, about 410 km down: cold lifts it, heat lowers it · ' +
    'shown against its own average, ±20 km at the ends of the colours · ' +
    COMMON,
  credits: CREDITS,
  load: async (context) => (await import('./transition-zone')).createTransitionZoneLayer(context, '410'),
};

const lower: LayerDefinition = {
  id: transitionZoneId('660'),
  label: 'Base of the transition zone (the 660)',
  section: 'Inside the Earth',
  order: 56,
  legend: TRANSITION_ZONE_LEGEND,
  caption:
    'where the upper mantle ends, 654 km down on average here: cold pushes it down, heat raises it · ' +
    'deepest where slabs pile up on it, off Peru and under the Izu-Bonin and Tonga trenches · ' +
    COMMON,
  credits: CREDITS,
  load: async (context) => (await import('./transition-zone')).createTransitionZoneLayer(context, '660'),
};

const transitionZone: readonly LayerDefinition[] = [upper, lower];

export default transitionZone;
