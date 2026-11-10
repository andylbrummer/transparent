import { describe, it, expect } from 'vitest';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { SLAB_DEPTH_GLSL } from '../slabs/slabs';
import { BODY_CONTOUR_KM, BODY_FRAGMENT_SHADER, parseBody, provinceLabels, provinceName, type BodyPiece } from './bodies';
import tomography from './layer';
import { BODY_BASE_KM, BODY_COLORS, BODY_THRESHOLD_PERCENT, BODY_TOP_KM, DVS_RAMP, TOMOGRAPHY_BODIES_ID } from './shells';

const QUANTUM = 32767;

/** tomography-bodies-slow.bin as the bake writes it: counts, int16 positions, uint16 indices. */
function bodyFile(vertices: readonly (readonly [number, number, number])[], indices: readonly number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(8 + vertices.length * 6 + indices.length * 2);
  const view = new DataView(buffer);
  view.setUint32(0, vertices.length, true);
  view.setUint32(4, indices.length, true);
  vertices.flat().forEach((value, i) => view.setInt16(8 + 2 * i, value, true));
  indices.forEach((value, i) => view.setUint16(8 + vertices.length * 6 + 2 * i, value, true));
  return buffer;
}

describe('parseBody', () => {
  const corners = [
    [QUANTUM, 0, 0],
    [0, -QUANTUM, 0],
    [0, 0, 16384],
    [-100, 200, -300],
  ] as const;

  it('scales the quantised positions to metres from the Earth’s centre', () => {
    const body = parseBody(bodyFile(corners, [0, 1, 2, 0, 2, 3]), QUANTUM);
    expect(body.positions).toHaveLength(12);
    expect(body.positions[0]).toBeCloseTo(EARTH_RADIUS_M, -1);
    expect(body.positions[4]).toBeCloseTo(-EARTH_RADIUS_M, -1);
    expect(body.positions[8]).toBeCloseTo((EARTH_RADIUS_M * 16384) / QUANTUM, -1);
    expect(Array.from(body.positions.slice(9))).toEqual([-100, 200, -300].map((v) => Math.fround((v * EARTH_RADIUS_M) / QUANTUM)));
    expect(Array.from(body.indices)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('keeps the winding: the triangles face outward as the bake wound them', () => {
    const body = parseBody(bodyFile(corners, [2, 1, 0]), QUANTUM);
    expect(Array.from(body.indices)).toEqual([2, 1, 0]);
  });

  it('refuses a file that is cut short, rather than drawing part of a body', () => {
    const whole = bodyFile(corners, [0, 1, 2]);
    expect(() => parseBody(whole.slice(0, whole.byteLength - 2), QUANTUM)).toThrow(/cut short/);
    expect(() => parseBody(new ArrayBuffer(4), QUANTUM)).toThrow(/cut short/);
  });

  it('refuses an index that is no vertex, and indices that are not whole triangles', () => {
    expect(() => parseBody(bodyFile(corners, [0, 1, 4]), QUANTUM)).toThrow(/index 4 of 4 vertices/);
    expect(() => parseBody(bodyFile(corners, [0, 1, 2, 3]), QUANTUM)).toThrow(/whole triangles/);
  });
});

describe('the names of the slow provinces', () => {
  const piece = (lon: number, lat: number, volumeMillionKm3: number): BodyPiece => ({
    volumeMillionKm3,
    centre: { lon, lat, depthKm: 2400 },
    topKm: 1049,
    bottomKm: 2892,
  });

  it('are African and Pacific by where the piece is centred, and nothing elsewhere', () => {
    expect(provinceName(16.6, -17.4)).toBe('African LLSVP');
    expect(provinceName(-158.8, -13.6)).toBe('Pacific LLSVP');
    expect(provinceName(175, -5)).toBe('Pacific LLSVP');
    expect(provinceName(100, 0)).toBeNull();
    expect(provinceName(-70, -10)).toBeNull();
    expect(provinceName(20, 70)).toBeNull();
  });

  it('go on the two biggest pieces only, at their mean depth, and say it is a contour of a model', () => {
    const labels = provinceLabels([piece(16.6, -17.4, 11162), piece(-158.8, -13.6, 9845), piece(-142.6, -4.4, 255)], 0.8);
    expect(labels.map((label) => label.text)).toEqual(['African LLSVP · −0.8 % contour (model)', 'Pacific LLSVP · −0.8 % contour (model)']);
    expect(labels[0].position.length()).toBeCloseTo(EARTH_RADIUS_M - 2_400_000, -2);
    // Under southern Africa: east of Greenwich, south of the equator.
    expect(labels[0].position.x).toBeGreaterThan(0);
    expect(labels[0].position.y).toBeGreaterThan(0);
    expect(labels[0].position.z).toBeLessThan(0);
  });

  it('leave out a big piece that is under neither', () => {
    expect(provinceLabels([piece(100, 0, 5000), piece(16.6, -17.4, 4000)], 0.8).map((label) => label.text)).toEqual([
      'African LLSVP · −0.8 % contour (model)',
    ]);
  });
});

describe('the tomography body layer', () => {
  const layer = tomography.find((candidate) => candidate.id === TOMOGRAPHY_BODIES_ID)!;

  it('is one switch inside the Earth, off until asked for, and not exclusive with the slices', () => {
    expect(layer.id).toBe('tomography-slow-bodies');
    expect(layer.section).toBe('Inside the Earth');
    expect(layer.defaultOn).toBeUndefined();
    expect(layer.exclusiveGroup).toBeUndefined();
  });

  it('says the threshold, the depth range, and that the shape is a contour of a model', () => {
    expect(layer.caption).toContain(`−${BODY_THRESHOLD_PERCENT} % or more slow`);
    expect(layer.caption).toContain('from 1,050 km');
    expect(layer.caption).toContain('2,891 km');
    expect(layer.caption).toContain(`a line every ${BODY_CONTOUR_KM} km of depth`);
    expect(layer.caption).toContain('a contour of a smoothed model (SEMUCB-WM1)');
    expect(layer.credits[0].source).toContain('French, S.W. & Romanowicz, B.A. (2014)');
  });

  it('is the slices’ slow red on the core, lighter at the top', () => {
    const channels = (hex: number): [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
    const sum = (hex: number): number => channels(hex).reduce((a, b) => a + b, 0);
    expect(BODY_COLORS.base).toBe(DVS_RAMP[0][1]);
    expect(channels(BODY_COLORS.base)[0]).toBeGreaterThan(channels(BODY_COLORS.base)[2] + 100);
    expect(sum(BODY_COLORS.top)).toBeGreaterThan(sum(BODY_COLORS.base) + 150);
  });

  it('draws depth between the bake’s limits, contoured, and writes the slabs’ depth so the two hide each other', () => {
    expect(BODY_FRAGMENT_SHADER).toContain(`(${BODY_BASE_KM.toFixed(1)} - depthKm) / ${(BODY_BASE_KM - BODY_TOP_KM).toFixed(1)}`);
    expect(BODY_FRAGMENT_SHADER).toContain(`float interval = ${BODY_CONTOUR_KM.toFixed(1)};`);
    expect(BODY_FRAGMENT_SHADER).toContain(SLAB_DEPTH_GLSL);
    expect(BODY_FRAGMENT_SHADER).toContain('gl_FragDepth = slabDepth(vViewDistance)');
  });
});
