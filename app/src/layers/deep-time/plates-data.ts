/**
 * The plate model as baked by tools/pipeline/generate_deep_time.py
 * (app/public/geo/deep-time/plates.bin): present-day shapes tagged with
 * the plate each rides on, and every plate's rotation through time.
 *
 * Nothing here draws: this reads the file and answers "where was this
 * plate, or this point, at that age". No three.js, so it tests in Node.
 */

export interface PlateBlock {
  /** The model's plate ID. */
  readonly plate: number;
  /** The model's own name for it. */
  readonly name: string;
  /** A point inside it today, degrees. */
  readonly lon: number;
  readonly lat: number;
  /** Oldest age the model carries it to, Ma. */
  readonly begin: number;
}

export interface PlateFileHeader {
  readonly model: string;
  readonly citation: string;
  readonly licence: string;
  readonly referenceFrame: string;
  readonly maxAgeMa: number;
  readonly quantumPerDegree: number;
  readonly worstRotationErrorDeg: number;
  readonly plates: number;
  readonly keys: number;
  readonly sets: Readonly<Record<string, { readonly rings: number; readonly points: number; readonly fillPoints?: number }>>;
  readonly blocks: readonly PlateBlock[];
  /** Byte [offset, length] of each array, from the end of the header. */
  readonly arrays: Readonly<Record<string, readonly [number, number]>>;
}

/** One family of shapes: the coastlines, or the continental blocks. */
export interface PlateSet {
  readonly ringCount: number;
  readonly pointCount: number;
  /** Per ring: index of its plate in PlateModel.plateIds. */
  readonly ringPlate: Uint16Array;
  /** Per ring: the ages it exists between, Ma (begin is the older). */
  readonly ringBegin: Uint16Array;
  readonly ringEnd: Uint16Array;
  /** Per ring: its first point's index, and one past its last (rings are closed: last equals first). */
  readonly ringStart: Uint32Array;
  /** Present-day unit vectors, three per point: x through 0°N 0°E, z through the north pole. */
  readonly unit: Float32Array;
  /**
   * Per point, for the step to the next point: the age (Ma) back to which
   * it is a seam inside a continent - land on both sides - and so not an
   * edge worth drawing. 0: an edge at every age. NEVER_AN_EDGE: a seam for
   * as long as its piece exists.
   */
  readonly interior: Uint16Array;
  /** Absent for sets that are only outlines. */
  readonly fill: PlateFill | null;
}

/**
 * Triangles covering a set's pieces. Its vertices are the set's ring
 * points followed by points the bake added inside the pieces, so that no
 * triangle is long enough to sag far under the sphere.
 */
export interface PlateFill {
  /** Present-day unit vectors, three per vertex. */
  readonly unit: Float32Array;
  /** Per vertex: the ring it belongs to, for its plate and ages. */
  readonly ring: Uint16Array;
  readonly triangles: Uint16Array;
}

export interface PlateModel {
  readonly header: PlateFileHeader;
  readonly plateIds: Int32Array;
  /** Per plate: index of its first key, and one past its last. */
  readonly keyStart: Uint32Array;
  /** Key ages, Ma, ascending within a plate; each plate's first is 0. */
  readonly keyAges: Uint16Array;
  /** Unit quaternions (x, y, z, w), four per key. */
  readonly keyQuats: Float32Array;
  readonly sets: Readonly<Record<string, PlateSet>>;
}

const MAGIC = 0x54444554; // "TEDT", little-endian
export const NEVER_AN_EDGE = 65535;
const DEG = Math.PI / 180;

