import type { Credit, LayerDefinition } from '../types';
import { rampGradient } from '../weather/ramps';
import {
  BODY_BASE_KM,
  BODY_COLORS,
  BODY_THRESHOLD_PERCENT,
  BODY_TOP_KM,
  DVS_RAMP,
  TOMOGRAPHY_BODIES_ID,
  TOMOGRAPHY_SHELLS,
  signedPercent,
  tomographyId,
} from './shells';

const CREDITS: readonly Credit[] = [
  {
    what: 'Seismic tomography: shear-velocity anomaly of the mantle (model SEMUCB-WM1)',
    source:
      'French, S.W. & Romanowicz, B.A. (2014), Geophys. J. Int. 199, 1303, doi:10.1093/gji/ggu334; spherical-harmonic expansion to degree 31 as distributed with hc (Becker, O’Neill & Steinberger)',
    licence: 'published model, cited; the expansion ships with hc (GPL-2.0)',
    url: 'https://github.com/geodynamics/hc',
  },
  {
    what: 'Coastlines projected onto the depth slices',
    source: 'Natural Earth',
    licence: 'public domain',
    url: 'https://www.naturalearthdata.com/',
  },
];

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** The lower mantle's slow provinces as solids: the same model, contoured in three dimensions. */
const bodies: LayerDefinition = {
  id: TOMOGRAPHY_BODIES_ID,
  label: 'Deep mantle in 3-D: slow provinces (LLSVPs)',
  section: 'Inside the Earth',
  order: 59,
  legend: `linear-gradient(to right, ${hex(BODY_COLORS.top)}, ${hex(BODY_COLORS.base)})`,
  caption:
    `where shear waves run ${signedPercent(-BODY_THRESHOLD_PERCENT)} or more slow, ` +
    `from ${BODY_TOP_KM.toLocaleString('en-US')} km (light, cut off there) down to the core at ${BODY_BASE_KM.toLocaleString('en-US')} km (dark) · ` +
    'the two great slow provinces standing on the core under Africa and the Pacific, and the columns rising off them · ' +
    `a line every 250 km of depth · dimmed where seen through the core · ` +
    'a contour of a smoothed model (SEMUCB-WM1), not a body with edges: another threshold draws another shape',
  credits: CREDITS.slice(0, 1),
  load: async (context) => (await import('./bodies')).createTomographyBodiesLayer(context),
};

/** One switch per depth slice, one at a time: each is a fullscreen pass. */
const slices: readonly LayerDefinition[] = TOMOGRAPHY_SHELLS.map((shell, index) => ({
  id: tomographyId(shell.depthKm),
  label: `Mantle at ${shell.depthKm.toLocaleString('en-US')} km (tomography)`,
  section: 'Inside the Earth',
  order: 60 + index,
  exclusiveGroup: 'tomography',
  legend: rampGradient(DVS_RAMP),
  caption:
    `shear-wave speed: slow ${signedPercent(-shell.rangePercent)} … fast ${signedPercent(shell.rangePercent)} · ` +
    `${shell.look} · a model (SEMUCB-WM1), smoothed to ~650 km · coastlines projected down for bearings`,
  credits: CREDITS,
  load: async (context) => (await import('./tomography')).createTomographyLayer(context, shell),
}));

const tomography: readonly LayerDefinition[] = [bodies, ...slices];

export default tomography;
