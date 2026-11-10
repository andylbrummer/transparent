import type { Credit, LayerDefinition } from '../types';
import { rampGradient } from '../weather/ramps';
import { DVS_RAMP, TOMOGRAPHY_SHELLS, signedPercent, tomographyId } from './shells';

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

/** One switch per depth slice, one at a time: each is a fullscreen pass. */
const tomography: readonly LayerDefinition[] = TOMOGRAPHY_SHELLS.map((shell, index) => ({
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

export default tomography;