export function parsePlateFile(buffer: ArrayBuffer): PlateModel {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || view.getUint32(0, true) !== MAGIC) throw new Error('not a deep-time plate file');
  const version = view.getUint32(4, true);
  if (version !== 1) throw new Error(`deep-time plate file version ${version} is not supported`);
  const headerBytes = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, headerBytes))) as PlateFileHeader;
  const base = 12 + headerBytes;
  const span = (name: string): readonly [number, number] => {
    const entry = header.arrays[name];
    if (!entry) throw new Error(`deep-time plate file has no ${name}`);
    return entry;
  };
  // The bake pads every array to four bytes, so each can be viewed in place.
  const u16 = (name: string): Uint16Array => new Uint16Array(buffer, base + span(name)[0], span(name)[1] / 2);
  const i16 = (name: string): Int16Array => new Int16Array(buffer, base + span(name)[0], span(name)[1] / 2);

  const plateIds = new Int32Array(buffer, base + span('plateIds')[0], span('plateIds')[1] / 4);
  const keyCounts = u16('keyCounts');
  const keyStart = new Uint32Array(plateIds.length + 1);
  for (let i = 0; i < plateIds.length; i++) keyStart[i + 1] = keyStart[i] + keyCounts[i];
  const rawQuats = i16('keyQuats');
  const keyQuats = new Float32Array(rawQuats.length);
  for (let i = 0; i < rawQuats.length; i += 4) {
    const x = rawQuats[i];
    const y = rawQuats[i + 1];
    const z = rawQuats[i + 2];
    const w = rawQuats[i + 3];
    // Stored to 1/32767: put back on the unit sphere so slerp stays a rotation.
    const scale = 1 / Math.hypot(x, y, z, w);
    keyQuats[i] = x * scale;
    keyQuats[i + 1] = y * scale;
    keyQuats[i + 2] = z * scale;
    keyQuats[i + 3] = w * scale;
  }

  const sets: Record<string, PlateSet> = {};
  for (const [name, info] of Object.entries(header.sets)) {
    const counts = u16(`${name}.ringCounts`);
    const encoded = i16(`${name}.points`);
    const ringStart = new Uint32Array(info.rings + 1);
    const hasFill = header.arrays[`${name}.triangles`] !== undefined;
    const fillPoints = hasFill ? (info.fillPoints ?? 0) : 0;
    // One buffer for ring points and the fill's added points: the outline's view of it is its head.
    const allUnit = new Float32Array((info.points + fillPoints) * 3);
    const unit = allUnit.subarray(0, info.points * 3);
    const vertexRing = new Uint16Array(info.points + fillPoints);
    const toRad = DEG / header.quantumPerDegree;
    let point = 0;
    for (let ring = 0; ring < info.rings; ring++) {
      let lon = 0;
      let lat = 0;
      for (let k = 0; k < counts[ring]; k++, point++) {
        // A ring's first pair is absolute, the rest are steps.
        lon = k === 0 ? encoded[point * 2] : lon + encoded[point * 2];
        lat = k === 0 ? encoded[point * 2 + 1] : lat + encoded[point * 2 + 1];
        const cosLat = Math.cos(lat * toRad);
        unit[point * 3] = cosLat * Math.cos(lon * toRad);
        unit[point * 3 + 1] = cosLat * Math.sin(lon * toRad);
        unit[point * 3 + 2] = Math.sin(lat * toRad);
        vertexRing[point] = ring;
      }
      ringStart[ring + 1] = point;
    }
    let fill: PlateFill | null = null;
    if (hasFill) {
      const added = i16(`${name}.fillPoints`);
      const addedRing = u16(`${name}.fillRing`);
      for (let k = 0; k < fillPoints; k++) {
        const at = (info.points + k) * 3;
        const cosLat = Math.cos(added[k * 2 + 1] * toRad);
        allUnit[at] = cosLat * Math.cos(added[k * 2] * toRad);
        allUnit[at + 1] = cosLat * Math.sin(added[k * 2] * toRad);
        allUnit[at + 2] = Math.sin(added[k * 2 + 1] * toRad);
        vertexRing[info.points + k] = addedRing[k];
      }
      fill = { unit: allUnit, ring: vertexRing, triangles: u16(`${name}.triangles`) };
    }
    sets[name] = {
      ringCount: info.rings,
      pointCount: info.points,
      ringPlate: u16(`${name}.ringPlate`),
      ringBegin: u16(`${name}.ringBegin`),
      ringEnd: u16(`${name}.ringEnd`),
      ringStart,
      unit,
      interior: u16(`${name}.interior`),
      fill,
    };
  }
  return { header, plateIds, keyStart, keyAges: u16('keyAges'), keyQuats, sets };
}

