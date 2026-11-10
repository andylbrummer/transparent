import type { Credit, LayerDefinition } from '../types';
import type { OverlaySpec } from './overlay';

/**
 * Measurements of the surface and the air, draped over whatever map of the
 * surface is showing: ice, snow, fire, haze, gases, water, lightning. One
 * at a time. They are NASA GIBS images, like the surface-imagery layers,
 * but laid over the base map instead of replacing it.
 *
 * Product identifiers, date ranges and legends come from
 * tools/pipeline/gibs_overlay_legends.py, which reads the GIBS
 * capabilities and each product's colour map: the legends below are those
 * colour maps reduced to nine stops, and the ranges are theirs.
 */

const GROUP = 'earth-overlays';
const NASA = 'NASA data, free and open (no restrictions; cite the source)';
const GIBS_URL = 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api';

const gibs = (what: string, source: string, licence: string = NASA): Credit => ({
  what,
  source: `${source}; imagery by NASA GIBS (ESDIS)`,
  licence,
  url: GIBS_URL,
});

/** The colour GIBS draws a fire detection in. */
export const FIRE_COLOR = '#f02828';

interface Entry extends Omit<LayerDefinition, 'section' | 'exclusiveGroup' | 'load'> {
  readonly spec: OverlaySpec;
}

