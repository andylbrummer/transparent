import type { Credit, LayerDefinition } from '../types';
import type { ImagerySpec } from './imagery';

/**
 * Other maps of the surface, shown in place of Blue Marble on the far side
 * of the planet. One at a time; with all of them off, Blue Marble is back.
 *
 * Legends are the GIBS colour maps the images are drawn with, reduced to
 * nine stops by tools/pipeline/gibs_legends.py.
 */

const GROUP = 'surface-imagery';
const PUBLIC_DOMAIN = 'public domain (U.S. Government work)';
const GIBS_URL = 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api';

const gibs = (what: string, source: string, licence: string = PUBLIC_DOMAIN): Credit => ({
  what,
  source: `${source}; imagery by NASA GIBS (ESDIS)`,
  licence,
  url: GIBS_URL,
});

interface Entry extends Omit<LayerDefinition, 'section' | 'exclusiveGroup' | 'load'> {
  readonly spec: ImagerySpec;
}

const ENTRIES: readonly Entry[] = [
  {
    id: 'surface-true-colour',
    label: 'Satellite view, latest full day',
    order: 10,
    caption: 'true colour from NOAA-20 · each place at ~13:30 local time · polar night is black',
    credits: [gibs('Daily true-colour mosaic (VIIRS corrected reflectance)', 'NASA/NOAA NOAA-20 VIIRS')],
    spec: { product: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', format: 'jpeg', width: 4096, time: 'complete-day' },
  },
  {
    id: 'surface-night-lights',
    label: 'Earth at night',
    order: 20,
    caption: 'Black Marble 2016: cloud-free composite of city lights',
    credits: [gibs('Night lights (Black Marble 2016)', 'NASA Earth Observatory, Suomi NPP VIIRS day/night band')],
    spec: {
      product: 'VIIRS_Black_Marble',
      format: 'jpeg',
      width: 4096,
      time: '2016-01-01',
      deepen: true,
      gain: 3,
      bakedAsset: 'weather/night-lights.jpg',
    },
  },
  {
    id: 'surface-relief',
    label: 'Relief and sea floor',
    order: 30,
    caption: 'shaded relief with ocean depth: ridges, trenches, fracture zones',
    credits: [gibs('Shaded relief and bathymetry (Blue Marble, August 2004)', 'NASA Earth Observatory, MODIS')],
    spec: { product: 'BlueMarble_ShadedRelief_Bathymetry', format: 'jpeg', width: 4096, time: null },
  },
  {
    id: 'surface-sst',
    label: 'Sea surface temperature',
    order: 40,
    legend: 'linear-gradient(to right, #2b001a, #7a0677, #1e124e, #214b9e, #2ea3ef, #78d300, #ffb400, #e03e00, #6b0200)',
    caption: '0 – 32 °C · yesterday, 1 km analysis',
    credits: [gibs('Sea surface temperature (GHRSST Level 4 MUR)', 'NASA JPL MUR MEaSUREs project, GHRSST')],
    spec: { product: 'GHRSST_L4_MUR_Sea_Surface_Temperature', format: 'png', width: 2048, time: 'latest' },
  },
  {
    id: 'surface-sst-anomaly',
    label: 'Sea temperature anomaly',
    order: 41,
    legend: 'linear-gradient(to right, #6b00db, #414be6, #03f8fa, #a4ff91, #c2cab8, #ffde43, #ff7100, #ec004a, #800000)',
    caption: '−3 – +3 °C against the MUR climatology for the day',
    credits: [gibs('Sea surface temperature anomaly (GHRSST Level 4 MUR)', 'NASA JPL MUR MEaSUREs project, GHRSST')],
    spec: { product: 'GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies', format: 'png', width: 2048, time: 'latest' },
  },
  {
    id: 'surface-vegetation',
    label: 'Vegetation',
    order: 50,
    legend: 'linear-gradient(to right, #f1ecec, #e1d2c6, #b4a596, #a18063, #96ba20, #56a101, #2e8000, #006400, #001801)',
    caption: 'NDVI 0 – 1, latest 16-day composite',
    credits: [gibs('Vegetation index (MODIS Terra NDVI, 16-day)', 'NASA MODIS Terra, MOD13Q1')],
    spec: { product: 'MODIS_Terra_L3_NDVI_16Day', format: 'png', width: 2048, time: 'latest' },
  },
  {
    id: 'surface-population',
    label: 'Population density',
    order: 60,
    legend: 'linear-gradient(to right, #fff2d1, #ffe6bb, #fed59a, #fabc60, #fba54a, #fd8d3c, #f35228, #da2122, #bd0026)',
    caption: '1 – 1000+ people per km², 2020',
    credits: [
      gibs(
        'Population density 2020 (Gridded Population of the World v4, UN-adjusted)',
        'Center for International Earth Science Information Network (CIESIN), Columbia University, doi:10.7927/H4HX19NJ',
        'CC BY 4.0'
      ),
    ],
    spec: { product: 'GPW_Population_Density_2020', format: 'png', width: 2048, time: null },
  },
];

const SURFACE_LAYERS: readonly LayerDefinition[] = ENTRIES.map(({ spec, ...definition }) => ({
  ...definition,
  section: 'Surface',
  exclusiveGroup: GROUP,
  load: async (context) => (await import('./imagery')).createImageryLayer(context, definition.id, spec),
}));

export default SURFACE_LAYERS;
