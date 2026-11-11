import type { LayerDefinition } from '../types';
import { PROGRAMME_COLORS } from './holes';

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

const drillHoles: LayerDefinition = {
  id: 'drill-holes',
  label: 'Ocean drilling: 4,216 cored holes',
  section: 'Surface',
  order: 67,
  legend: `linear-gradient(to right, ${hex(PROGRAMME_COLORS.dsdp)} 0% 33%, ${hex(PROGRAMME_COLORS.odp)} 33% 67%, ${hex(PROGRAMME_COLORS.iodp)} 67% 100%)`,
  caption:
    'every hole cored into the seabed by scientific ocean drilling since 1968, coloured by the programme that first drilled it: ' +
    'DSDP 1968–83 · ODP 1985–2003 · IODP since 2003 · ○ named: holes reopened on three or more cruises · ' +
    'not sized by depth: the table’s depths are not one measure',
  credits: [
    {
      what: 'Drilled holes of DSDP, ODP and IODP: positions and cruises',
      source: 'International Ocean Discovery Program, Drilled Holes table (kml.iodp.org), with DSDP and ODP holes',
      licence: 'no licence stated; publicly funded programmes that publish their data openly',
      url: 'https://kml.iodp.org/Drilled_Holes.csv',
    },
  ],
  load: async (context) => (await import('./drill-holes')).createDrillHoleLayer(context),
};

export default drillHoles;