export const OVERLAY_ENTRIES: readonly Entry[] = [
  {
    id: 'overlay-sea-ice',
    label: 'Sea ice concentration',
    order: 82,
    legend: 'linear-gradient(to right, #111111, #c600c6, #5c00ff, #0094ff, #00d98e, #44c100, #ffd400, #ff0909, #ffffff)',
    caption: '0 – 100 % of the sea covered by ice, both poles · daily analysis, 25 km',
    credits: [
      gibs(
        'Sea ice concentration (GHRSST Level 4 MUR 0.25°)',
        'JPL MUR MEaSUREs Project, GHRSST Level 4 MUR 0.25deg Global Foundation Sea Surface Temperature Analysis (v4.2), NASA/JPL PO.DAAC, doi:10.5067/GHM25-4FJ42'
      ),
    ],
    spec: { product: 'GHRSST_L4_MUR25_Sea_Ice_Concentration', time: 'latest', cadence: 'daily' },
  },
  {
    id: 'overlay-snow',
    label: 'Snow cover',
    order: 83,
    legend: 'linear-gradient(to right, #8cadd9, #ffffff)',
    caption:
      '1 – 100 % snow cover, mean of the latest whole month · GIBS’s yellow-to-red palette redrawn blue to white, in its five steps · ice sheets count as snow',
    credits: [
      gibs(
        'Snow cover, monthly average (MODIS Terra, MOD10CM)',
        'MODIS/Terra Snow Cover Monthly L3 Global 0.05Deg CMG V061 (MOD10CM), NASA National Snow and Ice Data Center DAAC, doi:10.5067/MODIS/MOD10CM.061'
      ),
    ],
    spec: { product: 'MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct', time: 'latest', cadence: 'monthly', shade: 'snow' },
  },
  {
    id: 'overlay-fires',
    label: 'Fires and thermal anomalies',
    order: 84,
    legend: FIRE_COLOR,
    caption: 'every hot spot NOAA-20 saw in the latest full day, day and night passes, 375 m pixels · fires, gas flares, volcanoes',
    credits: [
      gibs(
        'Active fires and thermal anomalies (VIIRS 375 m, NOAA-20)',
        'NASA LANCE / FIRMS, VIIRS NOAA-20 (JPSS-1) 375m I-Band Active Fire Product NRT (VJ114IMGT_NRT), doi:10.5067/FIRMS/VIIRS/VJ114IMGT_NRT.002'
      ),
    ],
    spec: { product: 'VIIRS_NOAA20_Thermal_Anomalies_375m_All', time: 'complete-day', cadence: 'daily', shade: 'points', width: 4096 },
  },
  {
    id: 'overlay-aerosol',
    label: 'Haze, dust and smoke (aerosol)',
    order: 85,
    legend: 'linear-gradient(to right, #ffffe5, #fee392, #fec654, #fea937, #f98d23, #ec7114, #d65808, #bb4402, #662506)',
    caption: 'aerosol optical thickness at 550 nm, 0 – 0.9 and over · mean of the latest month in the MERRA-2 reanalysis (a model fed with observations)',
    credits: [
      gibs(
        'Total aerosol optical thickness, monthly mean (MERRA-2)',
        'NASA Global Modeling and Assimilation Office (GMAO), MERRA-2 tavgM_2d_aer_Nx V5.12.4 (M2TMNXAER), NASA GES DISC, doi:10.5067/FH9A0MLJPC7N'
      ),
    ],
    spec: { product: 'MERRA2_Total_Aerosol_Optical_Thickness_550nm_Extinction_Monthly', time: 'latest', cadence: 'monthly', shade: 'fade-low' },
  },
  {
    id: 'overlay-no2',
    label: 'Nitrogen dioxide (traffic, industry)',
    order: 86,
    legend: 'linear-gradient(to right, #fffcc7, #ffea81, #ffd65d, #ffbe42, #ff9b2a, #ff7c20, #ff5417, #f82c10, #7f000e)',
    caption: 'NO₂ in the lower atmosphere, 0 – 2×10¹⁶ molecules/cm² and over · ~13:30 local time · two days before the newest, which are still filling in · blank where retrieval failed',
    credits: [
      gibs(
        'Tropospheric nitrogen dioxide column (TROPOMI, Sentinel-5P)',
        'Copernicus Sentinel data processed by ESA and KNMI, Sentinel-5P TROPOMI Tropospheric NO2 1-Orbit L2 (S5P_L2__NO2____HiR), NASA GES DISC, doi:10.5270/S5P-9bnp8q8',
        'Copernicus Sentinel data: free, full and open access with attribution (contains modified Copernicus Sentinel data)'
      ),
    ],
    spec: { product: 'TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column', time: 'latest', lagDays: 2, cadence: 'daily', shade: 'fade-low' },
  },
  {
    id: 'overlay-carbon-monoxide',
    label: 'Carbon monoxide (burning)',
    order: 87,
    legend: 'linear-gradient(to right, #fffdda, #fffdc1, #fdea89, #fd9c50, #eb4b3a, #b3231b, #9e2482, #8436f7, #2f054a)',
    caption: 'CO at 500 hPa (~5.5 km up), 0 – 350 ppbv and over · mean of the latest month, daytime passes',
    credits: [
      gibs(
        'Carbon monoxide at 500 hPa, monthly mean (AIRS, Aqua)',
        'AIRS Science Team / J. Teixeira, AIRS/Aqua L3 Monthly Standard Physical Retrieval (AIRS-only) 1°×1° V006 (AIRS3STM), NASA GES DISC, doi:10.5067/Aqua/AIRS/DATA321'
      ),
    ],
    spec: { product: 'AIRS_L3_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Monthly_Day', time: 'latest', cadence: 'monthly', shade: 'fade-low' },
  },
  {
    id: 'overlay-ozone',
    label: 'Ozone layer',
    order: 88,
    legend: 'linear-gradient(to right, #5e4fa2, #5bb5aa, #90d2a4, #c5e89e, #edee93, #fdd783, #fdae61, #f57748, #9e0142)',
    caption: 'total ozone column, 100 – 500 Dobson units · under 220 is the ozone hole (Antarctic spring) · the day before the newest: that one is still filling in',
    credits: [
      gibs(
        'Total column ozone (OMPS Nadir Mapper, Suomi NPP)',
        'G. Jaross, OMPS-NPP L2 NM Ozone (O3) Total Column swath orbital V2 (OMPS_NPP_NMTO3_L2; near-real-time stream NMTO3NRT), NASA GES DISC, doi:10.5067/0WF4HAAZ0VHK'
      ),
    ],
    spec: { product: 'OMPS_Ozone_Total_Column', time: 'latest', lagDays: 1, cadence: 'daily' },
  },
  {
    id: 'overlay-water-vapour',
    label: 'Water vapour',
    order: 89,
    legend: 'linear-gradient(to right, #ffffe5, #e0f3a8, #c3e698, #9fd788, #78c679, #4eb164, #31964f, #197c3f, #004529)',
    caption: 'water in the whole column of air, 0 – 70 kg/m² and over · mean of the latest month in the MERRA-2 reanalysis (a model fed with observations)',
    credits: [
      gibs(
        'Total precipitable water vapour, monthly mean (MERRA-2)',
        'NASA Global Modeling and Assimilation Office (GMAO), MERRA-2 instM_2d_int_Nx V5.12.4 (M2IMNXINT), NASA GES DISC, doi:10.5067/KVTU1A8BWFSJ'
      ),
    ],
    spec: { product: 'MERRA2_Total_Precipitable_Water_Vapor_Monthly', time: 'latest', cadence: 'monthly', shade: 'fade-low' },
  },
  {
    id: 'overlay-soil-moisture',
    label: 'Soil moisture',
    order: 90,
    legend: 'linear-gradient(to right, #ffa200, #ffee00, #7dbe00, #009e3e, #00ffff, #0047ff, #0000bb, #101064, #505050)',
    caption: 'water in the top 5 cm of soil, 0 – 0.7 m³/m³ · SMAP radiometer merged into a land model, 12:00 UTC of the day',
    credits: [
      gibs(
        'Surface soil moisture (SMAP Level 4)',
        'SMAP L4 Global 3-hourly 9 km EASE-Grid Surface and Root Zone Soil Moisture Analysis Update V008 (SPL4SMAU), NASA National Snow and Ice Data Center DAAC, doi:10.5067/02LGW4DGJYRX'
      ),
    ],
    spec: { product: 'SMAP_L4_Analyzed_Surface_Soil_Moisture', time: 'latest', cadence: 'daily' },
  },
  {
    id: 'overlay-lightning',
    label: 'Lightning (1995–2013 average)',
    order: 91,
    legend: 'linear-gradient(to right, #8e85a6, #966bb3, #b846bd, #c92294, #d6064e, #e03637, #eb986c, #f7dfa3, #f8fade)',
    caption: '0 – 150 flashes per km² per year and over · seen from orbit by LIS (TRMM) and OTD, 0.5° · blank where none was seen or beyond ±75° latitude',
    credits: [
      gibs(
        'Lightning flash rate climatology (LIS/OTD HRFC)',
        'LIS/OTD 0.5 Degree High Resolution Full Climatology (HRFC) V2.3.2015, NASA Global Hydrometeorology Resource Center DAAC, doi:10.5067/LIS/LIS-OTD/DATA302'
      ),
    ],
    spec: {
      product: 'LIS_High_Resolution_Full_Climatology_Combined_Flash_Rate_Climatology',
      time: null,
      cadence: 'fixed',
      bakedAsset: 'geo/overlay-lightning.png',
    },
  },
];

const OVERLAY_LAYERS: readonly LayerDefinition[] = OVERLAY_ENTRIES.map(({ spec, ...definition }) => ({
  ...definition,
  section: 'Surface',
  exclusiveGroup: GROUP,
  load: async (context) => (await import('./overlay')).createOverlayLayer(context, definition.id, spec),
}));

export default OVERLAY_LAYERS;
