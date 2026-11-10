/**
 * What each satellite switch shows: which CelesTrak groups, in what
 * colours, and which objects get a name or an orbit line.
 *
 * Group names are CelesTrak's (GROUP=...) and are repeated in
 * tools/pipeline/generate_satellites_snapshot.py, which bakes the fallback.
 * Names are matched against CelesTrak's OBJECT_NAME; an object that is not
 * in the data is simply not labelled.
 */

import type { GpRecord } from './orbit-math';

export type Rgb = readonly [number, number, number];

export interface Naming {
  readonly name: string;
  /** Lower is more important. */
  readonly priority: number;
  /** What follows the name: height above the ground, or the longitude a geostationary satellite keeps. */
  readonly detail: 'height' | 'longitude' | 'none';
}

export interface SourceSpec {
  readonly group: string;
  readonly color: Rgb;
}

export interface LayerSpec {
  readonly sources: readonly SourceSpec[];
  /** Point size, CSS px; named objects are drawn larger by NAMED_SIZE_FACTOR. */
  readonly sizePx: number;
  /** Declutter rank of the names: among the sky's, after the Moon (6.33) and before the star names (6.4). */
  readonly labelRank: number;
  readonly labelColor: string;
  /** The name to show, or null for a bare point. */
  naming(record: GpRecord, sourceIndex: number): Naming | null;
  /** Whether to draw the object's next revolution. */
  orbit(record: GpRecord, named: Naming | null): boolean;
}

export const NAMED_SIZE_FACTOR = 1.6;

const never = (): boolean => false;
const noName = (): null => null;

/** Catalogue names that are initials, and stay in capitals. */
const ACRONYMS = new Set(['GOES', 'NOAA', 'TDRS', 'DMSP', 'INSAT', 'GCOM', 'SMAP', 'SWOT', 'NUSTAR', 'IXPE', 'DAMPE', 'TIMED', 'SWAS', 'SORCE', 'CASSIOPE']);

/** "COSMOS 1408 DEB" → "Cosmos 1408 DEB", "METEOSAT-12" → "Meteosat-12": words of four letters and more lose their capitals, initials keep them. */
export function tidyName(name: string): string {
  return name.replace(/\s+/g, ' ').replace(/[A-Z]{4,}/g, (word) => (ACRONYMS.has(word) ? word : word[0] + word.slice(1).toLowerCase()));
}

const SCIENCE_NAMES: Readonly<Record<string, string>> = {
  HST: 'Hubble',
  CXO: 'Chandra',
  'XMM-NEWTON': 'XMM-Newton',
  'FGRST (GLAST)': 'Fermi',
  NUSTAR: 'NuSTAR',
  IXPE: 'IXPE',
  SDO: 'Solar Dynamics Observatory',
  'HINODE (SOLAR-B)': 'Hinode',
  IRIS: 'IRIS',
  ASTROSAT: 'AstroSat',
  'HXMT (HUIYAN)': 'Insight-HXMT',
  SMILE: 'SMILE',
  NEOSSAT: 'NEOSSat',
  DAMPE: 'DAMPE',
  'MMS 1': 'MMS',
  TERRA: 'Terra',
  'CRYOSAT 2': 'CryoSat-2',
  'OCO 2': 'OCO-2',
  'SWARM A': 'Swarm',
  TIMED: 'TIMED',
  POLAR: 'Polar',
};

/** Weather satellites of the geostationary ring, and NASA's relay satellites. */
const GEO_NOTABLE = /^(GOES \d+|EWS-G\d|METEOSAT-\d+|MTG-[IS]\d|HIMAWARI-\d+|GEO-KOMPSAT-2A|FENGYUN 4[A-Z]|ELEKTRO-L \d|INSAT-3D[RS]?|TDRS \d+)/;
const EARTH_OBS_FIRST = /^(NOAA \d+|SUOMI NPP|METOP-|LANDSAT \d|TERRA$|AQUA$|AURA$|SENTINEL-|GOES \d+|HIMAWARI-|METEOSAT-)/;

