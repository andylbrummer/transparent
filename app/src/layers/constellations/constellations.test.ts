import { describe, it, expect } from 'vitest';
import { ICRS_TO_GALACTIC, applyMat3 } from '@transparent-earth/core';
import { boundarySegments, figureLabels, figureSegments, type ConstellationData } from './constellations';
import { equatorialGrid, greatCircle, gridLabels, pointOnGreatCircle } from './grid';

const DEG = Math.PI / 180;

/** A two-star figure 60° long on the equator, a three-point one, and one boundary of two steps. */
const DATA: ConstellationData = {
  quantumPerDegree: 1000,
  figures: [
    { id: 'Aaa', name: 'Alpha', rank: 2, at: [30000, 10000], lines: [[0, 0, 60000, 0]] },
    {
      id: 'Bbb',
      name: 'Beta',
      rank: 1,
      at: [180000, -45000],
      lines: [
        [180000, -40000, 181000, -41000, 182000, -41000],
        [10000, 80000, 11000, 80000],
      ],
    },
  ],
  boundaries: [[90000, 0, 90000, 1000, 90000, 2000]],
};

function segmentLengthsDeg(segments: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < segments.length; i += 6) {
    const dot = segments[i] * segments[i + 3] + segments[i + 1] * segments[i + 4] + segments[i + 2] * segments[i + 5];
    out.push(Math.acos(Math.min(1, dot)) / DEG);
  }
  return out;
}

describe('figureSegments', () => {
  const segments = figureSegments(DATA);
  const lengths = segmentLengthsDeg(segments);

  it('bends a long line along its great circle in short steps', () => {
    // The 60° line becomes 30 steps of 2°; the short ones stay whole: 30 + 2 + 1.
    expect(lengths).toHaveLength(33);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(2.0001);
    expect(lengths.slice(0, 30).reduce((a, b) => a + b, 0)).toBeCloseTo(60, 3);
  });

  it('starts and ends on the stars', () => {
    expect([segments[0], segments[1], segments[2]]).toEqual([1, 0, 0]);
    const end = 29 * 6 + 3;
    expect(segments[end]).toBeCloseTo(Math.cos(60 * DEG), 6);
    expect(segments[end + 1]).toBeCloseTo(Math.sin(60 * DEG), 6);
  });

  it('never joins one polyline to the next', () => {
    // Nothing spans the 100°+ between the figures.
    expect(Math.max(...lengths)).toBeLessThan(3);
  });
});

describe('boundarySegments', () => {
  it('joins each polyline’s points with chords', () => {
    const lengths = segmentLengthsDeg(boundarySegments(DATA));
    expect(lengths).toHaveLength(2);
    expect(lengths[0]).toBeCloseTo(1, 3);
  });
});

describe('figureLabels', () => {
  it('names each figure at its place, prominent ones first', () => {
    const labels = figureLabels(DATA);
    expect(labels.map((l) => l.text)).toEqual(['Alpha', 'Beta']);
    expect(labels[1].priority).toBeLessThan(labels[0].priority);
    expect(labels[1].position.z).toBeCloseTo(Math.sin(-45 * DEG), 6);
  });
});

describe('the sky grid', () => {
  it('draws closed great circles of unit points', () => {
    const circle = greatCircle([0, 0, 1], [1, 0, 0]);
    const lengths = segmentLengthsDeg(circle);
    expect(lengths.reduce((a, b) => a + b, 0)).toBeCloseTo(360, 2);
    expect([circle[0], circle[1], circle[2]]).toEqual([1, 0, 0]);
    expect(circle[circle.length - 3]).toBeCloseTo(1, 6);
    for (let i = 2; i < circle.length; i += 3) expect(circle[i]).toBeCloseTo(0, 6);
  });

  it('measures longitude along a plane from its origin, the way the pole turns', () => {
    const quarter = pointOnGreatCircle([0, 0, 1], [1, 0, 0], 90);
    expect(quarter[0]).toBeCloseTo(0, 9);
    expect(quarter[1]).toBeCloseTo(1, 9);
  });

  it('keeps the hour circles off the poles', () => {
    const grid = equatorialGrid();
    let maxZ = 0;
    for (let i = 2; i < grid.length; i += 3) maxZ = Math.max(maxZ, Math.abs(grid[i]));
    expect(maxZ).toBeCloseTo(Math.sin(80 * DEG), 6);
  });

  it('labels the galactic centre in Sagittarius, at l = 0, b = 0', () => {
    const labels = gridLabels();
    const centre = labels.find((l) => l.text === 'Galactic centre');
    expect(centre).toBeDefined();
    if (!centre) return;
    // Sgr A*: RA 266.42°, Dec −29.01°.
    expect(Math.atan2(centre.position.y, centre.position.x) / DEG + 360).toBeCloseTo(266.4, 0);
    expect(Math.asin(centre.position.z) / DEG).toBeCloseTo(-28.9, 0);
    const galactic = applyMat3(ICRS_TO_GALACTIC, [centre.position.x, centre.position.y, centre.position.z]);
    expect(galactic[0]).toBeCloseTo(1, 9);
  });

  it('marks every second hour but 0h and 12h, where the equinoxes are named', () => {
    const texts = gridLabels().map((l) => l.text);
    expect(texts).toContain('2h');
    expect(texts).toContain('22h');
    expect(texts).not.toContain('0h');
    expect(texts).toContain('March equinox');
    expect(texts.filter((t) => t === 'Ecliptic')).toHaveLength(4);
  });
});
