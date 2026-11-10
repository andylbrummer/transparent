import { describe, it, expect } from 'vitest';
import { notableLabelText, notableLabels, notableMarkers, notableRingSizePx, type NotableQuakeData } from './notable';

/** Three rows of quakes-notable.json, as ComCat gives them (event ids below). */
const DATA: NotableQuakeData = {
  events: [
    // official19060418131226300_12
    { id: 'official19060418131226300_12', time: '1906-04-18T13:12:26.300Z', lon: -122.55, lat: 37.75, depthKm: 11.7, mag: 7.9, name: 'San Francisco, California 1906' },
    // official19600522191120_30
    { id: 'official19600522191120_30', time: '1960-05-22T19:11:20.000Z', lon: -73.407, lat: -38.143, depthKm: 25, mag: 9.5, name: 'Great Chilean 1960' },
    // official20110311054624120_30
    { id: 'official20110311054624120_30', time: '2011-03-11T05:46:24.120Z', lon: 142.373, lat: 38.297, depthKm: 29, mag: 9.1, name: 'Great Tohoku, Japan 2011' },
  ],
};

describe('notable earthquakes', () => {
  it('labels with magnitude, name, year and depth', () => {
    expect(notableLabelText(DATA.events[1])).toBe('M9.5 Great Chilean 1960 · 25 km');
    expect(notableLabelText(DATA.events[0])).toBe('M7.9 San Francisco, California 1906 · 12 km');
  });

  it('places each label at the hypocentre: Valdivia 1960', () => {
    const labels = notableLabels(DATA, Date.parse('2026-01-01T00:00:00Z'));
    expect(labels).toHaveLength(3);
    const valdivia = labels.find((l) => l.text.includes('1960'));
    // Worked outside the app (Python) for lon −73.407, lat −38.143, 25 km down on the 6371 km sphere.
    expect(valdivia?.position.x).toBeCloseTo(1425271.9, 0);
    expect(valdivia?.position.y).toBeCloseTo(-4783113.8, 0);
    expect(valdivia?.position.z).toBeCloseTo(-3919456.4, 0);
  });

  it('ranks the greatest first', () => {
    const labels = notableLabels(DATA, Date.parse('2026-01-01T00:00:00Z'));
    const order = [...labels].sort((a, b) => a.priority - b.priority).map((l) => l.text.slice(0, 4));
    expect(order).toEqual(['M9.5', 'M9.1', 'M7.9']);
  });

  it('names only what has happened by the app clock', () => {
    expect(notableLabels(DATA, Date.parse('1962-01-01T00:00:00Z')).map((l) => l.text.slice(0, 4))).toEqual(['M7.9', 'M9.5']);
    expect(notableLabels(DATA, Date.parse('1900-01-01T00:00:00Z'))).toEqual([]);
  });

  it('hands the markers origin times before 1970 as negative epoch ms', () => {
    const markers = notableMarkers(DATA);
    expect(markers[1]).toEqual({ lon: -73.407, lat: -38.143, depthKm: 25, mag: 9.5, timeMs: Date.parse('1960-05-22T19:11:20Z') });
    expect(markers[1].timeMs).toBeLessThan(0);
  });

  it('rings them larger than the catalogue dots, by magnitude', () => {
    expect(notableRingSizePx(7.8)).toBeGreaterThan(12);
    expect(notableRingSizePx(9.5)).toBeGreaterThan(notableRingSizePx(9.1));
    expect(notableRingSizePx(9.5)).toBeLessThan(34);
  });
});
