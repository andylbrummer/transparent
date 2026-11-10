import type { LayerDefinition } from '../types';

const meteorShowers: LayerDefinition = {
  id: 'meteor-showers',
  label: 'Meteor shower radiants',
  section: 'Near space',
  order: 55,
  caption:
    'where each of the year’s 37 showers streams from · named, larger and brighter while active on the shown date, with the date of maximum and the usual hourly rate under a dark sky (ZHR) · radiant shown where it is at maximum',
  credits: [
    {
      what: 'Meteor showers: radiants, activity periods, maxima and rates',
      source: 'International Meteor Organization, 2026 Meteor Shower Calendar (ed. J. Rendtel), Working List of Visual Meteor Showers',
      licence: 'no stated licence; figures credited to the IMO',
      url: 'https://www.imo.net/resources/calendar/',
    },
  ],
  load: async (context) => (await import('./showers')).createMeteorShowersLayer(context),
};

export default meteorShowers;
