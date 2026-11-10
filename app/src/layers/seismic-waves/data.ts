/**
 * The baked rays (tools/pipeline/generate_seismic_waves.py): how to read
 * them, where a wavefront is at a time, and when each wave reaches a place
 * on the surface. No three, no DOM: all of it is tested against TauP.
 *
 * The Earth model is radial, so everything is a function of the angular
 * distance from the source (and its depth). A wavefront at time t is the
 * curve through the points the rays have reached at t, turned about the
 * axis from the Earth's centre through the source.
 */

export type WaveFamily = 'P' | 'S';

export interface WaveBranch {
  readonly family: WaveFamily;
  /** 'PKIKP', 'PKP', 'P', 'p', 'S to the core', 'S', 's'. */
  readonly phase: string;
  /** First ray (column) of the branch, and how many. */
  readonly start: number;
  readonly count: number;
  /** Below this radius the branch is not drawn: the S that ends at the core. */
  readonly minRadiusKm: number;
  readonly reachesSurface: boolean;
}

/** A diffracted phase's reach: its time runs linearly with distance between the ends. */
export interface DiffractedRange {
  readonly fromDeg: number;
  readonly toDeg: number;
  readonly fromS: number;
  readonly toS: number;
}

export interface SurfaceWave {
  readonly id: string;
  readonly label: string;
  /** Group speed along the surface, km/s: one value standing for a dispersed wave train. */
  readonly speedKmS: number;
  readonly mode: string;
}

export interface BakedEvent {
  readonly id: string;
  readonly time: string;
  readonly lon: number;
  readonly lat: number;
  readonly depthKm: number;
  readonly mag: number;
  readonly name: string;
}

/** The shape of app/public/geo/seismic-waves.json. */
export interface WaveManifest {
  readonly model: string;
  readonly earthRadiusKm: number;
  readonly cmbRadiusKm: number;
  readonly icbRadiusKm: number;
  readonly stepS: number;
  readonly steps: number;
  readonly rays: number;
  readonly radiusScaleKm: number;
  readonly deltaScaleDeg: number;
  readonly branches: readonly WaveBranch[];
  readonly slices: readonly {
    readonly depthKm: number;
    readonly byteOffset: number;
    readonly diffracted: { readonly P: DiffractedRange | null; readonly S: DiffractedRange | null };
  }[];
  readonly surfaceWaves: readonly SurfaceWave[];
  readonly deepEvents: readonly BakedEvent[];
}

/** The rays from one source depth. */
export interface WaveSlice {
  readonly depthKm: number;
  /** steps x rays texels of 4 bytes, as the GPU takes them: radius lo, hi, distance lo, hi. */
  readonly texels: Uint8Array;
  /** When (s) and where (deg from the source) each ray reaches the surface; NaN if it never does. */
  readonly arrivalS: Float32Array;
  readonly arrivalDeg: Float32Array;
  /** Take-off angle, degrees from straight down; NaN where the depth has no such ray. */
  readonly takeoffDeg: Float32Array;
  readonly diffracted: { readonly P: DiffractedRange | null; readonly S: DiffractedRange | null };
}

export interface WaveData {
  readonly manifest: WaveManifest;
  readonly slices: readonly WaveSlice[];
}

const U16 = 65535;

export function parseWaveData(manifest: WaveManifest, buffer: ArrayBuffer): WaveData {
  const { steps, rays } = manifest;
  const texelBytes = steps * rays * 4;
  const sliceBytes = texelBytes + rays * 12;
  const slices = manifest.slices.map((entry): WaveSlice => {
    if (entry.byteOffset + sliceBytes > buffer.byteLength) {
      throw new Error(`seismic-waves.bin is too short for the ${entry.depthKm} km rays`);
    }
    // Copies, so each array is aligned and owns its memory whatever the offset.
    const floats = new Float32Array(buffer.slice(entry.byteOffset + texelBytes, entry.byteOffset + sliceBytes));
    return {
      depthKm: entry.depthKm,
      texels: new Uint8Array(buffer.slice(entry.byteOffset, entry.byteOffset + texelBytes)),
      arrivalS: floats.subarray(0, rays),
      arrivalDeg: floats.subarray(rays, 2 * rays),
      takeoffDeg: floats.subarray(2 * rays, 3 * rays),
      diffracted: entry.diffracted,
    };
  });
  return { manifest, slices };
}

/** Index of the baked depth nearest to an earthquake's. */
export function nearestSliceIndex(data: WaveData, depthKm: number): number {
  let best = 0;
  for (let i = 1; i < data.slices.length; i++) {
    if (Math.abs(data.slices[i].depthKm - depthKm) < Math.abs(data.slices[best].depthKm - depthKm)) best = i;
  }
  return best;
}

export interface RayPoint {
  radiusKm: number;
  deltaDeg: number;
}

