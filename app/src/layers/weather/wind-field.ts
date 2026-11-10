/**
 * The wind as particles: a field on the GFS grid, and the particles the
 * layer draws drifting through it.
 *
 * Positions are unit vectors in ECEF, so a particle crosses the poles and
 * the antimeridian without special cases. Each particle keeps a short
 * history of where it has been - its trail. The history lives in one flat
 * buffer laid out slot by slot (all particles' newest point, then all
 * their previous points, …) as a ring: a frame rewrites only the newest
 * slot, a contiguous range, which is all the GPU has to be sent.
 *
 * No three.js here: this is the part that can be tested.
 */

import { GFS_NI, GFS_NJ, type GfsGrid } from './gfs';

const DEG = Math.PI / 180;

export interface WindField {
  /** Eastward and northward wind, m/s, on the GFS 1° grid. */
  readonly u: GfsGrid;
  readonly v: GfsGrid;
}

/**
 * Bilinear wind at a latitude and longitude in degrees, written to
 * out[0] (east) and out[1] (north). Longitude wraps; latitude clamps.
 */
export function sampleWind(field: WindField, latDeg: number, lonDeg: number, out: Float32Array): void {
  const row = Math.min(Math.max(90 - latDeg, 0), GFS_NJ - 1);
  const column = (((lonDeg % 360) + 360) % 360) % GFS_NI;
  const j0 = Math.min(Math.floor(row), GFS_NJ - 2);
  const i0 = Math.floor(column);
  const i1 = (i0 + 1) % GFS_NI;
  const fy = row - j0;
  const fx = column - i0;
  const a = j0 * GFS_NI;
  const b = a + GFS_NI;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  out[0] = field.u[a + i0] * w00 + field.u[a + i1] * w10 + field.u[b + i0] * w01 + field.u[b + i1] * w11;
  out[1] = field.v[a + i0] * w00 + field.v[a + i1] * w10 + field.v[b + i0] * w01 + field.v[b + i1] * w11;
}

const wind = new Float32Array(2);

/**
 * Move the unit vector at positions[offset..offset+2] with the wind for
 * `radians` of arc per m/s (time × exaggeration ÷ Earth radius, folded
 * into one number by the caller). Returns the wind speed there, m/s.
 */
export function advect(field: WindField, positions: Float32Array, offset: number, radiansPerMs: number): number {
  const x = positions[offset];
  const y = positions[offset + 1];
  const z = positions[offset + 2];
  const horizontal = Math.hypot(x, y);
  sampleWind(field, Math.atan2(z, horizontal) / DEG, Math.atan2(y, x) / DEG, wind);
  const speed = Math.hypot(wind[0], wind[1]);
  // At a pole "east" has no direction; the particle waits there for its respawn.
  if (horizontal < 1e-6) return speed;
  const east = wind[0] * radiansPerMs;
  const north = wind[1] * radiansPerMs;
  // east = (−y, x, 0)/h; north = (−z·x, −z·y, h²)/h.
  const nx = x + (-y * east - z * x * north) / horizontal;
  const ny = y + (x * east - z * y * north) / horizontal;
  const nz = z + horizontal * north;
  const norm = Math.hypot(nx, ny, nz);
  positions[offset] = nx / norm;
  positions[offset + 1] = ny / norm;
  positions[offset + 2] = nz / norm;
  return speed;
}

export interface ParticleOptions {
  readonly count: number;
  /** Points kept per trail. */
  readonly slots: number;
  /** Seconds between trail points. */
  readonly slotSeconds: number;
  /** Arc a 1 m/s wind covers per second of animation, radians: the time exaggeration. */
  readonly radiansPerMsPerSecond: number;
  /** A particle lives a random time in this range, seconds, then starts again elsewhere. */
  readonly lifeSeconds: readonly [number, number];
  /** Uniform in [0, 1); Math.random by default. */
  readonly random?: () => number;
}

/** Floats per trail point: x, y, z, then the wind speed there (m/s) or BREAK. */
export const POINT_STRIDE = 4;
/** Speed value marking the first point after a respawn: no line is drawn into it. */
export const BREAK = -1;

export class WindParticles {
  /**
   * (slots + 1) × count points. Slot `slots` repeats slot 0, so that the
   * segment from the last slot to the first reads straight on in the buffer.
   */
  readonly buffer: Float32Array;
  /** The slot holding every particle's newest point. */
  head = 0;
  /** Seconds since the head slot was started. */
  sinceSlot = 0;
  private readonly position: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  /** 1 while the particle's head point is its first since a respawn. */
  private readonly fresh: Uint8Array;
  private readonly random: () => number;

