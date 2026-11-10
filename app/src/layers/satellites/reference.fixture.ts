// Written by tools/pipeline/generate_satellite_fixture.py - do not edit.
// Reference: python sgp4 2.27 (Vallado's SGP4, WGS72 constants) with TEME -> Earth-fixed by GMST (IAU 1982),
// WGS84 geodetic coordinates, and azimuth/elevation from Austin (30.27, -97.74, 0 km), no refraction.
// The ISS is also given as JPL Horizons has it (object -125544) at the same instant.

export const REFERENCE_TIME = '2026-11-09T18:00:00Z';
export const REFERENCE_OBSERVER = { lat: 30.27, lon: -97.74 };

export const REFERENCE_SATELLITES = [
  {
    "name": "ISS (ZARYA)",
    "norad": 25544,
    "csv": "OBJECT_NAME,NORAD_CAT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT\nISS (ZARYA),25544,2026-11-09T11:10:18.771456,15.49275323,.00072858,51.6321,301.1765,6.3021,353.8058,.16254709E-3,.8605E-4,0\n",
    "temeKm": [
      -927.916407,
      6116.912801,
      2816.654434
    ],
    "temeKmS": [
      -5.51283547,
      1.521720736,
      -5.093948009
    ],
    "lat": 24.614297,
    "lon": 139.703751,
    "heightKm": 423.4299,
    "azimuth": 308.37533,
    "elevation": -49.64534,
    "rangeKm": 10272.6947
  },
  {
    "name": "GPS BIIR-5  (PRN 22)",
    "norad": 26407,
    "csv": "OBJECT_NAME,NORAD_CAT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT\nGPS BIIR-5  (PRN 22),26407,2026-11-09T14:24:35.100864,2.00558963,.01151969,54.8261,209.3927,305.0246,212.0827,0,.25E-6,0\n",
    "temeKm": [
      -5089.686137,
      14445.403436,
      -21422.07905
    ],
    "temeKmS": [
      -3.492433087,
      -1.725863378,
      -0.29824145
    ],
    "lat": -54.480955,
    "lon": 150.4873,
    "heightKm": 19970.0234,
    "azimuth": 222.32194,
    "elevation": -46.26333,
    "rangeKm": 30556.0881
  },
  {
    "name": "GOES 19",
    "norad": 60133,
    "csv": "OBJECT_NAME,NORAD_CAT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT\nGOES 19,60133,2026-11-09T13:58:16.896000,1.00274455,.00007527,0.0022,53.1723,243.1312,246.8617,0,-.24E-5,0\n",
    "temeKm": [
      -18663.770402,
      -37805.565848,
      3.016614
    ],
    "temeKmS": [
      2.757277772,
      -1.361003552,
      -0.000850886
    ],
    "lat": 0.004104,
    "lon": -75.196607,
    "heightKm": 35783.423,
    "azimuth": 140.49848,
    "elevation": 47.00998,
    "rangeKm": 37266.8698
  }
];

export const HORIZONS_ISS = {
  "azimuth": 308.37854,
  "elevation": -49.64541,
  "rangeKm": 10272.360221209548,
  "icrfKm": [
    -883.656064867302,
    6122.451370467677,
    2818.886670848153
  ]
};
