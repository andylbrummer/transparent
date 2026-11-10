import type { LayerDefinition } from '../types';

/** Line colours: muted, so the plate boundaries drawn over the same features keep the eye. */
export const UNDERSEA_LINE_COLORS = {
  /** Trenches and troughs. */
  trench: 0x8f9cff,
  /** Fracture zones. */
  fracture: 0x7fb6d6,
  /** Ridges, rises and seamount chains. */
  ridge: 0xd9c79a,
} as const;

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

const undersea: LayerDefinition = {
  id: 'undersea-features',
  label: 'Seafloor features and names',
  section: 'Surface',
  order: 63,
  legend: `linear-gradient(to right, ${hex(UNDERSEA_LINE_COLORS.trench)} 0% 33%, ${hex(UNDERSEA_LINE_COLORS.fracture)} 33% 67%, ${hex(UNDERSEA_LINE_COLORS.ridge)} 67% 100%)`,
  caption:
    'trenches and troughs · fracture zones · ridges, rises and seamount chains, as the gazetteer draws them · names of the largest of each kind, and ◆ the named deeps with their depth',
  credits: [
    {
      what: 'Undersea feature names, positions and depths',
      source: 'IHO-IOC GEBCO Gazetteer of Undersea Feature Names, www.gebco.net, served by NOAA NCEI',
      licence: 'no stated licence; citation requested, as given',
      url: 'https://www.ngdc.noaa.gov/gazetteer/',
    },
  ],
  load: async (context) => (await import('./undersea')).createUnderseaLayer(context),
};

export default undersea;
