import type { Credit, LayerDefinition } from '../types';
import { TEMPERATURE_RAMP, WIND_10M_RAMP, WIND_250HPA_RAMP, rampGradient } from './ramps';

const PUBLIC_DOMAIN = 'public domain (U.S. Government work)';

const GFS_CREDIT: Credit = {
  what: 'Wind and air temperature (GFS 1° forecast, GRIB2 by byte range)',
  source: 'NOAA/NCEP Global Forecast System, via the NOAA Open Data Dissemination programme',
  licence: PUBLIC_DOMAIN,
  url: 'https://registry.opendata.aws/noaa-gfs-bdp-pds/',
};

/**
 * Rain and snow ramps of the GIBS colour map GPM_Precipitation_Rate, side
 * by side; the stops are printed by tools/pipeline/gibs_legends.py.
 */
const PRECIPITATION_LEGEND =
  'linear-gradient(to right, #00764e 0%, #009c14 8%, #45c000 16%, #cfe700 24%, #ffa00c 32%, #ff4233 40%, #da0000 48%, #8a0000 56%, #330000 64%, ' +
  '#0c1018 64%, #0c1018 66%, #b1faee 66%, #66abdc 75%, #3e40d4 83%, #790ac7 92%, #3a0330 100%)';

const WEATHER_LAYERS: readonly LayerDefinition[] = [
  {
    id: 'clouds',
    label: 'Clouds (infrared)',
    section: 'Weather',
    order: 10,
    legend: 'linear-gradient(to right, #1b2b44, #ffffff)',
    caption: 'whiter = colder, higher cloud tops · hourly · fades out toward the poles',
    credits: [
      {
        what: 'Global infrared cloud mosaic (GMGSI longwave)',
        source: 'NOAA/NESDIS Global Mosaic of Geostationary Satellite Imagery, served by NOAA nowCOAST',
        licence: PUBLIC_DOMAIN,
        url: 'https://nowcoast.noaa.gov/',
      },
    ],
    load: async (context) => (await import('./shells')).createCloudLayer(context),
  },
  {
    id: 'precipitation',
    label: 'Rain and snow',
    section: 'Weather',
    order: 20,
    legend: PRECIPITATION_LEGEND,
    caption: 'rain, then snow: 0.1 → 53+ mm/h, log scale · half-hourly, ~5 h behind',
    credits: [
      {
        what: 'Precipitation rate (GPM IMERG half-hourly, early run)',
        source: 'NASA Global Precipitation Measurement mission, IMERG; imagery by NASA GIBS',
        licence: PUBLIC_DOMAIN,
        url: 'https://gpm.nasa.gov/data/imerg',
      },
    ],
    load: async (context) => (await import('./shells')).createPrecipitationLayer(context),
  },
  {
    id: 'wind-10m',
    label: 'Wind at the surface (10 m)',
    section: 'Weather',
    order: 30,
    exclusiveGroup: 'wind',
    legend: rampGradient(WIND_10M_RAMP),
    caption: '0 – 34 m/s · trails run 24,000× faster than the air',
    credits: [GFS_CREDIT],
    load: async (context) => (await import('./wind')).createWindLayer(context, 'wind-10m'),
  },
  {
    id: 'wind-250hpa',
    label: 'Jet stream (250 hPa, ~10 km)',
    section: 'Weather',
    order: 31,
    exclusiveGroup: 'wind',
    legend: rampGradient(WIND_250HPA_RAMP),
    caption: '0 – 110 m/s · trails run 7,000× faster than the air',
    credits: [GFS_CREDIT],
    load: async (context) => (await import('./wind')).createWindLayer(context, 'wind-250hpa'),
  },
  {
    id: 'air-temperature',
    label: 'Air temperature (2 m)',
    section: 'Weather',
    order: 40,
    legend: rampGradient(TEMPERATURE_RAMP),
    caption: '−45 – 48 °C · GFS forecast for now',
    credits: [GFS_CREDIT],
    load: async (context) => (await import('./shells')).createTemperatureLayer(context),
  },
  {
    id: 'day-night',
    label: 'Day and night',
    section: 'Weather',
    order: 50,
    legend: 'linear-gradient(to right, #6f93b8 0%, #6f93b8 38%, #0a0d18 62%, #0a0d18 80%, #ffd89a 90%, #0a0d18 100%)',
    caption: 'night falls from sunset to the end of nautical twilight · city lights of 2016',
    credits: [
      {
        what: 'Night lights (Black Marble 2016, VIIRS day/night band)',
        source: 'NASA Earth Observatory / NOAA NGDC, Suomi NPP VIIRS; imagery by NASA GIBS',
        licence: PUBLIC_DOMAIN,
        url: 'https://earthobservatory.nasa.gov/features/NightLights',
      },
    ],
    load: async (context) => (await import('./shells')).createNightSideLayer(context),
  },
];

export default WEATHER_LAYERS;
