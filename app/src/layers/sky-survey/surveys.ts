/**
 * The surveys offered, each as its HiPS: where its tiles are served from
 * (cross-origin requests allowed), the orders it has, and how its pixel
 * values are turned into light on the app's dark sky.
 *
 * `floor` and `gain` are drawing choices: the level taken as empty sky
 * (survey images are not black between the stars) and the stretch above
 * it. Everything else is from each survey's own `properties` file, read
 * on 2026-11-10.
 */

import type { Credit } from '../types';

export interface SurveySpec {
  readonly id: string;
  readonly label: string;
  readonly order: number;
  readonly caption: string;
  /** Tile servers, tried in turn when one stops answering. */
  readonly bases: readonly string[];
  readonly extension: 'jpg' | 'png';
  readonly minOrder: number;
  readonly maxOrder: number;
  readonly frame: 'equatorial' | 'galactic';
  readonly floor: number;
  readonly gain: number;
  readonly credits: readonly Credit[];
  /**
   * For a survey of scattered patches: its name in sky/closeups.json. Only
   * tiles touching a patch are asked for, the patches are marked, and the
   * survey is drawn over whichever whole-sky picture is on rather than
   * instead of it.
   */
  readonly coverage?: string;
}

const ESA_TILES: Credit = {
  what: 'Tile service (HiPS)',
  source: 'ESASky, ESAC Science Data Centre, European Space Agency; HiPS format by the Centre de Données astronomiques de Strasbourg',
  licence: 'free use with acknowledgement',
  url: 'https://sky.esa.int/',
};

