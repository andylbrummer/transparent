/**
 * What each deep-sky catalogue is called, whom to credit, and how its
 * classes and values are drawn. Light on purpose: layer.ts imports this
 * eagerly for the panel; the code that fetches and builds is in catalog.ts.
 *
 * The data files are baked by tools/pipeline/generate_deepsky.py, which
 * documents what each file's `val` column holds.
 */

import type { SkyPointShape } from '../../render/sky-points';
import type { Credit } from '../types';

export interface ClassStyle {
  /** Name in the caption. */
  readonly label: string;
  /** CSS hex colour, #rrggbb. */
  readonly color: string;
  readonly shape: SkyPointShape;
}

interface SpecBase {
  readonly id: string;
  readonly label: string;
  readonly order: number;
  /** Path under app/public/ of the JSON file. */
  readonly file: string;
  /** Leads the caption; the legend's colours follow it for catalogues. */
  readonly about: string;
  readonly credits: readonly Credit[];
}

export interface CatalogSpec extends SpecBase {
  readonly kind: 'catalog';
  /** Keyed by the class names in the data file, in legend order. */
  readonly classes: Readonly<Record<string, ClassStyle>>;
  /** Marker diameter in CSS px from the file's value column. */
  readonly sizePx: (value: number, className: string) => number;
  /** Marker opacity; default 1. */
  readonly alpha?: (value: number, className: string) => number;
  /** Declutter rank of the names: see render/labels.ts (stars are 6.4). */
  readonly labelRank: number;
  readonly labelColor: string;
  /**
   * Names whose priority in the file is at or under `maxPriority` are
   * ranked at `rank` instead: the showpieces, which should win a place
   * over a third-magnitude star's name, without the whole catalogue
   * crowding the star names out.
   */
  readonly featured?: { readonly maxPriority: number; readonly rank: number };
  /**
   * Draw names above the marker rather than under it: for catalogues of
   * stars, whose markers sit on a star that has its own name underneath.
   */
  readonly labelAbove?: boolean;
}

export interface CloudSpec extends SpecBase {
  readonly kind: 'cloud';
  readonly sizePx: (value: number) => number;
  /** Colour ramp over the value column: [value, #rrggbb] stops, ascending. */
  readonly ramp: readonly (readonly [number, string])[];
  /** What the ramp's ends mean, for the caption. */
  readonly rampCaption: string;
  readonly opacity: number;
}

export type DeepSkySpec = CatalogSpec | CloudSpec;

const HEASARC = 'https://heasarc.gsfc.nasa.gov/';
const PUBLISHED = 'published catalogue, free use with citation';

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
/** Size for a log-flux value column (log10 × 100, −1 where the catalogue has none). */
const fluxSize =
  (base: number, perDex: number, max: number) =>
  (value: number): number =>
    value < 0 ? base : clamp(base + (value / 100) * perDex, base, max);
/** Size for a magnitude × 10 column (999 where the catalogue has none). */
const magnitudeSize =
  (bright: number, faint: number) =>
  (value: number): number =>
    value >= 999 ? faint : clamp(bright - (value / 10 - 3) * ((bright - faint) / 8.5), faint, bright);

