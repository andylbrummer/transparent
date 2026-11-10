import type { Credit, LayerDefinition } from '../types';
import { GREAT_ERUPTION_COLOR, RECENCY_CLASSES, recencyLegend } from './classes';

const GVP: Credit = {
  what: 'Volcanoes (type, height, last eruption) and Holocene eruptions of VEI 6 and above',
  source:
    'Global Volcanism Program (2026), [Database] Volcanoes of the World (v. 5.4.0; 7 Aug 2026), distributed by Smithsonian Institution, compiled by Venzke, E., doi:10.5479/si.GVP.VOTW5-2026.5.4',
  licence: 'non-commercial use with citation (Smithsonian terms of use)',
  url: 'https://volcano.si.edu/gvp_votw.cfm',
};

const volcanoes: readonly LayerDefinition[] = [
  {
    id: 'volcanoes',
    label: 'Volcanoes by last eruption',
    section: 'Surface',
    order: 60,
    legend: recencyLegend(),
    caption: `▲ ${RECENCY_CLASSES.map((c) => c.label).join(' · ')} · 2,666 volcanoes; names carry the last eruption's year and the summit height · a snapshot, not a live feed`,
    credits: [GVP],
    load: async (context) => (await import('./volcanoes')).createVolcanoLayer(context),
  },
  {
    id: 'eruptions-great',
    label: 'Greatest eruptions (VEI 6+)',
    section: 'Surface',
    order: 61,
    legend: `#${GREAT_ERUPTION_COLOR.toString(16)}`,
    caption: '✦ every eruption of the last 12,000 years that threw out 10 km³ or more (VEI 6) · the larger star is VEI 7, 100 km³',
    credits: [GVP],
    load: async (context) => (await import('./volcanoes')).createGreatEruptionLayer(context),
  },
];

export default volcanoes;
