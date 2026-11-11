import type { LayerDefinition } from '../types';
import { PROVINCE_LEGEND } from './classes';

export const HASTEROK_CREDIT = {
  what: 'Global geologic provinces and Archean crust (global_gprv and cratons shapefiles)',
  source:
    'Hasterok, D., Halpin, J.A., Collins, A.S., Hand, M., Kreemer, C., Gard, M.G. & Glorie, S. (2022), New maps of global geological provinces and tectonic plates, Earth-Science Reviews 231, 104069, doi:10.1016/j.earscirev.2022.104069; data on Zenodo, doi:10.5281/zenodo.6586972',
  licence: 'CC BY 4.0 (the Zenodo copy)',
  url: 'https://doi.org/10.5281/zenodo.6586972',
} as const;

const geologicProvinces: LayerDefinition = {
  id: 'geologic-provinces',
  label: 'Geologic provinces',
  section: 'Surface',
  order: 64,
  legend: PROVINCE_LEGEND,
  caption:
    'the crust in 921 provinces by what built it, left to right: craton, shield, orogenic belt, accretionary complex, volcanic arc, ' +
    'magmatic province, rift, basin, passive margin, ophiolite, oceanic crust · a line where the kind changes · ' +
    'one compilation’s classes: boundaries are mapped from geology and geophysics, sharper on paper than in the rock',
  credits: [HASTEROK_CREDIT],
  load: async (context) => (await import('./provinces')).createProvincesLayer(context),
};

export default geologicProvinces;
