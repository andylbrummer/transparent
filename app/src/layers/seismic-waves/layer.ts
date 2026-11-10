import type { LayerDefinition } from '../types';

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
    'model: ak135, a radial Earth · point source, no amplitudes or attenuation, reflections not drawn · surface-wave rings approximate',
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
    // Word for word the notable-earthquakes layer's entry, so the two merge into one line:
    // the Valdivia 1960 hypocentre played here is ISC-GEM's.
    {
      what: 'Earthquake locations before 1973, and 0.4 % of the M5+ catalogue',
      source: 'ISC-GEM Global Instrumental Earthquake Catalogue, International Seismological Centre (2026), via ComCat',
      licence: 'CC BY-SA 3.0',
      url: 'https://doi.org/10.31905/D808B825',
    },
  ],
  load: async (context) => (await import('./waves')).createSeismicWavesLayer(context),
};

export default seismicWaves;
