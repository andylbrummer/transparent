/**
 * The all-sky maps: what each shows, how its colours read, whom to credit.
 * Light on purpose - layer.ts imports this eagerly for the panel.
 *
 * The images are baked by tools/pipeline/generate_skymaps.py, which holds
 * the scaling each legend below describes. All are plate carrées in
 * galactic coordinates.
 */

import type { Credit } from '../types';

export interface SkyMapSpec {
  readonly id: string;
  readonly label: string;
  readonly order: number;
  /** Path under app/public/. */
  readonly file: string;
  /** CSS background of the legend bar: the map's own colour ramp. */
  readonly legend: string;
  readonly caption: string;
  /**
   * Share of the image's light added to the view. Maps that are bright
   * over the whole sky (the microwave background) get less, or they would
   * wash out the stars above and the globe below.
   */
  readonly gain: number;
  readonly credits: readonly Credit[];
}

const LAMBDA_LICENCE = 'public (NASA LAMBDA archive), citation requested';
// Black at zero, so a sky with no anisotropy adds no light.
const CMB_LEGEND = 'linear-gradient(90deg, #99e6ff, #1a66ff 25%, #000 50%, #ff4d0d 75%, #ffe666)';
const COBE_CREDIT: Credit = {
  what: 'COBE DMR 4-year sky maps, 53 GHz',
  source: 'COBE Differential Microwave Radiometers (Bennett C.L. et al. 1996, ApJ 464, L1), NASA/GSFC, from LAMBDA',
  licence: 'public domain (NASA)',
  url: 'https://lambda.gsfc.nasa.gov/product/cobe/dmr_overview.html',
};