export const DEEP_SKY_SPECS: readonly DeepSkySpec[] = [
  {
    kind: 'catalog',
    id: 'deep-sky-objects',
    label: 'Messier, NGC & IC objects',
    order: 10,
    file: 'sky/deep/dso.json',
    about: '1,300 galaxies, clusters and nebulae to magnitude 11.5, the large ones outlined at true size',
    classes: {
      galaxy: { label: 'galaxy', color: '#ff9a7a', shape: 'ring' },
      open: { label: 'open cluster', color: '#ffe27a', shape: 'ring' },
      globular: { label: 'globular cluster', color: '#ffc04d', shape: 'cross' },
      nebula: { label: 'nebula', color: '#7dffa8', shape: 'square' },
      planetary: { label: 'planetary nebula', color: '#6fe8ff', shape: 'diamond' },
      snr: { label: 'supernova remnant', color: '#d79bff', shape: 'diamond' },
      dark: { label: 'dark nebula', color: '#8d99a6', shape: 'square' },
      other: { label: 'other', color: '#c8d2dc', shape: 'disc' },
    },
    sizePx: magnitudeSize(13, 6),
    labelRank: 6.41,
    labelColor: '#ffd9c2',
    // Priority is magnitude − 2 for a Messier object, magnitude + 1.5 for other named ones: about fifty showpieces.
    featured: { maxPriority: 4.5, rank: 6.39 },
    credits: [
      {
        what: 'Messier, NGC and IC objects: positions, types, magnitudes, sizes',
        source: 'OpenNGC by Mattia Verga and contributors',
        licence: 'CC BY-SA 4.0',
        url: 'https://github.com/mattiaverga/OpenNGC',
      },
    ],
  },
  {
    kind: 'catalog',
    id: 'globular-clusters',
    label: 'Globular clusters',
    order: 12,
    file: 'sky/deep/globulars.json',
    about: 'all 157 known around the Milky Way, crowding toward its centre · circle: half-light radius',
    classes: { globular: { label: 'globular cluster', color: '#ffc04d', shape: 'cross' } },
    sizePx: magnitudeSize(13, 6),
    labelRank: 6.43,
    labelColor: '#ffd98a',
    credits: [
      {
        what: 'Milky Way globular clusters',
        source: 'Harris W.E. 1996, AJ 112, 1487 (2010 edition), via NASA HEASARC',
        licence: PUBLISHED,
        url: 'https://physics.mcmaster.ca/~harris/mwgc.dat',
      },
    ],
  },
  {
    kind: 'catalog',
    id: 'supernova-remnants',
    label: 'Supernova remnants',
    order: 14,
    file: 'sky/deep/snr.json',
    about: '295 radio remnants in the Galaxy, circled at their mean angular size',
    classes: {
      shell: { label: 'shell', color: '#d79bff', shape: 'diamond' },
      filled: { label: 'filled centre (pulsar wind)', color: '#7ad0ff', shape: 'diamond' },
      composite: { label: 'composite', color: '#ff9ad0', shape: 'diamond' },
      uncertain: { label: 'uncertain', color: '#9a94b0', shape: 'diamond' },
    },
    sizePx: fluxSize(5, 1, 11),
    labelRank: 6.44,
    labelColor: '#e2c2ff',
    credits: [
      {
        what: 'Galactic supernova remnants',
        source: 'Green D.A., A Catalogue of Galactic Supernova Remnants (June 2017 version), via NASA HEASARC',
        licence: PUBLISHED,
        url: 'https://www.mrao.cam.ac.uk/surveys/snrs/',
      },
    ],
  },
  {
    kind: 'catalog',
    id: 'nearby-stars',
    label: 'Nearest stars',
    order: 20,
    file: 'sky/deep/nearby.json',
    about: 'every known star and brown dwarf within 10 parsecs (33 light-years), with distances',
    classes: {
      star: { label: 'A-K star', color: '#fff3c4', shape: 'ring' },
      'low-mass': { label: 'red dwarf', color: '#ff8a5c', shape: 'ring' },
      'brown-dwarf': { label: 'brown dwarf', color: '#b0703c', shape: 'ring' },
      'white-dwarf': { label: 'white dwarf', color: '#a8d8ff', shape: 'ring' },
    },
    // Value: distance in hundredths of a light-year. Nearer is larger.
    sizePx: (value) => clamp(12 - value / 400, 5, 12),
    labelRank: 6.42,
    labelColor: '#ffe9b8',
    labelAbove: true,
    credits: [
      {
        what: 'Stars and brown dwarfs within 10 parsecs',
        source: 'Reylé C. et al. 2021, A&A 650, A201: The 10 parsec sample in the Gaia era (2023 update), CDS J/A+A/650/A201',
        licence: 'free use with citation (CDS VizieR)',
        url: 'https://gruze.org/10pc/',
      },
    ],
  },
  {
    kind: 'catalog',
    id: 'exoplanet-hosts',
    label: 'Exoplanet host stars',
    order: 22,
    file: 'sky/deep/exoplanets.json',
    about: '4,900 stars with confirmed planets, by how the first was found · larger: more planets',
    classes: {
      transit: { label: 'transit', color: '#5ad1ff', shape: 'disc' },
      'radial-velocity': { label: 'radial velocity', color: '#ffb05a', shape: 'disc' },
      imaging: { label: 'imaging', color: '#ff6fa8', shape: 'disc' },
      microlensing: { label: 'microlensing', color: '#b48cff', shape: 'disc' },
      other: { label: 'timing & other', color: '#9ad36a', shape: 'disc' },
    },
    // Value: number of planets.
    sizePx: (value) => clamp(2.6 + value * 0.9, 3, 10),
    alpha: (value) => (value > 1 ? 1 : 0.8),
    labelRank: 6.45,
    labelColor: '#bfe9ff',
    labelAbove: true,
    credits: [
      {
        what: 'Confirmed exoplanets and their host stars',
        source: 'NASA Exoplanet Archive, Planetary Systems Composite Parameters (Caltech/IPAC, under contract with NASA)',
        licence: 'public, citation requested',
        url: 'https://exoplanetarchive.ipac.caltech.edu/',
      },
    ],
  },
  {
    kind: 'catalog',
    id: 'pulsars',
    label: 'Pulsars',
    order: 30,
    file: 'sky/deep/pulsars.json',
    about: '4,500 spinning neutron stars, strung along the Milky Way',
    classes: {
      normal: { label: 'pulsar', color: '#8fb4ff', shape: 'disc' },
      millisecond: { label: 'millisecond pulsar', color: '#7dffd0', shape: 'disc' },
      magnetar: { label: 'magnetar', color: '#ff7ad9', shape: 'diamond' },
    },
    sizePx: (_value, className) => (className === 'magnetar' ? 8 : className === 'millisecond' ? 3.6 : 3.2),
    alpha: (_value, className) => (className === 'normal' ? 0.75 : 1),
    labelRank: 6.46,
    labelColor: '#c2d6ff',
    credits: [
      {
        what: 'Pulsar positions, periods and types',
        source: 'ATNF Pulsar Catalogue, Manchester R.N., Hobbs G.B., Teoh A., Hobbs M. 2005, AJ 129, 1993, via NASA HEASARC',
        licence: 'free use with acknowledgement',
        url: 'https://www.atnf.csiro.au/research/pulsar/psrcat/',
      },
    ],
  },
  {
    kind: 'catalog',
    id: 'xray-sources',
    label: 'X-ray sources (Swift-BAT)',
    order: 40,
    file: 'sky/deep/xray-hard.json',
    about: 'the 1,900 brightest at 14-195 keV · larger: brighter',
    classes: {
      xrb: { label: 'X-ray binary', color: '#6fd0ff', shape: 'diamond' },
      'pulsar-snr': { label: 'pulsar or remnant', color: '#d79bff', shape: 'diamond' },
      star: { label: 'cataclysmic or other star', color: '#fff0a0', shape: 'diamond' },
      agn: { label: 'active galaxy', color: '#ff9a7a', shape: 'ring' },
      'beamed-agn': { label: 'beamed (jet) active galaxy', color: '#ff5f8f', shape: 'ring' },
      cluster: { label: 'galaxy cluster', color: '#9dff8a', shape: 'square' },
      unknown: { label: 'unidentified', color: '#8d99a6', shape: 'disc' },
    },
    sizePx: fluxSize(4.5, 2.6, 16),
    labelRank: 6.47,
    labelColor: '#bfe6ff',
    credits: [
      {
        what: 'Hard X-ray sources and their identifications',
        source: 'Swift-BAT 157-Month All-Sky Hard X-ray Survey (Lien A. et al. 2025), via NASA HEASARC',
        licence: 'NASA data, public',
        url: 'https://swift.gsfc.nasa.gov/results/bs157mon/',
      },
    ],
  },
  {
    kind: 'catalog',
    id: 'xray-binaries',
    label: 'X-ray binaries',
    order: 41,
    file: 'sky/deep/xray-binaries.json',
    about: '300 neutron stars and black holes feeding on a companion star',
    classes: {
      hmxb: { label: 'high-mass companion', color: '#7ab8ff', shape: 'diamond' },
      lmxb: { label: 'low-mass companion', color: '#ffb36b', shape: 'diamond' },
    },
    sizePx: fluxSize(5, 1.8, 14),
    labelRank: 6.48,
    labelColor: '#d6e6ff',
    credits: [
      {
        what: 'High-mass and low-mass X-ray binaries of the Galaxy',
        source: 'Liu Q.Z., van Paradijs J., van den Heuvel E.P.J. 2006, A&A 455, 1165 and 2007, A&A 469, 807, via NASA HEASARC',
        licence: PUBLISHED,
        url: HEASARC + 'W3Browse/all/lmxbcat.html',
      },
    ],
  },
  {
    kind: 'catalog',
    id: 'xray-uhuru',
    label: 'First X-ray sky (Uhuru, 1970-73)',
    order: 42,
    file: 'sky/deep/xray-uhuru.json',
    about: "the 339 sources of the first X-ray satellite's catalogue, 2-6 keV · larger: brighter",
    classes: { source: { label: '4U source', color: '#a9c8ff', shape: 'square' } },
    sizePx: fluxSize(4, 2.8, 16),
    labelRank: 6.49,
    labelColor: '#c9dcff',
    credits: [
      {
        what: 'The Fourth Uhuru (4U) catalogue',
        source: 'Forman W. et al. 1978, ApJS 38, 357, via NASA HEASARC',
        licence: 'NASA data, public',
        url: HEASARC + 'W3Browse/uhuru/uhuru4.html',
      },
    ],
  },
  {
    kind: 'cloud',
    id: 'xray-rosat',
    label: 'Soft X-ray sources (ROSAT)',
    order: 43,
    file: 'sky/deep/xray-rosat.json',
    about: '18,811 sources of the ROSAT All-Sky Survey, 0.1-2.4 keV: mostly stellar coronae and active galaxies',
    // Value: 0.01 counts/s.
    sizePx: (value) => clamp(1.6 + Math.log10(Math.max(value, 5)) * 1.5, 2, 9),
    ramp: [
      [5, '#4a6fd0'],
      [100, '#7fb6ff'],
      [1000, '#e8f4ff'],
    ],
    rampCaption: 'faint → bright',
    opacity: 0.85,
    credits: [
      {
        what: 'ROSAT All-Sky Survey Bright Source Catalogue',
        source: 'Voges W. et al. 1999, A&A 349, 389 (MPE Garching), via NASA HEASARC',
        licence: PUBLISHED,
        url: HEASARC + 'W3Browse/rosat/rassbsc.html',
      },
    ],
  },
  {
    kind: 'catalog',
    id: 'gamma-sources',
    label: 'Gamma-ray sources (Fermi)',
    order: 45,
    file: 'sky/deep/gamma.json',
    about: 'all 7,195 sources of the Fermi-LAT catalogue, 0.1-100 GeV · larger: brighter',
    classes: {
      pulsar: { label: 'pulsar', color: '#7dffd0', shape: 'diamond' },
      'snr-pwn': { label: 'remnant or pulsar wind', color: '#d79bff', shape: 'diamond' },
      blazar: { label: 'blazar', color: '#ff5f8f', shape: 'ring' },
      agn: { label: 'other active galaxy', color: '#ff9a7a', shape: 'ring' },
      galaxy: { label: 'galaxy', color: '#ffe27a', shape: 'ring' },
      binary: { label: 'binary or nova', color: '#6fd0ff', shape: 'diamond' },
      globular: { label: 'globular cluster', color: '#ffc04d', shape: 'cross' },
      unassociated: { label: 'unidentified', color: '#8d99a6', shape: 'disc' },
    },
    sizePx: fluxSize(3, 2.6, 15),
    alpha: (_value, className) => (className === 'unassociated' ? 0.7 : 1),
    labelRank: 6.5,
    labelColor: '#e7c9ff',
    credits: [
      {
        what: 'Gamma-ray sources and their associations',
        source: 'Fermi-LAT Fourth Source Catalog, Data Release 4 (Abdollahi S. et al. 2022; Ballet J. et al. 2023), via NASA HEASARC',
        licence: 'NASA data, public',
        url: 'https://fermi.gsfc.nasa.gov/ssc/data/access/lat/14yr_catalog/',
      },
    ],
  },
  {
    kind: 'catalog',
    id: 'nearby-galaxies',
    label: 'Nearby galaxies',
    order: 50,
    file: 'sky/deep/galaxies.json',
    about: '868 galaxies within 11 megaparsecs, with distances',
    classes: {
      'local-group': { label: 'Local Group', color: '#ffe27a', shape: 'ring' },
      nearby: { label: 'beyond, to 11 Mpc', color: '#ff9a7a', shape: 'ring' },
    },
    sizePx: (_value, className) => (className === 'local-group' ? 8 : 5.5),
    labelRank: 6.51,
    labelColor: '#ffe3b3',
    credits: [
      {
        what: 'Galaxies of the Local Volume and their distances',
        source: 'Karachentsev I.D., Makarov D.I., Kaisina E.I. 2013, AJ 145, 101: Updated Nearby Galaxy Catalog, CDS J/AJ/145/101',
        licence: 'free use with citation (CDS VizieR)',
        url: 'https://ui.adsabs.harvard.edu/abs/2013AJ....145..101K',
      },
    ],
  },
  {
    kind: 'cloud',
    id: 'galaxy-survey',
    label: 'Galaxies in depth (2MRS)',
    order: 52,
    file: 'sky/deep/lss.json',
    about: '43,533 galaxies of the 2MASS Redshift Survey: the cosmic web out to 400 million light-years, empty where the Milky Way hides it',
    sizePx: (value) => clamp(3.4 - value / 9000, 1.8, 3.4),
    // Value: cz in km/s. Blue is near, red is far - as the light itself is shifted.
    ramp: [
      [0, '#a8c8ff'],
      [2500, '#7dffd0'],
      [5000, '#ffe27a'],
      [8000, '#ff9a4a'],
      [12000, '#ff4a4a'],
      [20000, '#a02060'],
    ],
    rampCaption: 'near → 900 million light-years (redshift 0.07)',
    opacity: 0.9,
    credits: [
      {
        what: '2MASS Redshift Survey',
        source: 'Huchra J.P. et al. 2012, ApJS 199, 26, via NASA HEASARC',
        licence: PUBLISHED,
        url: HEASARC + 'W3Browse/all/twomassrsc.html',
      },
    ],
  },
  {
    kind: 'catalog',
    id: 'galaxy-clusters',
    label: 'Galaxy clusters (Abell)',
    order: 54,
    file: 'sky/deep/clusters.json',
    about: "5,250 rich clusters · larger: richer · brighter: nearer · none where the Milky Way's dust hides them",
    classes: {
      'rich-0': { label: 'richness 0', color: '#7a9ad0', shape: 'square' },
      'rich-1': { label: '1', color: '#8fd0c0', shape: 'square' },
      'rich-2': { label: '2', color: '#d8e27a', shape: 'square' },
      'rich-3': { label: '3', color: '#ffb05a', shape: 'square' },
      'rich-4': { label: '4', color: '#ff7a5a', shape: 'square' },
      'rich-5': { label: '5', color: '#ff4a8a', shape: 'square' },
    },
    sizePx: (_value, className) => 4 + Number(className.slice(5)) * 1.6,
    // Value: Abell's distance class, 1 (nearest) to 7; 0 where he gives none.
    alpha: (value) => (value === 0 ? 0.5 : clamp(1.15 - value * 0.13, 0.3, 1)),
    labelRank: 6.52,
    labelColor: '#d9f0c2',
    credits: [
      {
        what: 'Rich clusters of galaxies',
        source: 'Abell G.O., Corwin H.G., Olowin R.P. 1989, ApJS 70, 1, via NASA HEASARC',
        licence: PUBLISHED,
        url: HEASARC + 'W3Browse/galaxy-catalog/abell.html',
      },
    ],
  },
  {
    kind: 'catalog',
    id: 'quasars',
    label: 'Quasars & active galaxies',
    order: 56,
    file: 'sky/deep/quasars.json',
    about: 'the 456 brightest quasars and blazars, and famous active galaxies, with redshifts',
    classes: {
      quasar: { label: 'quasar', color: '#b48cff', shape: 'cross' },
      blazar: { label: 'blazar', color: '#ff5f8f', shape: 'cross' },
      'active-galaxy': { label: 'active galaxy', color: '#ff9a7a', shape: 'cross' },
    },
    sizePx: () => 8,
    labelRank: 6.53,
    labelColor: '#dccbff',
    credits: [
      {
        what: 'Quasars, BL Lac objects and active galaxies',
        source: 'Véron-Cetty M.-P., Véron P. 2010, A&A 518, A10 (13th edition), via NASA HEASARC',
        licence: PUBLISHED,
        url: HEASARC + 'W3Browse/all/veroncat.html',
      },
    ],
  },
  {
    kind: 'catalog',
    id: 'sky-landmarks',
    label: 'Sky landmarks',
    order: 60,
    file: 'sky/deep/landmarks.json',
    about: 'black holes, historic supernovae, deep fields, where we are heading, where the Voyagers are',
    classes: {
      'black-hole': { label: 'black hole', color: '#ffffff', shape: 'ring' },
      supernova: { label: 'supernova', color: '#ffd24a', shape: 'star' },
      messenger: { label: 'neutrino or gravitational-wave source', color: '#7dffd0', shape: 'diamond' },
      field: { label: 'deep field', color: '#8fb4ff', shape: 'square' },
      structure: { label: 'large structure', color: '#ff9a7a', shape: 'ring' },
      direction: { label: 'direction of motion', color: '#ff7ad9', shape: 'cross' },
      spacecraft: { label: 'spacecraft', color: '#9dff8a', shape: 'diamond' },
    },
    sizePx: (_value, className) => (className === 'supernova' ? 12 : 10),
    labelRank: 6.38,
    labelColor: '#ffffff',
    credits: [
      {
        what: 'Positions of named objects',
        source: 'SIMBAD astronomical database, CDS Strasbourg (Wenger M. et al. 2000, A&AS 143, 9)',
        licence: 'free use with acknowledgement',
        url: 'https://simbad.cds.unistra.fr/simbad/',
      },
      {
        what: 'Direction of the CMB dipole',
        source: 'Planck Collaboration 2020, A&A 641, A1 (Planck 2018 results I)',
        licence: 'published value',
        url: 'https://arxiv.org/abs/1807.06205',
      },
      {
        what: "The Sun's motion among nearby stars (solar apex)",
        source: 'Schönrich R., Binney J., Dehnen W. 2010, MNRAS 403, 1829',
        licence: 'published value',
        url: 'https://arxiv.org/abs/0912.3693',
      },
      {
        what: 'Directions of Voyager 1 and 2, Pioneer 10 and New Horizons (1 January 2026)',
        source: 'JPL Horizons, Solar System Dynamics Group, NASA/JPL',
        licence: 'public',
        url: 'https://ssd.jpl.nasa.gov/horizons/',
      },
    ],
  },
];

/** The legend bar: one equal block per class, in the order the caption names them. */
export function classLegend(classes: Readonly<Record<string, ClassStyle>>): string {
  const styles = Object.values(classes);
  const stops = styles.map((style, i) => `${style.color} ${(i / styles.length) * 100}% ${((i + 1) / styles.length) * 100}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/** The legend bar of a cloud: its colour ramp, stops spread evenly. */
export function rampLegend(ramp: readonly (readonly [number, string])[]): string {
  return `linear-gradient(90deg, ${ramp.map(([, color]) => color).join(', ')})`;
}

export function specCaption(spec: DeepSkySpec): string {
  if (spec.kind === 'cloud') return `${spec.about} · ${spec.rampCaption}`;
  const names = Object.values(spec.classes).map((style) => style.label);
  return names.length > 1 ? `${spec.about} · ${names.join(' · ')}` : spec.about;
}
