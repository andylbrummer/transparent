import { describe, it, expect } from 'vitest';
import {
  angularDistanceDeg,
  arrivalsAt,
  familyEndS,
  isLive,
  nearestSliceIndex,
  parseWaveData,
  rayPoint,
  surfaceRings,
  surfaceWaveRingDeg,
  type Arrival,
  type RayPoint,
  type WaveManifest,
} from './data';
import { loadBakedWaves } from './baked.testdata';
import { TAUP_FIXTURE } from './taup.fixture';

const data = loadBakedWaves();
const { manifest } = data;
const surface = data.slices[0];

const first = (arrivals: readonly Arrival[], phase: string): number | undefined =>
  arrivals.find((arrival) => arrival.phase === phase)?.timeS;

describe('parseWaveData', () => {
  it('reads every baked depth, each with all its rays', () => {
    expect(data.slices.map((slice) => slice.depthKm)).toEqual([0, 12, 30, 60, 150, 300, 450, 600, 700]);
    for (const slice of data.slices) {
      expect(slice.texels.length).toBe(manifest.steps * manifest.rays * 4);
      expect(slice.arrivalS.length).toBe(manifest.rays);
      expect(slice.takeoffDeg.length).toBe(manifest.rays);
    }
  });

  it('decodes two little-endian uint16 per texel: radius, then distance', () => {
    const tiny: WaveManifest = {
      ...manifest,
      steps: 2,
      rays: 1,
      radiusScaleKm: 65535,
      deltaScaleDeg: 65535,
      slices: [{ depthKm: 0, byteOffset: 0, diffracted: { P: null, S: null } }],
    };
    const bytes = new Uint8Array(2 * 4 + 12);
    // Step 0: radius 0x1234, distance 0x0010. Step 1: the same again.
    bytes.set([0x34, 0x12, 0x10, 0x00, 0x34, 0x12, 0x10, 0x00]);
    const parsed = parseWaveData(tiny, bytes.buffer);
    const point = rayPoint(parsed, parsed.slices[0], 0, 0, { radiusKm: 0, deltaDeg: 0 });
    expect(point.radiusKm).toBeCloseTo(0x1234, 6);
    expect(point.deltaDeg).toBeCloseTo(0x10, 6);
  });

  it('refuses a file too short for its manifest', () => {
    expect(() => parseWaveData(manifest, new ArrayBuffer(1000))).toThrow(/too short/);
  });
});

describe('nearestSliceIndex', () => {
  it('picks the baked depth nearest an earthquake', () => {
    expect(data.slices[nearestSliceIndex(data, 29)].depthKm).toBe(30);
    expect(data.slices[nearestSliceIndex(data, 10)].depthKm).toBe(12);
    expect(data.slices[nearestSliceIndex(data, 598.1)].depthKm).toBe(600);
    expect(data.slices[nearestSliceIndex(data, 900)].depthKm).toBe(700);
    expect(data.slices[nearestSliceIndex(data, -2)].depthKm).toBe(0);
  });
});

