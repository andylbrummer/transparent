import type { LayerDefinition } from '../types';
import { rampGradient, type RampStop } from '../weather/ramps';

/** Current speed, m/s: slow water dim, the boundary currents white. Water colours, apart from the wind's. */
export const CURRENT_RAMP: readonly RampStop[] = [
  [0, 0x2f7fb0],
  [0.05, 0x49b6d6],
  [0.12, 0x7fe8d8],
  [0.3, 0xdcfff3],
  [0.6, 0xffffff],
];

/**
 * Degrees of arc a 1 m/s current covers per second on screen. The real
 * figure is 0.000009°: one second of animation is 13 days of drift. The
 * mean ocean moves at centimetres a second - at the wind layer's pace
 * nothing would be seen to move.
 */
export const CURRENT_DEGREES_PER_SECOND_AT_1_MS = 10;

const oceanCurrents: LayerDefinition = {
  id: 'ocean-currents',
  label: 'Ocean currents (mean)',
  section: 'Surface',
  order: 50,
  legend: rampGradient(CURRENT_RAMP),
  caption:
    '0 – 0.6 m/s and faster · the mean surface circulation of Dec 2011 – Sep 2014, from satellites (OSCAR), not today’s currents · 1 s of animation ≈ 13 days of drift · names only where an open source places them',
  credits: [
    {
      what: 'Ocean surface currents (OSCAR third-degree analysis, 5-day composites 2011–2014, averaged)',
      source:
        'Earth & Space Research; Bonjean, F. & Lagerloef, G.S.E. (2002), J. Phys. Oceanogr. 32, 2938–2954; served by NOAA CoastWatch ERDDAP (jplOscar)',
      licence: 'free to use and redistribute',
      url: 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplOscar.html',
    },
    {
      what: 'Positions of the named ocean currents',
      source: 'Wikidata',
      licence: 'CC0',
      url: 'https://www.wikidata.org/',
    },
  ],
  load: async (context) => (await import('./currents')).createOceanCurrentLayer(context),
};

export default oceanCurrents;
