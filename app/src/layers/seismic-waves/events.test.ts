import { describe, it, expect } from 'vitest';
import type { EventRecord } from '@transparent-earth/core';
import type { NotableQuakeData } from '../quakes-notable/notable';
import type { BakedEvent } from './data';
import { DEEP_PRESETS, LATEST_KEY, PRESETS, latestLargeEvent, originText, presetEvents } from './events';

// As in app/public/geo/quakes-notable.json and seismic-waves.json (USGS ComCat).
const NOTABLE: NotableQuakeData = {
  events: [
    { id: 'official20110311054624120_30', time: '2011-03-11T05:46:24.120Z', lon: 142.373, lat: 38.297, depthKm: 29, mag: 9.1, name: 'Great Tohoku, Japan 2011' },
    { id: 'us6000jllz', time: '2023-02-06T01:17:34.342Z', lon: 37.0143, lat: 37.2256, depthKm: 10, mag: 7.8, name: 'Pazarcik, Kahramanmaras 2023' },
    { id: 'official19640328033616_30', time: '1964-03-28T03:36:16.000Z', lon: -147.339, lat: 60.908, depthKm: 25, mag: 9.2, name: 'Prince William Sound, Alaska 1964' },
  ],
};
const DEEP: BakedEvent[] = [
  { id: 'usb000h4jh', time: '2013-05-24T05:44:48.980Z', lon: 153.221, lat: 54.892, depthKm: 598.1, mag: 8.3, name: 'Sea of Okhotsk 2013' },
];

describe('presetEvents', () => {
  const events = presetEvents(NOTABLE, DEEP);

  it('offers the presets found in the data, by key, and leaves out the missing ones', () => {
    expect(events.map((event) => event.key)).toEqual(['tohoku2011', 'turkiye2023', 'okhotsk2013']);
  });

  it('takes the hypocentre from the data, not from here', () => {
    const tohoku = events[0];
    expect([tohoku.lat, tohoku.lon, tohoku.depthKm, tohoku.mag]).toEqual([38.297, 142.373, 29, 9.1]);
    expect(tohoku.time).toBe('2011-03-11T05:46:24.120Z');
  });

  it('names the depth only where depth is the point', () => {
    expect(events[0].label).toBe('Tōhoku, Japan 2011 · M9.1');
    expect(events[2].label).toBe('Sea of Okhotsk 2013 · M8.3 · 598 km deep');
  });

  it('covers every preset the spec names, and a deep one', () => {
    expect(PRESETS.map((preset) => preset.key)).toEqual(['tohoku2011', 'sumatra2004', 'valdivia1960', 'sanfrancisco1906', 'turkiye2023']);
    expect(DEEP_PRESETS.length).toBeGreaterThan(0);
  });
});

describe('latestLargeEvent', () => {
  const feed: EventRecord[] = [
    { id: 'a', time: '2026-11-01T00:00:00.000Z', lat: 1, lon: 2, depthKm: 10, mag: 6.4, name: '10 km S of Somewhere' },
    { id: 'b', time: '2026-11-05T00:00:00.000Z', lat: 3, lon: 4, depthKm: 35, mag: 6.1, name: '20 km N of Elsewhere' },
    { id: 'c', time: '2026-11-08T00:00:00.000Z', lat: 5, lon: 6, depthKm: 12, mag: 5.9, name: 'too small' },
    { id: 'd', time: '2026-11-09T12:00:00.000Z', lat: 7, lon: 8, depthKm: 20, mag: 7.0, name: 'not yet' },
  ];

  it('picks the latest M6+ that has happened by the app clock', () => {
    const latest = latestLargeEvent(feed, Date.parse('2026-11-09T00:00:00Z'));
    expect(latest?.id).toBe('b');
    expect(latest?.key).toBe(LATEST_KEY);
    expect(latest?.label).toBe('Latest M6+: M6.1 20 km N of Elsewhere (5 Nov)');
    expect(latestLargeEvent(feed, Date.parse('2026-11-10T00:00:00Z'))?.id).toBe('d');
  });

  it('offers nothing when the feed has no large earthquake', () => {
    expect(latestLargeEvent(feed.slice(2, 3), Date.parse('2026-11-10T00:00:00Z'))).toBeNull();
    expect(latestLargeEvent(feed, Date.parse('2026-10-01T00:00:00Z'))).toBeNull();
  });
});

describe('originText', () => {
  it('states the real origin time in UTC', () => {
    expect(originText('2011-03-11T05:46:24.120Z')).toBe('11 Mar 2011, 05:46:24 UTC');
  });
});
