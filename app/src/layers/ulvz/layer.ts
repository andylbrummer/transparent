import type { LayerDefinition } from '../types';

/**
 * What a study found where it sampled the core-mantle boundary. A
 * magenta nothing else in the mantle uses for a ULVZ; grey for a place
 * that was looked at and had none, which is as much a result.
 */
export const ULVZ_COLORS = { yes: 0xff5ad2, may: 0xe6b3dc, no: 0x93a5b8 } as const;

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

const ulvz: LayerDefinition = {
  id: 'ulvz',
  label: 'Ultra-low velocity zones on the core (ULVZ)',
  section: 'Inside the Earth',
  order: 57,
  legend: `linear-gradient(to right, ${hex(ULVZ_COLORS.yes)} 0% 40%, ${hex(ULVZ_COLORS.may)} 40% 60%, ${hex(ULVZ_COLORS.no)} 60% 100%)`,
  caption:
    'thin patches on the core, 2,891 km down, where seismic waves slow by tens of per cent · ' +
    'where 54 studies looked: ● and magenta outlines found one, ✕ and grey looked and found none, ○ pale uncertain · ' +
    'points are where a ray met the core, lines the paths of waves along it, outlines the regions studied · ' +
    'most of the core has not been looked at: empty is unknown, not clear · the four largest are named',
  credits: [
    {
      what: 'Ultra-low velocity zone detections and non-detections at the core-mantle boundary',
      source:
        'Yu, S. & Garnero, E.J. (2018), Ultralow Velocity Zone Locations: A Global Assessment, Geochem. Geophys. Geosyst. 19, 396–414, doi:10.1002/2017GC007281; ULVZ Distribution Database from 54 studies v1.0.1, Zenodo, doi:10.5281/zenodo.1064217',
      licence: 'open access on Zenodo ("Other (Open)", no named licence); cited as the authors publish it',
      url: 'https://doi.org/10.5281/zenodo.1064217',
    },
    {
      what: 'Galápagos mega-ULVZ: position, width, height and velocity drop',
      source: 'Cottaar, S., Martin, C., Li, Z. & Parai, R. (2022), The root to the Galápagos mantle plume on the core-mantle boundary, Seismica 1(1), doi:10.26443/seismica.v1i1.197',
      licence: 'CC BY 4.0',
      url: 'https://doi.org/10.26443/seismica.v1i1.197',
    },
  ],
  load: async (context) => (await import('./ulvz')).createUlvzLayer(context),
};

export default ulvz;