export const SKY_MAP_SPECS: readonly SkyMapSpec[] = [
  {
    id: 'map-radio-408',
    label: 'Radio, 408 MHz',
    order: 10,
    file: 'sky/maps/radio-408.jpg',
    legend: 'linear-gradient(90deg, #000, #731a00 35%, #ff8c1a 70%, #fff2bf)',
    caption:
      '73 cm radio continuum (Haslam et al. 1982, destriped 2015): cosmic-ray electrons spiralling in the Galaxy’s magnetic field · 11 K → 600 K, logarithmic',
    gain: 0.9,
    credits: [
      {
        what: '408 MHz all-sky radio continuum map',
        source:
          'Haslam C.G.T. et al. 1982, A&AS 47, 1, reprocessed by Remazeilles M. et al. 2015, MNRAS 451, 4311 (Jodrell Bank, Effelsberg, Parkes), from NASA LAMBDA',
        licence: LAMBDA_LICENCE,
        url: 'https://lambda.gsfc.nasa.gov/product/foreground/fg_2014_haslam_408_info.html',
      },
    ],
  },
  {
    id: 'map-hi-21cm',
    label: 'Hydrogen, 21 cm',
    order: 12,
    file: 'sky/maps/hi-21cm.jpg',
    legend: 'linear-gradient(90deg, #000, #0d4080 40%, #33b3d9 75%, #e6ffff)',
    caption:
      'neutral atomic hydrogen from its 21 cm line (HI4PI 2016): the Galaxy’s gas, the Magellanic Clouds and their stream · 6×10¹⁹ → 2×10²² atoms/cm², logarithmic',
    gain: 0.8,
    credits: [
      {
        what: 'Neutral hydrogen column density',
        source: 'HI4PI Collaboration 2016, A&A 594, A116 (Effelsberg EBHIS and Parkes GASS surveys), from NASA LAMBDA',
        licence: LAMBDA_LICENCE,
        url: 'https://lambda.gsfc.nasa.gov/product/foreground/fg_hi4pi_info.html',
      },
    ],
  },
  {
    id: 'map-cmb-cobe',
    label: 'Microwave background: COBE',
    order: 20,
    file: 'sky/maps/cmb-cobe.jpg',
    legend: CMB_LEGEND,
    caption:
      'COBE DMR, 53 GHz, 1989-93, at 10° resolution: the first map of the ripples in the afterglow of the Big Bang · −200 → +200 µK about 2.725 K · the bright band is the Milky Way’s own microwaves',
    gain: 0.55,
    credits: [COBE_CREDIT],
  },
  {
    id: 'map-cmb-wmap',
    label: 'Microwave background: WMAP',
    order: 21,
    file: 'sky/maps/cmb-wmap.jpg',
    legend: CMB_LEGEND,
    caption: 'WMAP nine-year map, 2001-10, at 1° resolution, the Milky Way removed · −300 → +300 µK',
    gain: 0.55,
    credits: [
      {
        what: 'WMAP nine-year Internal Linear Combination map',
        source: 'WMAP Science Team (Bennett C.L. et al. 2013, ApJS 208, 20), NASA, from LAMBDA',
        licence: 'public domain (NASA)',
        url: 'https://lambda.gsfc.nasa.gov/product/wmap/dr5/ilc_map_info.html',
      },
    ],
  },
  {
    id: 'map-cmb-planck',
    label: 'Microwave background: Planck',
    order: 22,
    file: 'sky/maps/cmb-planck.jpg',
    legend: CMB_LEGEND,
    caption:
      'Planck 2018 SMICA map, 2009-13, measured at 5′ and shown at 10′, the Milky Way removed (a faint seam remains along its plane) · −300 → +300 µK',
    gain: 0.55,
    credits: [
      {
        what: 'Planck 2018 SMICA CMB temperature map',
        source:
          'Planck Collaboration 2020, A&A 641, A4. Based on observations obtained with Planck, an ESA science mission with instruments and contributions directly funded by ESA Member States, NASA, and Canada. From the NASA/IPAC Infrared Science Archive',
        licence: 'public (ESA Planck Legacy Archive), acknowledgement required',
        url: 'https://irsa.ipac.caltech.edu/Missions/planck.html',
      },
    ],
  },
  {
    id: 'map-cmb-dipole',
    label: 'Microwave background: our motion',
    order: 23,
    file: 'sky/maps/cmb-dipole.jpg',
    legend: CMB_LEGEND,
    caption:
      'COBE DMR, 53 GHz, with the dipole left in: the sky is 3.36 mK warmer where we are heading (370 km/s toward Leo–Crater) and cooler behind · −3.6 → +3.6 mK',
    gain: 0.3,
    credits: [COBE_CREDIT],
  },
  {
    id: 'map-dust-100um',
    label: 'Dust, far infrared',
    order: 30,
    file: 'sky/maps/dust-100um.jpg',
    legend: 'linear-gradient(90deg, #000, #66140d 35%, #f27326 70%, #fff2cc)',
    caption: 'IRAS at 100 µm (IRIS reprocessing): the glow of interstellar dust at 20 K · 0.6 → 1500 MJy/sr, logarithmic',
    gain: 0.8,
    credits: [
      {
        what: 'IRAS 100 µm all-sky map (IRIS)',
        source: 'Miville-Deschênes M.-A., Lagache G. 2005, ApJS 157, 302 (IRAS: NASA, NIVR, SERC), from NASA LAMBDA',
        licence: LAMBDA_LICENCE,
        url: 'https://lambda.gsfc.nasa.gov/product/foreground/fg_iris_info.html',
      },
    ],
  },
  {
    id: 'map-near-ir',
    label: 'Starlight, near infrared',
    order: 32,
    file: 'sky/maps/near-ir.jpg',
    legend: 'linear-gradient(90deg, #000, #4d6fb3, #e6d9a6, #ff9a4d)',
    caption:
      'COBE DIRBE at 1.25, 2.2 and 3.5 µm shown as blue, green and red: the Galaxy’s stars seen through its dust, edge-on with its central bulge · the blobs are single bright stars in a 0.7° beam',
    gain: 1,
    credits: [
      {
        what: 'COBE DIRBE Zodi-Subtracted Mission Average maps, bands 1-3',
        source: 'COBE Diffuse Infrared Background Experiment (Hauser M.G. et al. 1998, ApJ 508, 25), NASA/GSFC, from LAMBDA',
        licence: 'public domain (NASA)',
        url: 'https://lambda.gsfc.nasa.gov/product/cobe/dirbe_overview.html',
      },
    ],
  },
  {
    id: 'map-h-alpha',
    label: 'Glowing hydrogen, H-alpha',
    order: 34,
    file: 'sky/maps/h-alpha.jpg',
    legend: 'linear-gradient(90deg, #000, #8c0814 45%, #ff4d4d 80%, #ffd9cc)',
    caption:
      'the red light of ionised hydrogen at 656 nm (Finkbeiner 2003, from WHAM, VTSS and SHASSA): nebulae and bubbles blown by hot stars · 0.3 → 500 rayleighs',
    gain: 0.9,
    credits: [
      {
        what: 'Full-sky H-alpha composite',
        source:
          'Finkbeiner D.P. 2003, ApJS 146, 407, from the Wisconsin H-Alpha Mapper (WHAM), the Virginia Tech Spectral-Line Survey (VTSS) and the Southern H-Alpha Sky Survey Atlas (SHASSA), which are supported by the National Science Foundation; from NASA LAMBDA',
        licence: LAMBDA_LICENCE,
        url: 'https://lambda.gsfc.nasa.gov/product/foreground/fg_halpha_info.html',
      },
    ],
  },
  {
    id: 'map-xray-rosat',
    label: 'X-rays (ROSAT)',
    order: 40,
    file: 'sky/maps/xray-rosat.jpg',
    legend: 'linear-gradient(90deg, #000, #e63333, #4de680, #668cff)',
    caption:
      'ROSAT all-sky survey, 1990-91, diffuse X-rays at ¼, ¾ and 1.5 keV shown as red, green and blue: million-degree gas, supernova bubbles, the North Polar Spur · dark arcs were never scanned',
    gain: 0.6,
    credits: [
      {
        what: 'ROSAT All-Sky Survey diffuse X-ray background maps',
        source: 'Snowden S.L. et al. 1997, ApJ 485, 125 (Max-Planck-Institut für extraterrestrische Physik), resampled by NASA SkyView',
        licence: 'use permitted for scientific purposes with reference to Snowden et al. 1997',
        url: 'https://skyview.gsfc.nasa.gov/current/cgi/survey.pl',
      },
    ],
  },
  {
    id: 'map-gamma-fermi',
    label: 'Gamma rays (Fermi)',
    order: 42,
    file: 'sky/maps/gamma-fermi.jpg',
    legend: 'linear-gradient(90deg, #000, #330d73 30%, #bf338c 60%, #ffa64d 85%, #ffffd9)',
    caption:
      'Fermi Large Area Telescope, photons above 1 GeV, 2008-12: cosmic rays striking interstellar gas, with pulsars and blazars as points · logarithmic',
    gain: 0.9,
    credits: [
      {
        what: 'Fermi-LAT all-sky intensity maps, 1-3 and 3-300 GeV',
        source: 'Fermi LAT instrument team, NASA Goddard Space Flight Center, resampled by NASA SkyView',
        licence: 'public domain (NASA)',
        url: 'https://skyview.gsfc.nasa.gov/current/cgi/survey.pl',
      },
    ],
  },
  {
    id: 'map-galaxies-2mass',
    label: 'Galaxy density (2MASS)',
    order: 50,
    file: 'sky/maps/galaxies-2mass.jpg',
    legend: 'linear-gradient(90deg, #000, #1a3373 40%, #8ca6d9 75%, #fffff2)',
    caption:
      'galaxies per square degree among the 547,000 brighter than Ks 13.5 in the 2MASS survey: the nearby cosmic web · 4 → 250 per square degree · empty where the Milky Way hides them, and false counts along its outer plane',
    gain: 1,
    credits: [
      {
        what: '2MASS Extended Source Catalog',
        source:
          'Jarrett T.H. et al. 2000, AJ 119, 2498; Skrutskie M.F. et al. 2006, AJ 131, 1163. The Two Micron All Sky Survey is a joint project of the University of Massachusetts and IPAC/Caltech, funded by NASA and the NSF. From the NASA/IPAC Infrared Science Archive',
        licence: 'public, acknowledgement requested',
        url: 'https://irsa.ipac.caltech.edu/Missions/2mass.html',
      },
    ],
  },
];
