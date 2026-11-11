import type { LayerDefinition } from '../types';
import { ZONES, ZONE_COLORS, ZONE_SHARE } from './zones';

const permafrost: LayerDefinition = {
  id: 'permafrost',
  label: 'Permafrost: ground frozen for years',
  section: 'Surface',
  order: 92,
  legend: `linear-gradient(to right, ${ZONES.map((zone, i) => `${ZONE_COLORS[zone]} ${String(i * 25)}% ${String((i + 1) * 25)}%`).join(', ')})`,
  caption:
    `Northern Hemisphere permafrost zones, modelled from satellite ground temperatures 2000–2016, by the share of the ground frozen: ` +
    ZONES.map((zone) => `${zone} ${ZONE_SHARE[zone]}`).join(' · ') +
    ' · the southern hemisphere’s (Antarctica, the Andes) is not drawn · Greenland’s ice sheet is left out',
  credits: [
    {
      what: 'Permafrost zones, Northern Hemisphere, 2000–2016 (GlobPermafrost, 1 km)',
      source:
        'Obu, J., Westermann, S., Kääb, A. & Bartsch, A. (2018), Ground Temperature Map, 2000–2016, Northern Hemisphere Permafrost, PANGAEA; method: Obu et al. (2019), Earth-Science Reviews 193, 299–316',
      licence: 'CC BY 3.0',
      url: 'https://doi.org/10.1594/PANGAEA.888600',
    },
  ],
  load: async (context) => (await import('./permafrost')).createPermafrostLayer(context),
};

export default permafrost;
