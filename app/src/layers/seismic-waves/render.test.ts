import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { loadBakedWaves } from './baked.testdata';
import { nearestSliceIndex } from './data';
import { RING_STYLE, buildFrontBuffers, rayWeights, shadowEdges, shadowZones, sourceFrame } from './render';

const data = loadBakedWaves();
const { manifest } = data;
const surface = data.slices[0];

describe('buildFrontBuffers', () => {
  const segments = 8;
  const buffers = buildFrontBuffers(manifest, 'P', segments);
  const branches = manifest.branches.filter((branch) => branch.family === 'P');
  const rays = branches.reduce((sum, branch) => sum + branch.count, 0);

  it('gives every ray of the family a ring of vertices about the axis', () => {
    expect(buffers.positions.length).toBe(rays * (segments + 1) * 3);
    const seen = new Set<number>();
    for (let i = 0; i < buffers.positions.length; i += 3) {
      seen.add(buffers.positions[i]);
      expect(buffers.positions[i + 1]).toBeGreaterThanOrEqual(0);
      expect(buffers.positions[i + 1]).toBeLessThanOrEqual(2 * Math.PI + 1e-6);
    }
    expect(seen.size).toBe(rays);
    expect(Math.min(...seen)).toBe(branches[0].start);
  });

  it('never joins rays of different branches: there the front itself tears', () => {
    const branchOf = (vertex: number): number => buffers.branches[vertex * 3];
    const rayOf = (vertex: number): number => buffers.positions[vertex * 3];
    for (let i = 0; i < buffers.indices.length; i += 3) {
      const [a, b, c] = buffers.indices.subarray(i, i + 3);
      expect(branchOf(a)).toBe(branchOf(b));
      expect(branchOf(a)).toBe(branchOf(c));
      // Neighbouring rays only.
      expect(Math.max(rayOf(a), rayOf(b), rayOf(c)) - Math.min(rayOf(a), rayOf(b), rayOf(c))).toBe(1);
    }
    const quads = branches.reduce((sum, branch) => sum + (branch.count - 1) * segments, 0);
    expect(buffers.indices.length).toBe(quads * 6);
  });

  it('tells the S that strikes the core where to stop, in metres', () => {
    const s = buildFrontBuffers(manifest, 'S', segments);
    const floors = new Set<number>();
    for (let i = 2; i < s.branches.length; i += 3) floors.add(s.branches[i]);
    expect([...floors].sort((a, b) => a - b)).toEqual([0, manifest.cmbRadiusKm * 1000]);
  });
});

describe('rayWeights', () => {
  const weights = rayWeights(manifest, data.slices[nearestSliceIndex(data, 600)]);

  it('shares the take-off sphere out among the rays', () => {
    // The sum of sin(i) di over all take-off angles, 0 to 180 degrees, is 2 - less the sliver PKiKP would fill.
    for (const [family, from, to] of [
      ['P', manifest.branches[0].start, manifest.branches[3].start + manifest.branches[3].count],
      ['S', manifest.branches[4].start, manifest.rays],
    ] as const) {
      let sum = 0;
      for (let i = from; i < to; i++) sum += weights[i * 2];
      expect(sum, family).toBeGreaterThan(1.9);
      expect(sum, family).toBeLessThan(2.1);
    }
  });

  it('carries each ray take-off angle for the graticule, and nothing for rays a depth lacks', () => {
    const upgoing = manifest.branches.find((branch) => branch.phase === 'p')!;
    expect(weights[(upgoing.start + upgoing.count - 1) * 2 + 1]).toBeCloseTo(180, 3);
    const none = rayWeights(manifest, surface);
    expect(none[upgoing.start * 2]).toBe(0);
    expect(none[upgoing.start * 2 + 1]).toBe(0);
  });
});

describe('sourceFrame', () => {
  it('points the axis at the epicentre and keeps the frame square', () => {
    const { axis, e1, e2 } = sourceFrame(38.297, 142.373, null);
    const lat = (38.297 * Math.PI) / 180;
    const lon = (142.373 * Math.PI) / 180;
    expect(axis.x).toBeCloseTo(Math.cos(lat) * Math.cos(lon), 9);
    expect(axis.z).toBeCloseTo(Math.sin(lat), 9);
    expect(axis.dot(e1)).toBeCloseTo(0, 9);
    expect(axis.dot(e2)).toBeCloseTo(0, 9);
    expect(e1.dot(e2)).toBeCloseTo(0, 9);
    expect(e1.length()).toBeCloseTo(1, 9);
  });

  it('turns e1 towards the observer', () => {
    const observer = new THREE.Vector3(0, 1, 0);
    const { axis, e1 } = sourceFrame(0, 0, observer);
    expect(axis.x).toBeCloseTo(1, 9);
    expect(e1.y).toBeCloseTo(1, 9);
  });

  it('still has a frame for an observer on the epicentre, at the antipode, or at a pole', () => {
    for (const [lat, lon, towards] of [
      [0, 0, new THREE.Vector3(1, 0, 0)],
      [0, 0, new THREE.Vector3(-1, 0, 0)],
      [90, 0, null],
      [-90, 0, new THREE.Vector3(0, 0, -1)],
    ] as const) {
      const { axis, e1, e2 } = sourceFrame(lat, lon, towards);
      expect(e1.length()).toBeCloseTo(1, 9);
      expect(e2.length()).toBeCloseTo(1, 9);
      expect(axis.dot(e1)).toBeCloseTo(0, 9);
    }
  });
});

describe('shadows', () => {
  it('finds the edges of the model shadows for a surface source', () => {
    const edges = shadowEdges(data, surface);
    // ak135: direct P to 99.6°, PKIKP back up from 115°, the PKP caustic at 145°, direct S to 100.0°.
    expect(edges.pEndDeg).toBeCloseTo(99.65, 1);
    expect(edges.coreStartDeg).toBeGreaterThan(114);
    expect(edges.coreStartDeg).toBeLessThan(116);
    expect(edges.pkpCausticDeg).toBeCloseTo(145, 0);
    expect(edges.sEndDeg).toBeCloseTo(100.03, 1);
  });

  it('lays the S shadow from the last S to the antipode and the P shadow up to the caustic', () => {
    const [s, p] = shadowZones(data, surface);
    expect(s.style).toBe(RING_STYLE.zone);
    expect(s.centreDeg - s.halfWidthDeg).toBeCloseTo(100.03, 1);
    expect(s.centreDeg + s.halfWidthDeg).toBeCloseTo(180, 6);
    expect(p.centreDeg - p.halfWidthDeg).toBeCloseTo(99.65, 1);
    expect(p.centreDeg + p.halfWidthDeg).toBeCloseTo(145, 0);
    // They appear as the waves that leave them arrive: P's edge at 825 s, S's at 1523 s.
    expect(p.fromS).toBeCloseTo(825.5, 0);
    expect(s.fromS).toBeCloseTo(1523.1, 0);
  });

  it('moves the shadows in for a deep source', () => {
    const deep = shadowEdges(data, data.slices[nearestSliceIndex(data, 600)]);
    expect(deep.pEndDeg).toBeCloseTo(97.4, 1);
    expect(deep.sEndDeg).toBeCloseTo(97.7, 1);
  });
});