function texel(manifest: WaveManifest, slice: WaveSlice, ray: number, step: number, out: RayPoint): RayPoint {
  const i = (step * manifest.rays + ray) * 4;
  const t = slice.texels;
  out.radiusKm = ((t[i] | (t[i + 1] << 8)) / U16) * manifest.radiusScaleKm;
  out.deltaDeg = ((t[i + 2] | (t[i + 3] << 8)) / U16) * manifest.deltaScaleDeg;
  return out;
}

const scratchA: RayPoint = { radiusKm: 0, deltaDeg: 0 };
const scratchB: RayPoint = { radiusKm: 0, deltaDeg: 0 };

/**
 * Where one ray is at a time: the stored steps, joined by straight chords
 * in the plane of the ray (not in radius and angle, which would swing a
 * ray passing the centre round it). Exactly what the vertex shader
 * computes. A ray that has ended comes back outside the Earth (or, for the
 * S that died at the core, inside the core). `deltaDeg` runs 0..360: past
 * 180 the ray has crossed the axis through the antipode.
 */
export function rayPoint(data: WaveData, slice: WaveSlice, ray: number, timeS: number, out: RayPoint): RayPoint {
  const { stepS, steps } = data.manifest;
  const position = Math.min(Math.max(timeS / stepS, 0), steps - 1);
  const step = Math.min(Math.floor(position), steps - 2);
  const w = position - step;
  const a = texel(data.manifest, slice, ray, step, scratchA);
  const b = texel(data.manifest, slice, ray, step + 1, scratchB);
  const rad = Math.PI / 180;
  // x across the axis, y along it towards the source.
  const x = a.radiusKm * Math.sin(a.deltaDeg * rad) * (1 - w) + b.radiusKm * Math.sin(b.deltaDeg * rad) * w;
  const y = a.radiusKm * Math.cos(a.deltaDeg * rad) * (1 - w) + b.radiusKm * Math.cos(b.deltaDeg * rad) * w;
  out.radiusKm = Math.hypot(x, y);
  const delta = Math.atan2(x, y) / rad;
  out.deltaDeg = delta < 0 ? delta + 360 : delta;
  return out;
}

/** Whether a ray's point is part of the front: inside the Earth, and above the core for the S that ends there. */
export function isLive(data: WaveData, branch: WaveBranch, point: RayPoint): boolean {
  return point.radiusKm <= data.manifest.earthRadiusKm && point.radiusKm >= branch.minRadiusKm;
}

/** The last second at which any ray of a family is still in flight. */
export function familyEndS(data: WaveData, slice: WaveSlice, family: WaveFamily): number {
  let end = 0;
  for (const branch of data.manifest.branches) {
    if (branch.family !== family || !branch.reachesSurface) continue;
    for (let i = branch.start; i < branch.start + branch.count; i++) {
      const t = slice.arrivalS[i];
      if (t > end) end = t;
    }
  }
  return end;
}

/**
 * Where a family's fronts meet the surface at a time: the distances (deg,
 * 0..180) of the rings a person standing there would feel pass. Written
 * into `out`; returns how many. A ray landing between two neighbours of
 * the fan that land either side of `timeS` puts a ring between them.
 */
export function surfaceRings(data: WaveData, slice: WaveSlice, family: WaveFamily, timeS: number, out: Float32Array): number {
  let n = 0;
  for (const branch of data.manifest.branches) {
    if (branch.family !== family || !branch.reachesSurface) continue;
    for (let i = branch.start; i < branch.start + branch.count - 1 && n < out.length; i++) {
      const t0 = slice.arrivalS[i];
      const t1 = slice.arrivalS[i + 1];
      // NaN compares false: a ray this depth does not have ends the search here.
      if (!((t0 <= timeS && timeS < t1) || (t1 <= timeS && timeS < t0))) continue;
      const w = (timeS - t0) / (t1 - t0);
      const delta = slice.arrivalDeg[i] + (slice.arrivalDeg[i + 1] - slice.arrivalDeg[i]) * w;
      out[n++] = delta > 180 ? 360 - delta : delta;
    }
  }
  const diffracted = slice.diffracted[family];
  if (diffracted && n < out.length && timeS >= diffracted.fromS && timeS <= diffracted.toS) {
    const w = (timeS - diffracted.fromS) / (diffracted.toS - diffracted.fromS);
    out[n++] = diffracted.fromDeg + (diffracted.toDeg - diffracted.fromDeg) * w;
  }
  return n;
}

export interface Arrival {
  /** 'P', 'PKP', 'PKIKP', 'Pdiff', 'S', 'Sdiff', 'Love wave', 'Rayleigh wave' ... */
  readonly phase: string;
  readonly family: WaveFamily | 'surface';
  /** Seconds after the origin. */
  readonly timeS: number;
  /** Diffracted along the core: real, but weak, and its range is a convention. */
  readonly diffracted: boolean;
}

