import type { SkyPointShape } from '../../render/sky-points';
import type { Credit, LayerDefinition } from '../types';

/**
 * The transient and multi-messenger sky: one switch per messenger. Each
 * file is a dated catalogue (tools/pipeline/generate_transients.py); the
 * app clock hides what had not happened yet. Light on purpose - the panel
 * imports this eagerly; the code that draws is in transients.ts.
 */

export interface TransientClass {
  /** Name in the caption. */
  readonly label: string;
  /** #rrggbb */
  readonly color: string;
  readonly shape: SkyPointShape;
}

export interface TransientSpec {
  readonly id: string;
  readonly label: string;
  readonly order: number;
  /** Path under app/public/. */
  readonly file: string;
  /** What the chip counts: "bursts", "alerts". */
  readonly noun: string;
  /**
   * What the chip says of the catalogue's reach once the clock is past its
   * last event. Absent, the date of that event: right for a catalogue that
   * is still growing and was baked on a day.
   */
  readonly span?: string;
  readonly caption: string;
  /** Keyed by the class names in the data file, in legend order. */
  readonly classes: Readonly<Record<string, TransientClass>>;
  /** Marker width in CSS px from the file's value column; 0 for no marker. */
  readonly sizePx: (value: number, className: string) => number;
  readonly alpha?: (value: number, className: string) => number;
  /**
   * Declutter rank of the names (see render/labels.ts). Just ahead of the star names at 6.4, like the deep-sky
   * showpieces: each file names a few tens of events at most, and with the constellations on they would otherwise
   * never get one of the sky's label slots.
   */
  readonly labelRank: number;
  readonly labelColor: string;
  /** How the pixels of a credible region are drawn, where the file has regions. */
  readonly region?: { readonly sizePx: number; readonly alpha: number };
  /** Colour of the error rectangles, where the file has them. */
  readonly boxColor?: string;
  readonly credits: readonly Credit[];
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const PUBLIC_DOMAIN = 'public domain (U.S. Government work)';
const PUBLISHED = 'published catalogue, free use with citation';

export const TRANSIENT_SPECS: readonly TransientSpec[] = [
  {
    id: 'gamma-ray-bursts',
    label: 'Gamma-ray bursts',
    order: 70,
    file: 'sky/transients/grb.json',
    noun: 'bursts',
    caption:
      '5,600 bursts seen by Fermi (2008 on) and Swift (2004 on), each at the moment it went off · size by fluence · long (collapsing stars) · short (merging neutron stars) · duration unknown · Fermi-only positions are good to a few degrees · they come from everywhere',
    classes: {
      long: { label: 'long', color: '#ff8fd0', shape: 'disc' },
      short: { label: 'short', color: '#6fe3ff', shape: 'disc' },
      unknown: { label: 'unknown', color: '#b9b2c9', shape: 'disc' },
    },
    // The value is log10(fluence / 1e-9 erg cm⁻²) × 100: 300 is a typical burst, 760 the brightest on record.
    sizePx: (value) => (value < 0 ? 2.4 : clamp(2.4 + ((value - 200) / 100) * 1.6, 2.4, 12)),
    alpha: (value) => (value < 0 ? 0.6 : clamp(0.6 + (value - 200) / 500, 0.6, 1)),
    labelRank: 6.393,
    labelColor: '#ffc4e6',
    credits: [
      {
        what: 'Gamma-ray bursts: trigger times, positions, durations and fluences (Fermi GBM)',
        source:
          'Fermi GBM Burst Catalog (FERMIGBRST), NASA HEASARC: von Kienlin et al. 2020, ApJ 893, 46; Gruber et al. 2014; von Kienlin et al. 2014; Bhat et al. 2016',
        licence: PUBLIC_DOMAIN,
        url: 'https://heasarc.gsfc.nasa.gov/W3Browse/fermi/fermigbrst.html',
      },
      {
        what: 'Gamma-ray bursts: names, arcsecond positions, redshifts and fluences (Swift)',
        source: 'Swift GRB Table, NASA Goddard Space Flight Center, Neil Gehrels Swift Observatory',
        licence: PUBLIC_DOMAIN,
        url: 'https://swift.gsfc.nasa.gov/archive/grb_table/',
      },
    ],
  },
  {
    id: 'fast-radio-bursts',
    label: 'Fast radio bursts',
    order: 71,
    file: 'sky/transients/frb.json',
    noun: 'sources',
    span: 'CHIME 2018–19 and one of 2020',
    caption:
      '492 sources of millisecond radio flashes from CHIME’s first year (2018–19; northern sky only) and the one burst traced to a magnetar in our Galaxy · size by dispersion measure, a stand-in for distance · positions good to ~0.2°',
    classes: {
      'one-off': { label: 'seen once', color: '#b6ff6a', shape: 'cross' },
      repeater: { label: 'repeater', color: '#f2ff7a', shape: 'ring' },
      galactic: { label: 'Galactic magnetar', color: '#ffffff', shape: 'diamond' },
    },
    sizePx: (value, className) => (className === 'one-off' ? clamp(5 + value / 600, 5, 9) : className === 'repeater' ? 10 : 12),
    labelRank: 6.394,
    labelColor: '#dcffb0',
    credits: [
      {
        what: 'Fast radio bursts: positions, times and dispersion measures',
        source:
          'CHIME/FRB Collaboration (2021), The First CHIME/FRB Fast Radio Burst Catalog, ApJS 257, 59, doi:10.3847/1538-4365/ac33ab; via VizieR J/ApJS/257/59',
        licence: PUBLISHED,
        url: 'https://www.chime-frb.ca/catalog',
      },
      {
        what: 'FRB 20200428 from the magnetar SGR 1935+2154',
        source: 'CHIME/FRB Collaboration (2020), Nature 587, 54, doi:10.1038/s41586-020-2863-y; position from SIMBAD (CDS)',
        licence: 'free use with acknowledgement',
        url: 'https://arxiv.org/abs/2005.10324',
      },
    ],
  },
  {
    id: 'supernovae',
    label: 'Bright supernovae since 1895',
    order: 72,
    file: 'sky/transients/supernovae.json',
    noun: 'supernovae',
    span: 'catalogues end in 2020',
    caption:
      'supernovae in other galaxies that reached magnitude 14, 1895–2020, each from its date on · size by peak (or, where only that was recorded, discovery) magnitude · Ia (white dwarf) · II (massive star) · Ib/c (stripped star) · other · no usable magnitude · SN 1987A and the historic ones are under Sky landmarks',
    classes: {
      Ia: { label: 'Ia', color: '#cfe6ff', shape: 'diamond' },
      II: { label: 'II', color: '#ff9c7a', shape: 'diamond' },
      'Ib/c': { label: 'Ib/c', color: '#ffd97a', shape: 'diamond' },
      other: { label: 'other', color: '#b0b8c4', shape: 'diamond' },
      unmeasured: { label: 'unmeasured', color: '#ffffff', shape: 'diamond' },
    },
    // Magnitude × 10: 8.3 for the brightest here, 14 at the limit; 999 for the two shown by name alone.
    sizePx: (value) => (value >= 999 ? 10 : clamp(15 - ((value - 80) / 60) * 7, 8, 15)),
    labelRank: 6.392,
    labelColor: '#ffe9c9',
    credits: [
      {
        what: 'Supernovae to 2015: positions, types, dates and magnitudes',
        source: 'Asiago Supernova Catalogue, Barbon, Buondì, Cappellaro & Turatto (1999), A&AS 139, 531; as served by NASA HEASARC (ASIAGOSN)',
        licence: PUBLISHED,
        url: 'https://heasarc.gsfc.nasa.gov/W3Browse/all/asiagosn.html',
      },
      {
        what: 'Bright supernovae 2016–2020',
        source:
          'ASAS-SN bright supernova catalogues: Holoien et al. (2017), MNRAS 471, 4966; Holoien et al. (2019), MNRAS 484, 1899; Neumann et al. (2023), MNRAS 520, 4356; via VizieR',
        licence: PUBLISHED,
        url: 'https://vizier.cfa.harvard.edu/viz-bin/VizieR?-source=J/MNRAS/520/4356',
      },
      {
        what: 'Position of SN 2023ixf',
        source: 'SIMBAD astronomical database, CDS Strasbourg (Wenger M. et al. 2000, A&AS 143, 9)',
        licence: 'free use with acknowledgement',
        url: 'https://simbad.cds.unistra.fr/simbad/',
      },
    ],
  },
  {
    id: 'neutrino-alerts',
    label: 'High-energy neutrinos (IceCube)',
    order: 73,
    file: 'sky/transients/neutrinos.json',
    noun: 'neutrinos',
    span: 'IceCat-1, 2011–2023',
    caption:
      '340 single neutrinos above ~100 TeV that are likely from beyond the Galaxy, 2011–2023, each with its 90% rectangle · size by energy · gold and bronze are IceCube’s two alert grades',
    classes: {
      gold: { label: 'gold', color: '#ffd24a', shape: 'square' },
      bronze: { label: 'bronze', color: '#d08a52', shape: 'square' },
    },
    // Energy in TeV: 100 TeV to 7 PeV.
    sizePx: (value) => clamp(5 + Math.log10(Math.max(value, 1) / 100) * 2.6, 5, 10),
    labelRank: 6.395,
    labelColor: '#ffe6a3',
    boxColor: '#c9a15a',
    credits: [
      {
        what: 'IceCube alert-track neutrinos: directions, 90% rectangles, energies',
        source:
          'IceCube Collaboration (2023), IceCat-1: the IceCube Event Catalog of Alert Tracks, Harvard Dataverse V4, doi:10.7910/DVN/SCRUCD; Abbasi et al. 2023, ApJS 269, 25',
        licence: 'CC0 1.0',
        url: 'https://doi.org/10.7910/DVN/SCRUCD',
      },
    ],
  },
  {
    id: 'gw-events',
    label: 'Gravitational-wave events',
    order: 74,
    file: 'sky/transients/gw.json',
    noun: 'detections with a sky map',
    span: 'catalogues to GWTC-5.0 (Jan 2025)',
    caption:
      'mergers heard by LIGO, Virgo and KAGRA, 2015 – Jan 2025 (391 in the catalogues to GWTC-5.0): the dotted patch is where each came from with 90% probability, the ring its most probable direction · only the 37 placed within 150 deg² are drawn - the rest could be anywhere along arcs across the sky · black holes · neutron star + black hole · neutron stars · masses not yet published',
    classes: {
      'black holes': { label: 'black holes', color: '#b58cff', shape: 'ring' },
      'neutron star + black hole': { label: 'neutron star + black hole', color: '#5ad1c8', shape: 'ring' },
      'neutron stars': { label: 'neutron stars', color: '#ffe45a', shape: 'ring' },
      unclassified: { label: 'unclassified', color: '#9aa3b5', shape: 'ring' },
    },
    // The value is the 90% area in deg²: past the limit of what the file holds regions for, no marker.
    sizePx: (value) => (value <= 150 ? 9 : 0),
    labelRank: 6.391,
    labelColor: '#dccbff',
    region: { sizePx: 4, alpha: 0.55 },
    credits: [
      {
        what: 'Gravitational-wave detections: names, times, masses, distances (GWTC-1 to GWTC-5.0)',
        source:
          'LIGO Scientific Collaboration, Virgo Collaboration and KAGRA Collaboration, Gravitational Wave Open Science Center (gwosc.org) and the catalogue releases it lists',
        licence: 'CC BY 4.0',
        url: 'https://gwosc.org/eventapi/',
      },
      {
        what: 'Sky localisations of gravitational-wave events',
        source:
          'LIGO Scientific, Virgo and KAGRA Collaborations: public sky maps on GraceDB (O3, O4) and the GWTC-1 sky-map release, LIGO-P1800381',
        licence: 'public data release of the LIGO-Virgo-KAGRA collaborations (no licence text on the files)',
        url: 'https://gracedb.ligo.org/superevents/public/O4/',
      },
    ],
  },
  {
    id: 'interstellar-directions',
    label: 'Interstellar visitors and wind',
    order: 75,
    file: 'sky/transients/interstellar.json',
    noun: 'directions',
    span: '1I, 2I, 3I and the helium wind',
    caption:
      'where the interstellar objects 1I/ʻOumuamua, 2I/Borisov and 3I/ATLAS came from and are leaving to (asymptotes of their orbits, with speed far from the Sun), and the direction the interstellar gas blows in from - the nose of the heliosphere',
    classes: {
      arrival: { label: 'came from', color: '#7df0ff', shape: 'diamond' },
      departure: { label: 'leaving to', color: '#4fa6b8', shape: 'cross' },
      wind: { label: 'interstellar wind', color: '#ffb36b', shape: 'square' },
      downwind: { label: 'downwind', color: '#b8834f', shape: 'square' },
    },
    sizePx: (_value, className) => (className === 'arrival' || className === 'wind' ? 11 : 8),
    labelRank: 6.385,
    labelColor: '#c9f6ff',
    credits: [
      {
        what: 'Orbits of the interstellar objects 1I, 2I and 3I',
        source: 'JPL Small-Body Database, NASA/JPL Solar System Dynamics; checked against JPL Horizons',
        licence: PUBLIC_DOMAIN,
        url: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html',
      },
      {
        what: 'Direction, speed and temperature of the interstellar helium flow',
        source:
          'Bzowski, M. et al. (2015), Interstellar neutral helium in the heliosphere from IBEX observations. III, ApJS 220, 28, doi:10.1088/0067-0049/220/2/28',
        licence: 'published measurement, cited',
        url: 'https://arxiv.org/abs/1510.04835',
      },
    ],
  },
];

/** The legend bar: the classes' colours side by side. */
export function classLegend(classes: Readonly<Record<string, TransientClass>>): string {
  const styles = Object.values(classes);
  const stops = styles.map((style, i) => `${style.color} ${(i / styles.length) * 100}% ${((i + 1) / styles.length) * 100}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

const transients: LayerDefinition[] = TRANSIENT_SPECS.map((spec) => ({
  id: spec.id,
  label: spec.label,
  section: 'Deep sky',
  order: spec.order,
  legend: classLegend(spec.classes),
  caption: spec.caption,
  credits: spec.credits,
  load: async (context) => (await import('./transients')).createTransientLayer(context, spec),
}));

export default transients;