export const LAYER_SPECS: Readonly<Record<string, LayerSpec>> = {
  'sat-stations': {
    sources: [{ group: 'stations', color: [1, 0.95, 0.78] }],
    sizePx: 6,
    labelRank: 6.31,
    labelColor: '#fff2c8',
    naming: (record) =>
      record.norad === 25544
        ? { name: 'ISS', priority: 0, detail: 'height' }
        : record.norad === 48274
          ? { name: 'Tiangong', priority: 1, detail: 'height' }
          : null,
    orbit: (_record, named) => named !== null,
  },
  'sat-visual': {
    sources: [{ group: 'visual', color: [0.93, 0.95, 1] }],
    sizePx: 5,
    labelRank: 6.38,
    labelColor: '#dfe6ff',
    naming: (record) =>
      record.norad === 20580
        ? { name: 'Hubble', priority: 0, detail: 'height' }
        : // Spent rocket stages make up most of the list: named, but after the spacecraft.
          { name: tidyName(record.name), priority: /R\/B/.test(record.name) ? 3 : 1, detail: 'height' },
    orbit: (record) => record.norad === 20580,
  },
  'sat-gnss': {
    sources: [
      { group: 'gps-ops', color: [1, 0.82, 0.3] },
      { group: 'galileo', color: [0.4, 0.7, 1] },
      { group: 'glo-ops', color: [1, 0.45, 0.4] },
      { group: 'beidou', color: [0.5, 0.95, 0.6] },
    ],
    sizePx: 5,
    labelRank: 6.39,
    labelColor: '#ffe9b0',
    naming: (record, source) => {
      const inBrackets = /\(([^)]+)\)\s*$/.exec(record.name)?.[1];
      if (!inBrackets) return null;
      const name =
        source === 0
          ? `GPS ${inBrackets.replace('PRN ', '')}`
          : source === 1
            ? tidyName(inBrackets)
            : source === 2
              ? `GLONASS ${inBrackets}`
              : `BeiDou ${inBrackets}`;
      return { name, priority: source, detail: 'none' };
    },
    orbit: () => true,
  },
  'sat-geo': {
    sources: [{ group: 'geo', color: [1, 0.62, 0.85] }],
    sizePx: 4,
    labelRank: 6.36,
    labelColor: '#ffc4e6',
    naming: (record) => (GEO_NOTABLE.test(record.name) ? { name: tidyName(record.name.replace(/\s*\(.*\)$/, '')), priority: /^GOES/.test(record.name) ? 0 : 1, detail: 'longitude' } : null),
    orbit: never,
  },
  'sat-earth-obs': {
    sources: [
      { group: 'weather', color: [0.45, 0.95, 0.9] },
      { group: 'resource', color: [0.55, 0.9, 0.6] },
    ],
    sizePx: 4.5,
    labelRank: 6.37,
    labelColor: '#b8f5ee',
    naming: (record) => ({ name: tidyName(record.name.replace(/\s*\(.*\)$/, '')), priority: EARTH_OBS_FIRST.test(record.name) ? 0 : 2, detail: 'height' }),
    orbit: never,
  },
  'sat-science': {
    sources: [{ group: 'science', color: [0.82, 0.68, 1] }],
    sizePx: 5,
    labelRank: 6.34,
    labelColor: '#e2d0ff',
    naming: (record) => {
      const known = SCIENCE_NAMES[record.name];
      // The four MMS and three Swarm craft fly together: one name for each formation.
      if (/^(MMS [2-4]|SWARM [BC])$/.test(record.name)) return null;
      return { name: known ?? tidyName(record.name.replace(/\s*\(.*\)$/, '')), priority: known ? 0 : 2, detail: 'height' };
    },
    orbit: (_record, named) => named !== null,
  },
  'sat-starlink': {
    sources: [{ group: 'starlink', color: [0.72, 0.8, 0.95] }],
    sizePx: 2.6,
    labelRank: 9,
    labelColor: '#fff',
    naming: noName,
    orbit: never,
  },
  'sat-oneweb': {
    sources: [{ group: 'oneweb', color: [1, 0.72, 0.5] }],
    sizePx: 3,
    labelRank: 9,
    labelColor: '#fff',
    naming: noName,
    orbit: never,
  },
  'sat-iridium': {
    sources: [{ group: 'iridium-NEXT', color: [0.72, 0.92, 0.5] }],
    sizePx: 4,
    labelRank: 9,
    labelColor: '#fff',
    naming: noName,
    orbit: () => true,
  },
  'sat-debris': {
    sources: [
      { group: 'fengyun-1c-debris', color: [1, 0.5, 0.25] },
      { group: 'cosmos-2251-debris', color: [1, 0.3, 0.4] },
      { group: 'iridium-33-debris', color: [1, 0.75, 0.3] },
      { group: 'cosmos-1408-debris', color: [0.88, 0.4, 0.9] },
    ],
    sizePx: 2.4,
    labelRank: 9,
    labelColor: '#fff',
    naming: noName,
    orbit: never,
  },
};

/** "423 km", "19,970 km": to the kilometre when low, where it changes by the minute; rounder higher up. */
export function heightText(heightKm: number): string {
  const step = heightKm < 2000 ? 1 : heightKm < 10000 ? 10 : 100;
  return `${(Math.round(heightKm / step) * step).toLocaleString('en-US')} km`;
}

/** "75.2°W". */
export function longitudeText(lonDeg: number): string {
  const lon = ((((lonDeg + 180) % 360) + 360) % 360) - 180;
  return `${Math.abs(lon).toFixed(1)}°${lon < 0 ? 'W' : 'E'}`;
}

export function labelText(naming: Naming, heightKm: number, lonDeg: number): string {
  if (naming.detail === 'height') return `${naming.name} · ${heightText(heightKm)}`;
  if (naming.detail === 'longitude') return `${naming.name} · ${longitudeText(lonDeg)}`;
  return naming.name;
}
