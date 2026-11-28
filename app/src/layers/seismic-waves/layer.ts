import { PLAYBACK_SPANS_S, PLAYBACK_SPEEDS } from '../../ui/timeline';
import type { LayerDefinition, LayerParams } from '../types';
import { DEEP_PRESETS, PRESETS } from './events';

/**
 * What a guide or a link may set (waves.ts setParams). The earthquakes are the fixed ones: the latest large one comes
 * from a live feed, so it is a different earthquake on a different day, and a guide that names it would say
 * something untrue a week later. A link can still ask for it (?quake=latest).
 */
export const SEISMIC_WAVE_PARAMS = {
  quake: {
    type: 'string',
    description: 'The earthquake, by key. Choosing one goes back to its origin and plays, unless `t` or `playing` says otherwise.',
    values: [...PRESETS, ...DEEP_PRESETS].map((preset) => preset.key),
  },
  t: {
    type: 'number',
    description: 'Seconds since the origin. The scrubber widens to hold it.',
    minimum: 0,
    maximum: PLAYBACK_SPANS_S[PLAYBACK_SPANS_S.length - 1],
  },
  speed: { type: 'number', description: 'Seconds of wave travel per second watched.', values: [...PLAYBACK_SPEEDS] },
  playing: { type: 'boolean', description: 'Play or pause.' },
  shadows: { type: 'boolean', description: 'Tint the P and S shadow zones.' },
} as const satisfies LayerParams;

/**
 * Seismic wave playback. Off by default: it is something to do, with a
 * control of its own, not a map to leave on.
 */
const seismicWaves: LayerDefinition = {
  id: 'seismic-waves',
  label: 'Seismic waves',
  section: 'Inside the Earth',
  order: 12,
  legend: 'linear-gradient(to right, #a8d4ff 0 25%, #ff9a4d 25% 50%, #8ef0b0 50% 75%, #f2f07a 75% 100%)',
  caption:
    'pick an earthquake and play it: P (blue), S (orange, stops at the liquid core), Love and Rayleigh surface waves · ' +
    'model: ak135, a radial Earth · point source, no amplitudes or attenuation, reflections not drawn · surface-wave rings approximate · ' +
    'Tōhoku 2011 also glows where the ground shakes: a full-wavefield simulation of it, every phase and the fault’s radiation pattern',
  credits: [
    {
      what: 'Seismic travel times and ray paths: the ak135 Earth model',
      source: 'Kennett, Engdahl & Buland (1995), Geophys. J. Int. 122, 108–124; rays traced with ObsPy TauP (Crotwell, Owens & Ritsema 1999)',
      licence: 'no stated licence: a published model, cited as its authors ask; ObsPy (LGPL-3.0) is used offline only',
      url: 'https://rses.anu.edu.au/seismology/ak135/intro.html',
    },
    {
      what: 'Surface-wave group speeds (Rayleigh 3.72 km/s, Love 4.38 km/s)',
      source: 'Dziewonski & Anderson (1981), Preliminary Reference Earth Model, Phys. Earth Planet. Inter. 25, 297–356, Table V',
      licence: 'no stated licence: two published figures, cited',
      url: 'https://doi.org/10.1016/0031-9201(81)90046-7',
    },
    {
      what: 'Earthquakes played (presets, deep events, latest M6+)',
      source: 'USGS ANSS Comprehensive Earthquake Catalog (ComCat) and real-time feeds',
      licence: 'public domain',
      url: 'https://earthquake.usgs.gov/data/comcat/',
    },
    {
      what: 'Simulated surface shaking of the 2011 Tōhoku earthquake (full wavefield, model prem_a_10s, anisotropic PREM)',
      source: 'EarthScope Syngine (Krischer et al. 2017, Seismol. Res. Lett. 88(4), 1127–1140), Instaseis on AxiSEM wavefield databases',
      licence: 'no stated licence: a public research service, cited as its authors ask',
      url: 'https://doi.org/10.1785/0220160210',
    },
    {
      what: 'Moment tensor of the 2011 Tōhoku earthquake (M201103110546A)',
      source: 'Global CMT Project (Dziewonski, Chou & Woodhouse 1981; Ekström, Nettles & Dziewonski 2012)',
      licence: 'no stated licence: a published catalogue, cited as its authors ask',
      url: 'https://www.globalcmt.org/',
    },
    // Word for word the notable-earthquakes layer's entry, so the two merge into one line:
    // the Valdivia 1960 hypocentre played here is ISC-GEM's.
    {
      what: 'Earthquake locations before 1973, and 0.4 % of the M5+ catalogue',
      source: 'ISC-GEM Global Instrumental Earthquake Catalogue, International Seismological Centre (2026), via ComCat',
      licence: 'CC BY-SA 3.0',
      url: 'https://doi.org/10.31905/D808B825',
    },
  ],
  params: SEISMIC_WAVE_PARAMS,
  load: async (context) => (await import('./waves')).createSeismicWavesLayer(context),
};

export default seismicWaves;
