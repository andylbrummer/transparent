/**
 * The in-app credits list: the always-loaded map's sources, then each lazy
 * layer's own. The full table, with citations, is docs/DATA-SOURCES.md.
 */

import type { Credit, LayerDefinition } from '../layers/types';

/** Sources of the always-loaded layers; mirrors app/public/geo/ATTRIBUTION.md. */
export const BUILTIN_CREDITS: readonly Credit[] = [
  {
    what: 'Surface imagery (Blue Marble)',
    source: 'NASA Global Imagery Browse Services (GIBS), NASA Earth Science Data and Information System',
    licence: 'public domain',
    url: 'https://earthdata.nasa.gov/gibs',
  },
  {
    what: 'Coastlines, borders, place names',
    source: 'Natural Earth',
    licence: 'public domain',
    url: 'https://www.naturalearthdata.com/',
  },
  {
    what: 'Plate boundaries and plate names',
    source: 'Bird (2003) PB2002; GIS conversion by H. Ahlenius, Nordpil',
    licence: 'ODC-By 1.0',
    url: 'https://github.com/fraxen/tectonicplates',
  },
  {
    what: 'Active faults',
    source: 'GEM Global Active Faults Database, Styron & Pagani (2020)',
    licence: 'CC BY-SA 4.0',
    url: 'https://github.com/GEMScienceTools/gem-global-active-faults',
  },
  {
    what: 'Hotspots and plume classes',
    source: 'Whittaker et al. (2015), via EarthByte',
    licence: 'CC BY 3.0',
    url: 'https://www.earthbyte.org/',
  },
  {
    what: 'Volcano locations',
    source: 'NOAA NCEI Volcano Locations Database',
    licence: 'public domain',
    url: 'https://www.ngdc.noaa.gov/hazel/view/hazards/volcano/loc-search',
  },
  {
    what: 'Subducting slabs',
    source: 'Hayes et al. (2018), Slab2, USGS',
    licence: 'public domain',
    url: 'https://www.sciencebase.gov/catalog/item/5aa1b00ee4b0b1c392e86467',
  },
  {
    what: 'Earthquake hypocentres',
    source: 'USGS ANSS Comprehensive Earthquake Catalog (ComCat)',
    licence: 'public domain',
    url: 'https://earthquake.usgs.gov/data/comcat/',
  },
  {
    what: 'Plate motion',
    source: 'Argus, Gordon & DeMets (2011), NNR-MORVEL56',
    licence: 'facts from the literature',
    url: 'https://doi.org/10.1029/2011GC003751',
  },
  {
    what: 'Mantle flow (model)',
    source: 'hc (Hager & O’Connell 1981) driven by SEMUCB-WM1 (French & Romanowicz 2014)',
    licence: 'model output',
    url: 'https://github.com/geodynamics/hc',
  },
  {
    what: 'Magnetic declination',
    source: 'World Magnetic Model 2025, NOAA NCEI / British Geological Survey',
    licence: 'public domain',
    url: 'https://www.ncei.noaa.gov/products/world-magnetic-model',
  },
];

/** Built-in credits, then the lazy layers' in panel order, without repeats. */
export function allCredits(definitions: readonly LayerDefinition[]): Credit[] {
  const seen = new Set<string>();
  const credits: Credit[] = [];
  for (const credit of [...BUILTIN_CREDITS, ...definitions.flatMap((d) => d.credits)]) {
    const key = `${credit.what}|${credit.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    credits.push(credit);
  }
  return credits;
}
