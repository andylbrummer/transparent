import type { LayerDefinition } from '../types';

export const LADDER_COLOR = 0xe6f1ff;

const depthLadder: LayerDefinition = {
  id: 'depth-ladder',
  label: 'Depth ladder',
  section: 'Inside the Earth',
  order: 5,
  legend: `#${LADDER_COLOR.toString(16)}`,
  caption:
    'rings straight down from you, the nearest outermost: 100 km … the core–mantle boundary, the centre, the antipode · a scale, not structures · pressure and density from PREM, a radial average · temperature is an estimate (Anderson 1982): published values for the core differ by many hundreds of kelvin',
  credits: [
    {
      what: 'Pressure and density with depth (Preliminary Reference Earth Model)',
      source: 'Dziewonski, A.M. & Anderson, D.L. (1981), Phys. Earth Planet. Inter. 25, 297–356; table distributed with BurnMan',
      licence: 'facts from the literature',
      url: 'https://github.com/geodynamics/burnman',
    },
    {
      what: 'Temperature with depth',
      source: 'Anderson, O.L. (1982), The Earth’s core and the phase diagram of iron, Phil. Trans. R. Soc. A 306, 21–35; table distributed with BurnMan',
      licence: 'facts from the literature',
      url: 'https://github.com/geodynamics/burnman',
    },
    {
      what: 'Cities, for the place nearest the antipode',
      source: 'Natural Earth',
      licence: 'public domain',
      url: 'https://www.naturalearthdata.com/',
    },
  ],
  load: async (context) => (await import('./ladder')).createDepthLadderLayer(context),
};

export default depthLadder;
