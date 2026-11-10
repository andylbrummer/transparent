import { describe, it, expect } from 'vitest';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import ulvz, { ULVZ_COLORS } from './layer';
import { megaHasOutline, megaLabelText, ulvzMarkers, ulvzSegments, type MegaUlvz, type UlvzData } from './ulvz';

const CMB_M = EARTH_RADIUS_M - 2_891_000;

const hawaii: MegaUlvz = { name: 'Hawaiian mega-ULVZ', lon: -167.5, lat: 17.5, widthKm: 910, heightKm: 20, dVsPercent: -20, size: null, cite: 'Cottaar & Romanowicz 2012' };
const samoa: MegaUlvz = { name: 'Samoan mega-ULVZ', lon: -166.64, lat: -17.57, widthKm: null, heightKm: 10, dVsPercent: -45, size: '250 × 800 km, 10–15 km high', cite: 'Thorne et al. 2013' };
const galapagos: MegaUlvz = { name: 'Galápagos mega-ULVZ', lon: -105, lat: 2, widthKm: 600, heightKm: 20, dVsPercent: -25, size: null, cite: 'Cottaar et al. 2022' };

const data = (over: Partial<UlvzData> = {}): UlvzData => ({
  depthKm: 2891,
  quantumPerDegree: 100,
  studies: 54,
  points: { yes: [0, 0, 9000, 0], no: [0, 9000], may: [-9000, 0] },
  lines: { yes: [], no: [], may: [] },
  areas: { yes: [], no: [], may: [] },
  mega: [],
  ...over,
});

const lengths = (positions: Float32Array): number[] => {
  const out: number[] = [];
  for (let i = 0; i < positions.length; i += 3) out.push(Math.hypot(positions[i], positions[i + 1], positions[i + 2]));
  return out;
};

describe('ulvzMarkers', () => {
  it('puts every pierce point on the core-mantle boundary, 2,891 km down', () => {
    const markers = ulvzMarkers(data());
    expect(markers).toHaveLength(4);
    for (const marker of markers) expect(marker.altitudeM).toBe(-2_891_000);
  });

  it('draws what was not found first and what was found last, each in its own shape and colour', () => {
    const markers = ulvzMarkers(data());
    expect(markers.map((marker) => marker.shape)).toEqual(['cross', 'ring', 'disc', 'disc']);
    expect(markers.map((marker) => marker.color)).toEqual([ULVZ_COLORS.no, ULVZ_COLORS.may, ULVZ_COLORS.yes, ULVZ_COLORS.yes]);
    expect([markers[0].lon, markers[0].lat]).toEqual([0, 90]);
    expect([markers[3].lon, markers[3].lat]).toEqual([90, 0]);
  });
});

describe('ulvzSegments', () => {
  it('bends a path round the core: 10° is five chords, every end on the boundary', () => {
    const { positions, colors } = ulvzSegments(data({ lines: { yes: [[0, 0, 1000, 0]], no: [], may: [] } }));
    expect(positions).toHaveLength(5 * 6);
    expect(colors).toHaveLength(5 * 6);
    for (const length of lengths(positions)) expect(length).toBeCloseTo(CMB_M, -1);
    // From 0°E on the equator to 10°E.
    expect(positions[0]).toBeCloseTo(CMB_M, -1);
    expect(positions[positions.length - 3]).toBeCloseTo(CMB_M * Math.cos((10 * Math.PI) / 180), -1);
    expect(positions[positions.length - 2]).toBeCloseTo(CMB_M * Math.sin((10 * Math.PI) / 180), -1);
  });

  it('closes an outline, and colours it by what the study found', () => {
    const square = [0, 0, 100, 0, 100, 100, 0, 100];
    const { positions, colors } = ulvzSegments(data({ areas: { yes: [], no: [square], may: [] } }));
    expect(positions).toHaveLength(4 * 6);
    // The last segment ends where the first began.
    expect(Array.from(positions.slice(-3))).toEqual(Array.from(positions.slice(0, 3)));
    expect(colors[0]).toBeCloseTo(((ULVZ_COLORS.no >> 16) & 255) / 255, 6);
    expect(colors[2]).toBeCloseTo((ULVZ_COLORS.no & 255) / 255, 6);
  });

  it('does not choke on a vertex given twice', () => {
    const { positions } = ulvzSegments(data({ areas: { yes: [[0, 0, 0, 0, 100, 0]], no: [], may: [] } }));
    expect(Array.from(positions).every(Number.isFinite)).toBe(true);
  });

  it('rings a mega-ULVZ that has no outline in the data at its stated width, and leaves alone one that has', () => {
    const ringed = ulvzSegments(data({ mega: [galapagos] }));
    expect(ringed.positions).toHaveLength(48 * 6);
    const centre = [Math.cos((2 * Math.PI) / 180) * Math.cos((-105 * Math.PI) / 180), Math.cos((2 * Math.PI) / 180) * Math.sin((-105 * Math.PI) / 180), Math.sin((2 * Math.PI) / 180)];
    for (let i = 0; i < ringed.positions.length; i += 3) {
      const dot = (ringed.positions[i] * centre[0] + ringed.positions[i + 1] * centre[1] + ringed.positions[i + 2] * centre[2]) / CMB_M;
      // 300 km from the centre, along the core.
      expect(Math.acos(dot) * CMB_M).toBeCloseTo(300_000, -3);
    }
    const outline = [-16750 + 700, 1750, -16750, 1750 + 700, -16750 - 700, 1750, -16750, 1750 - 700];
    const withOutline = data({ areas: { yes: [outline], no: [], may: [] }, mega: [hawaii] });
    expect(megaHasOutline(withOutline, hawaii)).toBe(true);
    expect(megaHasOutline(withOutline, galapagos)).toBe(false);
    expect(ulvzSegments(withOutline).positions.length).toBeLessThan(48 * 6);
  });
});

describe('megaLabelText', () => {
  it('gives the size, height and velocity drop the study reports', () => {
    expect(megaLabelText(hawaii)).toBe('Hawaiian mega-ULVZ · ~910 km wide, 20 km high · S waves −20 %');
    expect(megaLabelText(galapagos)).toBe('Galápagos mega-ULVZ · ~600 km wide, 20 km high · S waves −25 %');
  });

  it('uses the paper’s own words where the body is not a circle', () => {
    expect(megaLabelText(samoa)).toBe('Samoan mega-ULVZ · 250 × 800 km, 10–15 km high · S waves −45 %');
  });
});

describe('the ULVZ layer', () => {
  it('is inside the Earth, off until asked for, and says what the three marks mean', () => {
    expect(ulvz.id).toBe('ulvz');
    expect(ulvz.section).toBe('Inside the Earth');
    expect(ulvz.defaultOn).toBeUndefined();
    expect(ulvz.caption).toContain('found one');
    expect(ulvz.caption).toContain('looked and found none');
    expect(ulvz.caption).toContain('empty is unknown, not clear');
  });

  it('credits the compilation and the paper the Galápagos numbers are from', () => {
    expect(ulvz.credits[0].source).toContain('Yu, S. & Garnero, E.J. (2018)');
    expect(ulvz.credits[0].source).toContain('10.5281/zenodo.1064217');
    expect(ulvz.credits[1].source).toContain('Cottaar, S., Martin, C., Li, Z. & Parai, R. (2022)');
  });
});