/**
 * The rotation that carries plate `plate` (an index into plateIds) from
 * today to `ageMa`, written as x, y, z, w at `out[offset]`. Between keys it
 * is the shortest turn from one to the next; past a plate's last key it
 * holds that key (nothing of the plate is drawn there).
 */
export function plateQuaternion(model: PlateModel, plate: number, ageMa: number, out: Float32Array, offset = 0): void {
  const first = model.keyStart[plate];
  const last = model.keyStart[plate + 1] - 1;
  const ages = model.keyAges;
  const q = model.keyQuats;
  let lo = first;
  let hi = last;
  // Last key at or before the age.
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ages[mid] <= ageMa) lo = mid;
    else hi = mid - 1;
  }
  if (lo >= last || ageMa <= ages[lo]) {
    const k = Math.min(lo, last) * 4;
    out[offset] = q[k];
    out[offset + 1] = q[k + 1];
    out[offset + 2] = q[k + 2];
    out[offset + 3] = q[k + 3];
    return;
  }
  const a = lo * 4;
  const b = a + 4;
  const t = (ageMa - ages[lo]) / (ages[lo + 1] - ages[lo]);
  let dot = q[a] * q[b] + q[a + 1] * q[b + 1] + q[a + 2] * q[b + 2] + q[a + 3] * q[b + 3];
  // q and -q are the same rotation; take the near one.
  const sign = dot < 0 ? -1 : 1;
  dot *= sign;
  let wa: number;
  let wb: number;
  if (dot > 0.9999995) {
    wa = 1 - t;
    wb = t;
  } else {
    const theta = Math.acos(dot);
    const sin = Math.sin(theta);
    wa = Math.sin((1 - t) * theta) / sin;
    wb = Math.sin(t * theta) / sin;
  }
  wb *= sign;
  const x = wa * q[a] + wb * q[b];
  const y = wa * q[a + 1] + wb * q[b + 1];
  const z = wa * q[a + 2] + wb * q[b + 2];
  const w = wa * q[a + 3] + wb * q[b + 3];
  const norm = 1 / Math.hypot(x, y, z, w);
  out[offset] = x * norm;
  out[offset + 1] = y * norm;
  out[offset + 2] = z * norm;
  out[offset + 3] = w * norm;
}

/** Every plate's rotation at `ageMa`, four floats each: what the shader reads. */
export function writePlateQuaternions(model: PlateModel, ageMa: number, out: Float32Array): void {
  for (let plate = 0; plate < model.plateIds.length; plate++) plateQuaternion(model, plate, ageMa, out, plate * 4);
}

export interface LonLat {
  lon: number;
  lat: number;
}

/** Unit vector of a longitude and latitude in degrees, into `out[offset]`. */
export function unitFromLonLat(lon: number, lat: number, out: Float32Array | number[], offset = 0): void {
  const cosLat = Math.cos(lat * DEG);
  out[offset] = cosLat * Math.cos(lon * DEG);
  out[offset + 1] = cosLat * Math.sin(lon * DEG);
  out[offset + 2] = Math.sin(lat * DEG);
}

/** Turn the vector at `v[at]` by the quaternion at `q[qAt]`, in place: v + 2 u × (u × v + w v). */
export function rotateInPlace(q: Float32Array, qAt: number, v: Float32Array | number[], at = 0): void {
  const ux = q[qAt];
  const uy = q[qAt + 1];
  const uz = q[qAt + 2];
  const w = q[qAt + 3];
  const x = v[at];
  const y = v[at + 1];
  const z = v[at + 2];
  const cx = uy * z - uz * y + w * x;
  const cy = uz * x - ux * z + w * y;
  const cz = ux * y - uy * x + w * z;
  v[at] = x + 2 * (uy * cz - uz * cy);
  v[at + 1] = y + 2 * (uz * cx - ux * cz);
  v[at + 2] = z + 2 * (ux * cy - uy * cx);
}

