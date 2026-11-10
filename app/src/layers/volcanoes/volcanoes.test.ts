import { describe, it, expect } from 'vitest';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { RECENCY_CLASSES, eruptionSizePx, formatYear, recencyClass, recencyLegend } from './classes';
import volcanoLayers from './layer';
import {
  eruptionLabelText,
  eruptionLabels,
  volcanoLabelText,
  volcanoLabels,
  volcanoMarkers,
  type GreatEruption,
  type VolcanoData,
} from './volcanoes';

/** Real rows of app/public/geo/volcanoes.json (GVP, read 2026-11-09): Etna, Fujisan, Tambora, a volcano with no dated eruption. */
const DATA: VolcanoData = {
  asOf: '2026-11-09',
  quantumPerDegree: 1000,
  missingYear: -99999,
  types: ['Stratovolcano(es)', 'Stratovolcano', 'Volcanic field'],
  holocene: {
    lon: [14999, 138728, 118000, 6850],
    lat: [37748, 35361, -8250, 50170],
    elevationM: [3357, 3776, 2850, 600],
    type: [0, 1, 1, 2],
    name: ['Etna', 'Fujisan', 'Tambora', 'Undated Field'],
    lastYear: [2026, 1708, 1967, -99999],
  },
  pleistocene: { lon: [25880], lat: [46130], elevationM: [1289], type: [2], name: ['South Harghita Mountains'] },
  eruptions: [],
};

const TAMBORA: GreatEruption = { name: 'Tambora', lon: 118, lat: -8.25, startYear: 1812, endYear: 1815, vei: 7, yearUncertainty: null };
const SANTORINI: GreatEruption = { name: 'Santorini', lon: 25.396, lat: 36.404, startYear: -1610, endYear: null, vei: 7, yearUncertainty: 14 };
const PINATUBO: GreatEruption = { name: 'Pinatubo', lon: 120.35, lat: 15.13, startYear: 1991, endYear: 1991, vei: 6, yearUncertainty: null };

describe('recencyClass', () => {
  it('judges "recent" in the year the data were read, not today', () => {
    expect(recencyClass(2026, 2026).key).toBe('recent');
    expect(recencyClass(2025, 2026).key).toBe('recent');
    expect(recencyClass(2024, 2026).key).toBe('since1900');
    expect(recencyClass(1900, 2026).key).toBe('since1900');
    expect(recencyClass(1899, 2026).key).toBe('historic');
    expect(recencyClass(1, 2026).key).toBe('historic');
    expect(recencyClass(-8300, 2026).key).toBe('holocene');
    expect(recencyClass(null, 2026).key).toBe('holocene');
  });

  it('draws the more recently active larger, and gives the legend a band per class', () => {
    for (let i = 1; i < RECENCY_CLASSES.length; i++) {
      expect(RECENCY_CLASSES[i].sizePx).toBeLessThan(RECENCY_CLASSES[i - 1].sizePx);
    }
    expect(recencyLegend()).toContain('#fff2a8 0% 20%');
    expect(recencyLegend()).toContain('#8a7a76 80% 100%');
  });
});

describe('volcanoMarkers', () => {
  const markers = volcanoMarkers(DATA);

  it('draws a triangle per volcano, the recently active last and so on top', () => {
    expect(markers).toHaveLength(5);
    expect(markers.every((m) => m.shape === 'triangle')).toBe(true);
    expect(markers[0].color).toBe(RECENCY_CLASSES[4].color);
    const etna = markers[markers.length - 1];
    expect(etna.color).toBe(RECENCY_CLASSES[0].color);
    expect(etna.lon).toBeCloseTo(14.999, 6);
    expect(etna.lat).toBeCloseTo(37.748, 6);
  });
});

describe('volcano labels', () => {
  it('carry the last eruption and the summit height', () => {
    expect(volcanoLabelText('Etna', 2026, 3357)).toBe('▲ Etna · 2026 · 3,357 m');
    expect(volcanoLabelText('West Eifel Volcanic Field', -8300, 600)).toBe('▲ West Eifel Volcanic Field · 8300 BCE · 600 m');
    expect(volcanoLabelText('Undated', null, 1200)).toBe('▲ Undated · 1,200 m');
  });

  it('put the recently active in their own group and rank the rest by date, leaving out the undated', () => {
    const [recent, others] = volcanoLabels(DATA);
    expect(recent.map((l) => l.text)).toEqual(['▲ Etna · 2026 · 3,357 m']);
    expect(others.map((l) => l.text)).toEqual(['▲ Tambora · 1967 · 2,850 m', '▲ Fujisan · 1708 · 3,776 m']);
    expect(recent[0].position.length()).toBeCloseTo(EARTH_RADIUS_M, 0);
  });
});

describe('great eruptions', () => {
  it('are labelled with their years and index', () => {
    expect(eruptionLabelText(TAMBORA)).toBe('Tambora 1812–1815 · VEI 7');
    expect(eruptionLabelText(SANTORINI)).toBe('Santorini ~1610 BCE · VEI 7');
    expect(eruptionLabelText(PINATUBO)).toBe('Pinatubo 1991 · VEI 6');
    expect(formatYear(-4350)).toBe('4350 BCE');
  });

  it('rank the larger first and, of equals, the more recent', () => {
    const labels = eruptionLabels([PINATUBO, SANTORINI, TAMBORA]);
    const ordered = [...labels].sort((a, b) => a.priority - b.priority).map((l) => l.text.split(' ')[0]);
    expect(ordered).toEqual(['Tambora', 'Santorini', 'Pinatubo']);
    expect(eruptionSizePx(7)).toBeGreaterThan(eruptionSizePx(6));
  });
});

describe('the volcano layers', () => {
  it('are surface layers, off until asked for, crediting the Global Volcanism Program', () => {
    expect(volcanoLayers.map((l) => l.id)).toEqual(['volcanoes', 'eruptions-great']);
    for (const layer of volcanoLayers) {
      expect(layer.section).toBe('Surface');
      expect(layer.defaultOn).toBeUndefined();
      expect(layer.credits[0].source).toContain('Global Volcanism Program');
    }
    expect(volcanoLayers[0].caption).toContain('a snapshot, not a live feed');
  });
});
