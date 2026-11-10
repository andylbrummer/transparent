import { describe, it, expect } from 'vitest';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import undersea, { UNDERSEA_LINE_COLORS } from './layer';
import { FEATURED_PER_KIND, underseaLabelText, underseaLabels, type UnderseaData, type UnderseaFeature } from './undersea';

/** Real rows of app/public/geo/undersea.json (GEBCO gazetteer). */
const MARIANA: UnderseaFeature = { name: 'Mariana Trench', kind: 'trench', lon: 147.834, lat: 16.98, sizeKm: 2052 };
const ALEUTIAN: UnderseaFeature = { name: 'Aleutian Trench', kind: 'trench', lon: -167.38, lat: 52.06, sizeKm: 1784, maxDepthM: 7679 };
const CHALLENGER: UnderseaFeature = { name: 'Challenger Deep', kind: 'deep', lon: 142.592, lat: 11.373, sizeKm: 0, maxDepthM: 10920 };
const TAISHO: UnderseaFeature = { name: 'Taisho Seamount', kind: 'seamount', lon: 171.833, lat: 33.75, sizeKm: 60, maxDepthM: 5490, reliefM: 4758 };
const MAR: UnderseaFeature = { name: 'Mid-Atlantic Ridge', kind: 'ridge', lon: -21.474, lat: -0.319, sizeKm: 15614 };

describe('underseaLabelText', () => {
  it('gives a depth to deeps and trenches that have one, and marks the deeps', () => {
    expect(underseaLabelText(MARIANA)).toBe('Mariana Trench');
    expect(underseaLabelText(ALEUTIAN)).toBe('Aleutian Trench · 7,679 m');
    expect(underseaLabelText(CHALLENGER)).toBe('◆ Challenger Deep · 10,920 m');
  });

  it('does not pass off the depth of a seamount’s foot as the mountain’s', () => {
    expect(underseaLabelText(TAISHO)).toBe('Taisho Seamount');
  });
});

describe('underseaLabels', () => {
  const ridges: UnderseaFeature[] = Array.from({ length: FEATURED_PER_KIND.ridge + 3 }, (_unused, i) => ({
    ...MAR,
    name: `Ridge ${i}`,
    sizeKm: 5000 - i,
  }));
  const data: UnderseaData = {
    quantumPerDegree: 100,
    features: [MARIANA, CHALLENGER, ...ridges, TAISHO],
    lines: { trench: [], fracture: [], ridge: [] },
  };
  const [featured, others] = underseaLabels(data);

  it('features the first of each kind up to its allowance and leaves the rest for a closer look', () => {
    expect(featured).toHaveLength(2 + FEATURED_PER_KIND.ridge);
    expect(others.map((l) => l.text)).toEqual([
      `Ridge ${FEATURED_PER_KIND.ridge}`,
      `Ridge ${FEATURED_PER_KIND.ridge + 1}`,
      `Ridge ${FEATURED_PER_KIND.ridge + 2}`,
      'Taisho Seamount',
    ]);
  });

  it('ranks the Challenger Deep ahead of everything and long features ahead of short', () => {
    const first = [...featured].sort((a, b) => a.priority - b.priority).map((l) => l.text);
    expect(first[0]).toBe('◆ Challenger Deep · 10,920 m');
    expect(first[1]).toBe('Ridge 0');
    expect(first.indexOf('Mariana Trench')).toBeGreaterThan(first.indexOf(`Ridge ${FEATURED_PER_KIND.ridge - 1}`));
    expect(featured[0].position.length()).toBeCloseTo(EARTH_RADIUS_M, 0);
  });
});

describe('the undersea layer', () => {
  it('is a surface layer, off until asked for, crediting the gazetteer', () => {
    expect(undersea.id).toBe('undersea-features');
    expect(undersea.section).toBe('Surface');
    expect(undersea.defaultOn).toBeUndefined();
    expect(undersea.credits[0].source).toContain('GEBCO Gazetteer of Undersea Feature Names');
    for (const color of Object.values(UNDERSEA_LINE_COLORS)) expect(undersea.legend).toContain(color.toString(16));
  });
});