const scratchQ = new Float32Array(4);
const scratchV = [0, 0, 0];

/** Where the model puts a present-day point of plate `plate` at `ageMa`. */
export function reconstructPoint(model: PlateModel, plate: number, lon: number, lat: number, ageMa: number): LonLat {
  plateQuaternion(model, plate, ageMa, scratchQ);
  unitFromLonLat(lon, lat, scratchV);
  rotateInPlace(scratchQ, 0, scratchV);
  return { lon: Math.atan2(scratchV[1], scratchV[0]) / DEG, lat: Math.asin(Math.max(-1, Math.min(1, scratchV[2]))) / DEG };
}

/**
 * How many times ring `ring` of `set` goes round the point with unit
 * vector (px, py, pz): ±1 inside, 0 outside. Works on the sphere itself -
 * bearings from the point to each vertex, summed - so a ring over a pole
 * or across the antimeridian needs no special case.
 */
export function ringWinding(set: PlateSet, ring: number, px: number, py: number, pz: number): number {
  const start = set.ringStart[ring];
  const end = set.ringStart[ring + 1];
  const unit = set.unit;
  // Seen from the antipode a ring goes once round too; no piece is as large as a hemisphere.
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = start; i < end; i++) {
    mx += unit[i * 3];
    my += unit[i * 3 + 1];
    mz += unit[i * 3 + 2];
  }
  if (mx * px + my * py + mz * pz <= 0) return 0;
  // East and north at the point; at a pole any pair of perpendicular tangents will do.
  let ex = -py;
  let ey = px;
  const eLength = Math.hypot(ex, ey);
  if (eLength < 1e-9) {
    ex = 1;
    ey = 0;
  } else {
    ex /= eLength;
    ey /= eLength;
  }
  const nx = -pz * ey;
  const ny = pz * ex;
  const nz = px * ey - py * ex;
  let total = 0;
  let previous = 0;
  for (let i = start; i < end; i++) {
    const x = unit[i * 3];
    const y = unit[i * 3 + 1];
    const z = unit[i * 3 + 2];
    const bearing = Math.atan2(x * ex + y * ey, x * nx + y * ny + z * nz);
    if (i > start) {
      let step = bearing - previous;
      if (step > Math.PI) step -= 2 * Math.PI;
      else if (step < -Math.PI) step += 2 * Math.PI;
      total += step;
    }
    previous = bearing;
  }
  return Math.round(total / (2 * Math.PI));
}

export interface CrustUnderfoot {
  /** Index into plateIds. */
  readonly plate: number;
  /** Oldest age the model carries this piece of crust to, Ma. */
  readonly begin: number;
}

/**
 * The piece of the model a present-day point stands on: continental
 * blocks first, then coastline polygons (which take in islands the
 * blocks leave out). Where pieces overlap, the one with the longest
 * history. Null over ocean floor: the model's shapes are land.
 */
export function crustAt(model: PlateModel, lon: number, lat: number): CrustUnderfoot | null {
  const p = [0, 0, 0];
  unitFromLonLat(lon, lat, p);
  for (const name of ['continents', 'coast']) {
    const set = model.sets[name];
    if (!set) continue;
    let best = -1;
    for (let ring = 0; ring < set.ringCount; ring++) {
      if (set.ringEnd[ring] > 0) continue;
      if (best >= 0 && set.ringBegin[ring] <= set.ringBegin[best]) continue;
      if (ringWinding(set, ring, p[0], p[1], p[2]) !== 0) best = ring;
    }
    if (best >= 0) return { plate: set.ringPlate[best], begin: set.ringBegin[best] };
  }
  return null;
}

/** "29.7°S", "0.0°", "12.3°N". */
export function formatLatitude(lat: number, digits = 0): string {
  const rounded = Math.abs(lat).toFixed(digits);
  if (Number(rounded) === 0) return `${rounded}°`;
  return `${rounded}°${lat < 0 ? 'S' : 'N'}`;
}