  constructor(
    private field: WindField,
    readonly options: ParticleOptions
  ) {
    const { count, slots } = options;
    this.random = options.random ?? Math.random;
    this.buffer = new Float32Array((slots + 1) * count * POINT_STRIDE);
    this.position = new Float32Array(count * 3);
    this.age = new Float32Array(count);
    this.life = new Float32Array(count);
    this.fresh = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      this.respawn(i);
      // Start part-way through life, or the whole field would blink out together.
      this.age[i] = this.random() * this.life[i];
      // Every slot starts at the particle's own spot, so no stray line crosses the globe.
      for (let slot = 0; slot <= slots; slot++) this.write(slot, i, BREAK);
    }
  }

  setField(field: WindField): void {
    this.field = field;
  }

  /** A point uniform over the sphere's area. */
  private respawn(i: number): void {
    const z = 2 * this.random() - 1;
    const lon = 2 * Math.PI * this.random();
    const h = Math.sqrt(1 - z * z);
    this.position[i * 3] = h * Math.cos(lon);
    this.position[i * 3 + 1] = h * Math.sin(lon);
    this.position[i * 3 + 2] = z;
    const [shortest, longest] = this.options.lifeSeconds;
    this.life[i] = shortest + this.random() * (longest - shortest);
    this.age[i] = 0;
    this.fresh[i] = 1;
  }

  private write(slot: number, i: number, speed: number): void {
    const at = (slot * this.options.count + i) * POINT_STRIDE;
    this.buffer[at] = this.position[i * 3];
    this.buffer[at + 1] = this.position[i * 3 + 1];
    this.buffer[at + 2] = this.position[i * 3 + 2];
    this.buffer[at + 3] = speed;
  }

  /**
   * Advance every particle by `seconds` of animation and rewrite the head
   * slot. Returns true when a new slot was started.
   */
  step(seconds: number): boolean {
    const { count, slots, slotSeconds, radiansPerMsPerSecond } = this.options;
    let advanced = false;
    this.sinceSlot += seconds;
    if (this.sinceSlot >= slotSeconds) {
      // A long frame starts one slot, not several: the trail just has a longer stride there.
      this.sinceSlot = Math.min(this.sinceSlot - slotSeconds, slotSeconds);
      this.head = (this.head + 1) % slots;
      this.fresh.fill(0);
      advanced = true;
    }
    const arc = radiansPerMsPerSecond * seconds;
    for (let i = 0; i < count; i++) {
      this.age[i] += seconds;
      let speed: number;
      if (this.age[i] > this.life[i]) {
        this.respawn(i);
        speed = BREAK;
      } else {
        speed = advect(this.field, this.position, i * 3, arc);
        if (this.fresh[i]) speed = BREAK;
      }
      this.write(this.head, i, speed);
      if (this.head === 0) this.write(slots, i, speed);
    }
    return advanced;
  }

  /** How far the head slot is toward the next, 0..1: lets the trail's fade move smoothly. */
  get phase(): number {
    return Math.min(this.sinceSlot / this.options.slotSeconds, 1);
  }
}

/**
 * How many slots old the segment starting at `slot` is, given the head:
 * 0 for the segment ending at the head, slots − 1 for the one that would
 * join the oldest point back to the newest and must not be drawn. The
 * vertex shader does the same sum; this is its reference.
 */
export function segmentAge(slot: number, head: number, slots: number): number {
  return (((head - slot - 1) % slots) + slots) % slots;
}

/**
 * Thins the trails on a device that cannot keep up. It watches frame times
 * a window at a time and, while their mean stays over the target, lowers
 * the share of particles drawn by a step, down to a floor. It never raises it again:
 * a share that climbed back would only find the same limit and oscillate.
 * Whatever else slows the frame thins the wind too - the cheapest thing in
 * the view to have less of.
 */
export class LoadGovernor {
  /** Share of the particles to draw, 0..1. */
  keep = 1;
  private frames = 0;
  private totalMs = 0;
  private warmUp: number;

  constructor(
    private readonly targetMs = 18,
    private readonly windowFrames = 45,
    private readonly step = 0.25,
    private readonly floor = 0.25,
    warmUpFrames = 30
  ) {
    this.warmUp = warmUpFrames;
  }

  /** Feed one frame's duration; returns the share to draw from now on. */
  sample(frameMs: number): number {
    // The first frames compile shaders and upload buffers: not the steady state.
    if (this.warmUp > 0) {
      this.warmUp--;
      return this.keep;
    }
    // One long stall (a tab switch) counts as one slow frame, not fifty: alone it must not thin anything.
    this.totalMs += Math.min(frameMs, 2 * this.targetMs);
    if (++this.frames < this.windowFrames) return this.keep;
    if (this.totalMs / this.frames > this.targetMs) this.keep = Math.max(this.floor, this.keep - this.step);
    this.frames = 0;
    this.totalMs = 0;
    return this.keep;
  }
}