describe('rayPoint: the front at a time is the rays at that time', () => {
  const point: RayPoint = { radiusKm: 0, deltaDeg: 0 };

  it('starts every ray at the source', () => {
    const slice = data.slices[nearestSliceIndex(data, 600)];
    for (const branch of manifest.branches) {
      rayPoint(data, slice, branch.start + 1, 0, point);
      expect(point.radiusKm).toBeCloseTo(manifest.earthRadiusKm - 600, 0);
      expect(point.radiusKm * Math.sin((point.deltaDeg * Math.PI) / 180)).toBeCloseTo(0, 0);
    }
  });

  it('matches points on rays traced by TauP, between the stored steps', () => {
    let worstKm = 0;
    for (const want of TAUP_FIXTURE.rayPoints) {
      const slice = data.slices[nearestSliceIndex(data, want.depthKm)];
      expect(slice.depthKm).toBe(want.depthKm);
      rayPoint(data, slice, want.ray, want.timeS, point);
      const rad = Math.PI / 180;
      const dx = point.radiusKm * Math.sin(point.deltaDeg * rad) - want.radiusKm * Math.sin(want.deltaDeg * rad);
      const dy = point.radiusKm * Math.cos(point.deltaDeg * rad) - want.radiusKm * Math.cos(want.deltaDeg * rad);
      worstKm = Math.max(worstKm, Math.hypot(dx, dy));
    }
    expect(TAUP_FIXTURE.rayPoints.length).toBeGreaterThan(100);
    // A 20 s chord across the bend at the core-mantle boundary is the worst case.
    expect(worstKm).toBeLessThan(35);
  });

  it('carries the P front through the centre to the antipode in about 20 minutes', () => {
    // The ray straight down: the first of PKIKP.
    rayPoint(data, surface, 0, 606, point);
    expect(point.radiusKm).toBeLessThan(15);
    rayPoint(data, surface, 0, 1200, point);
    expect(point.deltaDeg).toBeCloseTo(180, 3);
    // 12.5 s short of landing, in the slow crust.
    expect(point.radiusKm).toBeGreaterThan(manifest.earthRadiusKm - 100);
    expect(surface.arrivalS[0]).toBeCloseTo(1212.5, 0);
  });

  it('ends the S that strikes the core at the core, and every landed ray above the surface', () => {
    const toCore = manifest.branches.find((branch) => branch.phase === 'S to the core')!;
    const direct = manifest.branches.find((branch) => branch.phase === 'P')!;
    rayPoint(data, surface, toCore.start + 5, 1500, point);
    expect(point.radiusKm).toBeLessThan(manifest.cmbRadiusKm);
    expect(isLive(data, toCore, point)).toBe(false);
    rayPoint(data, surface, toCore.start + 5, 300, point);
    expect(isLive(data, toCore, point)).toBe(true);
    const ray = direct.start + 70;
    rayPoint(data, surface, ray, surface.arrivalS[ray] + 30, point);
    expect(isLive(data, direct, point)).toBe(false);
    rayPoint(data, surface, ray, surface.arrivalS[ray] - 30, point);
    expect(isLive(data, direct, point)).toBe(true);
  });

  it('knows when each family is over', () => {
    expect(familyEndS(data, surface, 'P')).toBeGreaterThan(1300);
    expect(familyEndS(data, surface, 'P')).toBeLessThan(1340);
    expect(familyEndS(data, surface, 'S')).toBeCloseTo(1523.1, 0);
  });
});

describe('surfaceRings', () => {
  const rings = new Float32Array(16);
  const ringsAt = (family: 'P' | 'S', timeS: number): number[] =>
    [...rings.subarray(0, surfaceRings(data, surface, family, timeS, rings))].sort((a, b) => a - b);

  it('puts the P ring where the published ak135 tables put P', () => {
    // Kennett's tables, surface focus: P reaches 30° at 370.27 s, 60° at 608.34 s, 90° at 781.40 s.
    expect(ringsAt('P', 370.27)[0]).toBeCloseTo(30, 1);
    expect(ringsAt('P', 608.34)[0]).toBeCloseTo(60, 1);
    expect(ringsAt('P', 781.4)[0]).toBeCloseTo(90, 1);
  });

  it('puts the S ring behind it', () => {
    // S reaches 30° at 669.14 s.
    expect(ringsAt('S', 669.14)[0]).toBeCloseTo(30, 1);
    expect(ringsAt('S', 608.34)[0]).toBeLessThan(ringsAt('P', 608.34)[0]);
  });

  it('leaves the P shadow empty of rays and then brings P back through the core', () => {
    // 15 min: direct P has ended (825 s); only the diffracted wave creeps on, and the inner-core wave is not up yet.
    const at900 = ringsAt('P', 900);
    expect(at900).toHaveLength(1);
    expect(at900[0]).toBeGreaterThan(99.6);
    expect(at900[0]).toBeLessThan(120);
    // 20 min: core phases are landing beyond 144°; nothing between the diffracted ring and them.
    const at1195 = ringsAt('P', 1195);
    expect(at1195.filter((deg) => deg > 140).length).toBeGreaterThanOrEqual(2);
    // After the antipode (1212.5 s) only the slow PKP branch is still coming up.
    expect(ringsAt('P', 1400)).toHaveLength(0);
  });

  it('has no S ring past the core shadow except the diffracted one', () => {
    expect(ringsAt('S', 1500).every((deg) => deg < 100.1)).toBe(true);
    const late = ringsAt('S', 1700);
    expect(late).toHaveLength(1);
    expect(late[0]).toBeGreaterThan(100);
  });
});

