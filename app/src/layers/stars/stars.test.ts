import { describe, it, expect } from 'vitest';
import { buildStarBuffers, starLabels, type StarData } from './stars';

/** Sirius, Vega, a named 4th-magnitude star and a faint one without colour. */
const DATA: StarData = {
  quantumPerDegree: 1000,
  bvMissing: -999,
  ra: [101283, 279237, 44565, 0],
  dec: [-16725, 38786, -40305, 90000],
  mag: [-144, 3, 420, 690],
  bv: [1, 0, 13, -999],
  names: [
    [0, 'Sirius'],
    [1, 'Vega'],
    [2, 'Faintname'],
  ],
};

describe('buildStarBuffers', () => {
  const buffers = buildStarBuffers(DATA);

  it('places each star at its unit ICRS direction', () => {
    for (let i = 0; i < 4; i++) {
      const [x, y, z] = buffers.directions.subarray(i * 3, i * 3 + 3);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    }
    // Declination +90°: the celestial pole.
    expect(buffers.directions[11]).toBeCloseTo(1, 6);
    // Sirius: RA 101.283° is in the second quadrant, south of the equator.
    expect(buffers.directions[0]).toBeLessThan(0);
    expect(buffers.directions[1]).toBeGreaterThan(0);
    expect(buffers.directions[2]).toBeCloseTo(Math.sin((-16.725 * Math.PI) / 180), 6);
  });

  it('draws the brighter star larger and the faint one dimmer', () => {
    expect(buffers.sizes[0]).toBeGreaterThan(buffers.sizes[1]);
    expect(buffers.alphas[3]).toBeLessThan(buffers.alphas[0]);
  });

  it('colours a star with no B−V near white', () => {
    const [r, g, b] = buffers.colors.subarray(9, 12);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.2);
  });
});

describe('starLabels', () => {
  it('names only the bright stars, brightest first by priority', () => {
    const labels = starLabels(DATA);
    expect(labels.map((l) => l.text)).toEqual(['Sirius', 'Vega']);
    expect(labels[0].priority).toBeLessThan(labels[1].priority);
  });
});