export const SURVEYS: readonly SurveySpec[] = [
  {
    id: 'survey-dss',
    label: 'Photographed sky (DSS2)',
    order: 10,
    caption: 'the whole sky from photographic plates, 1970s–1990s, red and blue · zoom in: galaxies and nebulae are pictures · loaded live as you look',
    bases: ['https://cdn.skies.esac.esa.int/DSSColor', 'https://alasky.cds.unistra.fr/DSS/DSSColor'],
    extension: 'jpg',
    minOrder: 0,
    maxOrder: 9,
    frame: 'equatorial',
    floor: 0.07,
    gain: 1.25,
    credits: [
      {
        what: 'Digitized Sky Survey 2, colour composition (Palomar and UK Schmidt plates)',
        source:
          'The Digitized Sky Surveys were produced at the Space Telescope Science Institute under U.S. Government grant NAG W-2166; coloured and cut into HiPS by CDS, Strasbourg',
        licence: 'copyright of the plate-owning institutions (STScI/AURA, Caltech, AAO, ROE); use with acknowledgement, see STScI’s terms',
        url: 'https://archive.stsci.edu/dss/copyright.html',
      },
      ESA_TILES,
    ],
  },
  {
    id: 'survey-2mass',
    label: 'Near-infrared sky (2MASS)',
    order: 11,
    caption: 'the whole sky at 1.2, 1.7 and 2.2 µm, 1997–2001: light that passes the dust, so the Galaxy’s centre and bulge show · loaded live as you look',
    bases: ['https://cdn.skies.esac.esa.int/2MASSColor', 'https://alasky.cds.unistra.fr/2MASS/Color'],
    extension: 'jpg',
    minOrder: 0,
    maxOrder: 9,
    frame: 'equatorial',
    floor: 0.03,
    gain: 2.0,
    credits: [
      {
        what: 'Two Micron All Sky Survey, J-H-K colour composition',
        source:
          '2MASS, a joint project of the University of Massachusetts and IPAC/Caltech, funded by NASA and the NSF (Skrutskie et al. 2006); coloured and cut into HiPS by CDS, Strasbourg',
        licence: 'survey data public domain with acknowledgement; the HiPS is ODbL-1.0 (CNRS/Unistra)',
        url: 'https://www.ipac.caltech.edu/2mass/',
      },
      ESA_TILES,
    ],
  },
  {
    id: 'survey-wise',
    label: 'Mid-infrared sky (WISE)',
    order: 12,
    caption: 'the whole sky at 3.4, 4.6 and 22 µm, 2010: warm dust glows red, stars blue · loaded live as you look',
    bases: ['https://cdn.skies.esac.esa.int/AllWISEColor', 'https://alasky.cds.unistra.fr/AllWISE/RGB-W4-W2-W1'],
    extension: 'jpg',
    minOrder: 0,
    maxOrder: 8,
    frame: 'equatorial',
    floor: 0.05,
    gain: 1.2,
    credits: [
      {
        what: 'AllWISE colour composition (W4 red, W2 green, W1 blue)',
        source:
          'Wide-field Infrared Survey Explorer, a joint project of the University of California, Los Angeles, and JPL/Caltech, funded by NASA (Wright et al. 2010); cut into HiPS by CDS, Strasbourg',
        licence: 'public domain with acknowledgement',
        url: 'https://wise2.ipac.caltech.edu/docs/release/allsky/',
      },
      ESA_TILES,
    ],
  },
  {
    id: 'survey-xray-bat',
    label: 'Hard X-ray sky (Swift-BAT)',
    order: 13,
    caption: 'the whole sky at 14–195 keV over 70 months: red the softest band, blue the hardest · every dot is a black hole, neutron star or active galaxy · loaded live as you look',
    bases: ['https://cdn.skies.esac.esa.int/swift_bat_flux'],
    extension: 'png',
    minOrder: 0,
    maxOrder: 6,
    frame: 'equatorial',
    floor: 0.22,
    gain: 1.6,
    credits: [
      {
        what: 'Swift-BAT 70-month hard X-ray survey image (14–24, 24–50, 50–194 keV as red, green, blue)',
        source: 'Swift-BAT team, NASA Goddard Space Flight Center (Baumgartner et al. 2013, ApJS 207:19)',
        licence: 'public; acknowledgement requested',
        url: 'https://swift.gsfc.nasa.gov/sdc/swift_acknowledge.html',
      },
      ESA_TILES,
    ],
  },
  {
    id: 'survey-xray-xmm',
    label: 'X-ray pictures (XMM-Newton)',
    order: 14,
    caption: 'every field XMM-Newton has pointed its cameras at, 0.2–12 keV: 13% of the sky, black elsewhere · zoom in on a galaxy, cluster or remnant · loaded live as you look',
    bases: ['https://esdchips.esac.esa.int/XMM-Newton/EPIC-RGB'],
    extension: 'jpg',
    minOrder: 0,
    maxOrder: 7,
    frame: 'equatorial',
    floor: 0.12,
    gain: 1.5,
    credits: [
      {
        what: 'XMM-Newton EPIC images, colour composition',
        source: 'European Space Agency, XMM-Newton Science Archive, ESAC Science Data Centre',
        licence: 'no stated licence on the tiles; ESA asks for the credit ESA/XMM-Newton',
        url: 'https://www.cosmos.esa.int/web/xmm-newton/xsa',
      },
      ESA_TILES,
    ],
  },
  {
    id: 'survey-jwst',
    label: 'Webb close-ups (NIRCam)',
    order: 15,
    caption:
      'every patch Webb’s near-infrared camera has imaged, 0.6–5 µm, about two square degrees in all · rings mark them: zoom into one · drawn over the sky map that is on · loaded live as you look',
    // The CDN, not skies.esac.esa.int: that host sends no CORS header with a 404, so an empty tile reads as a failure.
    bases: ['https://cdn.skies.esac.esa.int/JWST/NIRCam_Imaging'],
    extension: 'png',
    // Order 3 and coarser tiles are not served (404); the patches are too small to see at those scales anyway.
    minOrder: 4,
    // The survey goes to order 15; at the narrowest view (0.2°) a phone screen wants order 9 or 10.
    maxOrder: 11,
    frame: 'equatorial',
    floor: 0,
    // A dark field of small galaxies: at the scales a screen reaches, most are a few pixels, averaged down.
    gain: 2,
    coverage: 'jwst',
    credits: [
      {
        what: 'JWST NIRCam images, all public observations since the 2022 Early Release Observations',
        source: 'NASA/ESA/CSA James Webb Space Telescope; original data from the European JWST Archive (eJWST) at ESA/ESAC',
        licence: 'no stated licence on the tiles; public archive data, the eJWST acknowledgement asked for is given here',
        url: 'https://ejwst.esac.esa.int/',
      },
      ESA_TILES,
    ],
  },
];