/** Arrivals of the traced rays of one baked depth at a distance. */
function sliceArrivals(data: WaveData, slice: WaveSlice, deltaDeg: number, out: Arrival[]): void {
  for (const branch of data.manifest.branches) {
    if (!branch.reachesSurface) continue;
    for (let i = branch.start; i < branch.start + branch.count - 1; i++) {
      const d0 = slice.arrivalDeg[i];
      const d1 = slice.arrivalDeg[i + 1];
      if (!(d0 === d0 && d1 === d1) || d0 === d1) continue;
      // A ray that has passed the antipode comes up at 360 minus its distance.
      for (const target of deltaDeg === 180 ? [180] : [deltaDeg, 360 - deltaDeg]) {
        const w = (target - d0) / (d1 - d0);
        if (w < 0 || w > 1) continue;
        // The upgoing legs are the same wave as the downgoing: one name.
        const phase = branch.phase === 'p' ? 'P' : branch.phase === 's' ? 'S' : branch.phase;
        out.push({ phase, family: branch.family, timeS: slice.arrivalS[i] + (slice.arrivalS[i + 1] - slice.arrivalS[i]) * w, diffracted: false });
      }
    }
  }
  for (const family of ['P', 'S'] as const) {
    const range = slice.diffracted[family];
    if (!range || deltaDeg < range.fromDeg || deltaDeg > range.toDeg) continue;
    const w = (deltaDeg - range.fromDeg) / (range.toDeg - range.fromDeg);
    out.push({ phase: `${family}diff`, family, timeS: range.fromS + (range.toS - range.fromS) * w, diffracted: true });
  }
}

/** The earliest arrival of each phase, soonest first. */
function firstOfEachPhase(arrivals: readonly Arrival[]): Arrival[] {
  const first = new Map<string, Arrival>();
  for (const arrival of arrivals) {
    const held = first.get(arrival.phase);
    if (!held || arrival.timeS < held.timeS) first.set(arrival.phase, arrival);
  }
  return [...first.values()].sort((a, b) => a.timeS - b.timeS);
}

/**
 * When each wave reaches a point on the surface `deltaDeg` from the
 * epicentre of an earthquake `depthKm` deep: the first arrival of every
 * phase, soonest first. Body waves are read from the two baked depths
 * either side and interpolated; a phase only one of them has (the edge of
 * a shadow moves with depth) is taken from that one. Surface waves follow
 * at their fixed speeds, the short way round.
 */
export function arrivalsAt(data: WaveData, depthKm: number, deltaDeg: number): Arrival[] {
  const slices = data.slices;
  let upper = 0;
  while (upper < slices.length - 2 && slices[upper + 1].depthKm <= depthKm) upper++;
  const a = slices[upper];
  const b = slices[Math.min(upper + 1, slices.length - 1)];
  const w = a === b ? 0 : Math.min(Math.max((depthKm - a.depthKm) / (b.depthKm - a.depthKm), 0), 1);
  const rawA: Arrival[] = [];
  const rawB: Arrival[] = [];
  sliceArrivals(data, a, deltaDeg, rawA);
  sliceArrivals(data, b, deltaDeg, rawB);
  const fromA = firstOfEachPhase(rawA);
  const fromB = new Map(firstOfEachPhase(rawB).map((arrival) => [arrival.phase, arrival]));
  const merged: Arrival[] = [];
  for (const arrival of fromA) {
    const other = fromB.get(arrival.phase);
    fromB.delete(arrival.phase);
    if (!other) {
      // Only the nearer depth's word counts for a phase the other lacks.
      if (w <= 0.5) merged.push(arrival);
      continue;
    }
    merged.push({ ...arrival, timeS: arrival.timeS + (other.timeS - arrival.timeS) * w });
  }
  for (const arrival of fromB.values()) if (w > 0.5) merged.push(arrival);

  const arcKm = ((deltaDeg * Math.PI) / 180) * data.manifest.earthRadiusKm;
  for (const wave of data.manifest.surfaceWaves) {
    merged.push({ phase: wave.label, family: 'surface', timeS: arcKm / wave.speedKmS, diffracted: false });
  }
  return merged.sort((x, y) => x.timeS - y.timeS);
}

/** Great-circle angle in degrees between two points given in degrees, on the sphere. */
export function angularDistanceDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const sinLat = Math.sin(((lat2 - lat1) * rad) / 2);
  const sinLon = Math.sin(((lon2 - lon1) * rad) / 2);
  const h = sinLat * sinLat + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * sinLon * sinLon;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / rad;
}

/** Distance (deg, 0..180) of a surface wave's ring at a time: out to the antipode and back again, lap after lap. */
export function surfaceWaveRingDeg(data: WaveData, wave: SurfaceWave, timeS: number): number {
  const travelled = (((wave.speedKmS * timeS) / data.manifest.earthRadiusKm) * 180) / Math.PI;
  const lap = travelled % 360;
  return lap > 180 ? 360 - lap : lap;
}