describe('arrivalsAt: when the waves reach a place', () => {
  it('agrees with TauP for earthquakes between the baked depths', () => {
    let compared = 0;
    for (const want of TAUP_FIXTURE.arrivals) {
      const got = arrivalsAt(data, want.depthKm, want.distanceDeg);
      for (const [phase, timeS] of Object.entries(want.times)) {
        const mine = first(got, phase);
        // A branch's very end can fall between two depths' fans; everything else must be there.
        if (mine === undefined) {
          expect(['PKP', 'PKIKP', 'Pdiff', 'Sdiff']).toContain(phase);
          continue;
        }
        compared++;
        // Interpolating in depth is the largest error: 631 km lies 31 km from a baked depth.
        expect(Math.abs(mine - timeS), `${phase} at ${want.distanceDeg}° from ${want.depthKm} km`).toBeLessThan(1.5);
      }
    }
    expect(compared).toBeGreaterThan(120);
  });

  it('never reports a body wave TauP does not have', () => {
    for (const want of TAUP_FIXTURE.arrivals) {
      for (const arrival of arrivalsAt(data, want.depthKm, want.distanceDeg)) {
        if (arrival.family === 'surface') continue;
        expect(Object.keys(want.times), `${arrival.phase} at ${want.distanceDeg}° from ${want.depthKm} km`).toContain(arrival.phase);
      }
    }
  });

  it('gives Tōhoku 2011 its 20 minutes to the antipode', () => {
    const antipode = arrivalsAt(data, 29, 180);
    // TauP: PKIKP from 29 km to 180° in 1208.5 s.
    expect(antipode[0].phase).toBe('PKIKP');
    expect(antipode[0].timeS / 60).toBeGreaterThan(20);
    expect(antipode[0].timeS / 60).toBeLessThan(20.3);
    expect(antipode.some((arrival) => arrival.family === 'S')).toBe(false);
  });

  it('gives the core shadow no direct S, and marks what creeps round the core as diffracted', () => {
    const shadow = arrivalsAt(data, 29, 120);
    expect(first(shadow, 'S')).toBeUndefined();
    expect(shadow.find((arrival) => arrival.phase === 'Sdiff')?.diffracted).toBe(true);
    expect(first(shadow, 'P')).toBeUndefined();
    expect(shadow.find((arrival) => arrival.phase === 'Pdiff')?.diffracted).toBe(true);
  });

  it('orders P, S and the surface waves', () => {
    const phases = arrivalsAt(data, 10, 60).map((arrival) => arrival.phase);
    expect(phases).toEqual(['P', 'S', 'Love wave', 'Rayleigh wave']);
  });

  it('times the surface waves by their group speed along the ground', () => {
    const quarter = arrivalsAt(data, 0, 90);
    const arcKm = (Math.PI / 2) * 6371;
    expect(first(quarter, 'Rayleigh wave')).toBeCloseTo(arcKm / 3.717, 6);
    expect(first(quarter, 'Love wave')).toBeCloseTo(arcKm / 4.382, 6);
  });
});

describe('surfaceWaveRingDeg', () => {
  const rayleigh = manifest.surfaceWaves.find((wave) => wave.id === 'rayleigh')!;
  const lapS = (2 * Math.PI * manifest.earthRadiusKm) / rayleigh.speedKmS;

  it('runs out to the antipode and comes back', () => {
    expect(surfaceWaveRingDeg(data, rayleigh, lapS / 4)).toBeCloseTo(90, 6);
    expect(surfaceWaveRingDeg(data, rayleigh, lapS / 2)).toBeCloseTo(180, 6);
    expect(surfaceWaveRingDeg(data, rayleigh, (lapS * 3) / 4)).toBeCloseTo(90, 6);
    expect(surfaceWaveRingDeg(data, rayleigh, lapS * 1.25)).toBeCloseTo(90, 6);
  });

  it('takes about three hours for a lap', () => {
    expect(lapS / 3600).toBeGreaterThan(2.9);
    expect(lapS / 3600).toBeLessThan(3.1);
  });
});

describe('angularDistanceDeg', () => {
  it('measures along the great circle', () => {
    expect(angularDistanceDeg(0, 0, 0, 90)).toBeCloseTo(90, 9);
    expect(angularDistanceDeg(30, 10, -30, -170)).toBeCloseTo(180, 6);
    expect(angularDistanceDeg(90, 123, 0, -45)).toBeCloseTo(90, 9);
    expect(angularDistanceDeg(10, 20, 10, 20)).toBe(0);
  });
});
