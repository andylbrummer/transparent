import type { LayerDefinition } from '../types';

/**
 * Stories and clips (spec/guides.md §8.1): hotspots with no guide playing. Its data is public/media/hotspots.json and
 * the files beside it, checked by mediaProblems in scripts/guide-folder.ts; each clip's credit is listed here too, as
 * a test holds it to.
 */
const mediaHotspots: LayerDefinition = {
  id: 'media-hotspots',
  label: 'Stories and clips',
  section: 'Labels',
  caption: '▶ marks a picture or a recording about what is there: tap it, press Enter at it, or in the viewer look at it',
  credits: [
    {
      what: 'Diagram of earthquake wave paths through the Earth',
      source: 'U.S. Geological Survey, The Interior of the Earth (E. C. Robertson, 1966), figure 2; redrawn as SVG by SEWilco, Wikimedia Commons',
      licence: 'public domain',
      url: 'https://pubs.usgs.gov/gip/interior/',
    },
  ],
  load: async (context) => (await import('./hotspots')).createMediaHotspotsLayer(context),
};

export default mediaHotspots;
