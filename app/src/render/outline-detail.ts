/**
 * Level of detail for the dense line sets - coastlines, borders, state
 * lines.
 *
 * Their data is fine enough for a coast a few hundred km off, and nearly
 * all of it is seen across the planet, where a 7 km step is a third of a
 * pixel: tens of thousands of line quads, each a few pixels of blended
 * overdraw on the same spot. That overdraw, not the vertex count, is what
 * the lines cost - and they were the most expensive thing in the default
 * view, most of all in stereo, whose wide eyes see the whole far side twice.
 *
 * So each set is cut into cells of the sphere, and each cell is kept at
 * several levels: as given, and simplified to each of
 * SIMPLIFY_TOLERANCES_M. A cell shows the coarsest level whose error is
 * under a pixel on screen - which depends on its distance, on the zoom and
 * on the size of the viewport - and cells out of view are not drawn at all.
 *
 * No three.js objects here beyond the switch itself: the cutting and the
 * simplifying are plain arrays, for the tests.
 */

import * as THREE from 'three';

/**
 * How far each simplified level may stray from the real line, metres,
 * finest first. The first serves a phone held upright, where the far side
 * is 10 km to the pixel; the second the stereo view's small, wide eyes,
 * where it is 30 km and more.
 */
export const SIMPLIFY_TOLERANCES_M: readonly number[] = [4_000, 16_000];
/** A simplified level is shown while its error stays under this many CSS pixels. */
export const SIMPLIFY_MAX_ERROR_PX = 0.75;
/** A line set with fewer segments than this is drawn whole: nothing to gain. */
export const DETAIL_MIN_SEGMENTS = 10_000;

/** Cells of the sphere: the six faces of a cube round it, each quartered. */
export const CELL_COUNT = 24;

/** The cell holding direction (x, y, z). */
export function cellOf(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let face: number;
  let u: number;
  let v: number;
  if (ax >= ay && ax >= az) {
    face = x >= 0 ? 0 : 1;
    u = y;
    v = z;
  } else if (ay >= az) {
    face = y >= 0 ? 2 : 3;
    u = x;
    v = z;
  } else {
    face = z >= 0 ? 4 : 5;
    u = x;
    v = y;
  }
  return face * 4 + (u >= 0 ? 1 : 0) + (v >= 0 ? 2 : 0);
}

export interface OutlineCell {
  /** A point amid the cell's lines, ECEF metres: the origin of its positions. */
  readonly centre: readonly [number, number, number];
  /** Every point of the cell lies within this of the centre, metres. */
  readonly radiusM: number;
  /**
   * Segment endpoints relative to the centre, six numbers a segment: first
   * the lines as given, then simplified to each tolerance in turn.
   */
  readonly levels: readonly Float32Array[];
}

/** Squared distance from point p to the segment a-b, all at offsets into `points` (xyz triples). */
function distanceSqToSegment(points: ArrayLike<number>, p: number, a: number, b: number): number {
  const ax = points[a];
  const ay = points[a + 1];
  const az = points[a + 2];
  const dx = points[b] - ax;
  const dy = points[b + 1] - ay;
  const dz = points[b + 2] - az;
  const px = points[p] - ax;
  const py = points[p + 1] - ay;
  const pz = points[p + 2] - az;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  const t = lengthSq > 0 ? Math.min(Math.max((px * dx + py * dy + pz * dz) / lengthSq, 0), 1) : 0;
  const ex = px - t * dx;
  const ey = py - t * dy;
  const ez = pz - t * dz;
  return ex * ex + ey * ey + ez * ez;
}

/**
 * Douglas-Peucker: the indices of the points of a polyline (xyz triples,
 * `count` of them from `first`) to keep so that none dropped lies further
 * than `tolerance` from the kept line. Both ends are always kept; a closed
 * ring smaller than the tolerance keeps its farthest point as well, so an
 * island stays a mark rather than vanishing.
 */
export function simplifyPolyline(points: ArrayLike<number>, first: number, count: number, tolerance: number): number[] {
  const last = first + count - 1;
  if (count <= 2) return count === 2 ? [first, last] : [first];
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const toleranceSq = tolerance * tolerance;
  const stack: number[] = [first, last];
  let kept = 2;
  while (stack.length > 0) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    let worst = -1;
    let worstSq = toleranceSq;
    for (let i = a + 1; i < b; i++) {
      const d = distanceSqToSegment(points, i * 3, a * 3, b * 3);
      if (d > worstSq) {
        worstSq = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst - first] = 1;
      kept++;
      stack.push(a, worst, worst, b);
    }
  }
  if (kept === 2 && points[first * 3] === points[last * 3] && points[first * 3 + 1] === points[last * 3 + 1] && points[first * 3 + 2] === points[last * 3 + 2]) {
    let farthest = first + 1;
    let farthestSq = -1;
    for (let i = first + 1; i < last; i++) {
      const d = distanceSqToSegment(points, i * 3, first * 3, first * 3);
      if (d > farthestSq) {
        farthestSq = d;
        farthest = i;
      }
    }
    keep[farthest - first] = 1;
  }
  const indices: number[] = [];
  for (let i = 0; i < count; i++) if (keep[i]) indices.push(first + i);
  return indices;
}

/**
 * Cut line segments (absolute ECEF endpoints, six numbers each, as
 * outlineSegmentPositions gives them) into the cells of the sphere, each
 * with its lines as given and simplified to each of `tolerancesM`.
 * Consecutive segments that join end to start and share a cell are
 * simplified as one line; a line crossing into another cell is cut there,
 * both parts keeping the crossing point, so neighbouring cells still meet.
 */
export function buildOutlineCells(segments: Float32Array, tolerancesM: readonly number[] = SIMPLIFY_TOLERANCES_M): OutlineCell[] {
  const segmentCount = segments.length / 6;
  const fine: number[][] = Array.from({ length: CELL_COUNT }, () => []);
  const simplified: number[][][] = tolerancesM.map(() => Array.from({ length: CELL_COUNT }, () => []));
  // The run being gathered: points of one line inside one cell.
  let run: number[] = [];
  let runCell = -1;
  const flush = (): void => {
    if (run.length >= 6) {
      tolerancesM.forEach((tolerance, level) => {
        const kept = simplifyPolyline(run, 0, run.length / 3, tolerance);
        const out = simplified[level][runCell];
        for (let k = 1; k < kept.length; k++) {
          const a = kept[k - 1] * 3;
          const b = kept[k] * 3;
          out.push(run[a], run[a + 1], run[a + 2], run[b], run[b + 1], run[b + 2]);
        }
      });
    }
    run = [];
  };
  for (let s = 0; s < segmentCount; s++) {
    const o = s * 6;
    const cell = cellOf(segments[o] + segments[o + 3], segments[o + 1] + segments[o + 4], segments[o + 2] + segments[o + 5]);
    const joins =
      run.length > 0 &&
      cell === runCell &&
      run[run.length - 3] === segments[o] &&
      run[run.length - 2] === segments[o + 1] &&
      run[run.length - 1] === segments[o + 2];
    if (!joins) {
      flush();
      runCell = cell;
      run.push(segments[o], segments[o + 1], segments[o + 2]);
    }
    run.push(segments[o + 3], segments[o + 4], segments[o + 5]);
    fine[cell].push(segments[o], segments[o + 1], segments[o + 2], segments[o + 3], segments[o + 4], segments[o + 5]);
  }
  flush();

  const cells: OutlineCell[] = [];
  for (let cell = 0; cell < CELL_COUNT; cell++) {
    const points = fine[cell];
    if (points.length === 0) continue;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < points.length; i += 3) {
      cx += points[i];
      cy += points[i + 1];
      cz += points[i + 2];
    }
    const n = points.length / 3;
    cx /= n;
    cy /= n;
    cz /= n;
    let radiusSq = 0;
    for (let i = 0; i < points.length; i += 3) {
      radiusSq = Math.max(radiusSq, (points[i] - cx) ** 2 + (points[i + 1] - cy) ** 2 + (points[i + 2] - cz) ** 2);
    }
    const relative = (absolute: number[]): Float32Array => {
      const out = new Float32Array(absolute.length);
      for (let i = 0; i < absolute.length; i += 3) {
        out[i] = absolute[i] - cx;
        out[i + 1] = absolute[i + 1] - cy;
        out[i + 2] = absolute[i + 2] - cz;
      }
      return out;
    };
    cells.push({
      centre: [cx, cy, cz],
      radiusM: Math.sqrt(radiusSq),
      levels: [relative(points), ...simplified.map((level) => relative(level[cell]))],
    });
  }
  return cells;
}

/**
 * Which level a cell `distanceM` away should show: 0, the lines as given,
 * or the coarsest simplified level whose error, seen at that distance,
 * stays under SIMPLIFY_MAX_ERROR_PX. `pxPerRadian` is CSS pixels per radian
 * of view at the screen's centre.
 */
export function detailLevel(distanceM: number, pxPerRadian: number, tolerancesM: readonly number[] = SIMPLIFY_TOLERANCES_M): number {
  const perMetre = pxPerRadian / Math.max(distanceM, 1);
  let level = 0;
  for (let i = 0; i < tolerancesM.length; i++) {
    if (tolerancesM[i] * perMetre <= SIMPLIFY_MAX_ERROR_PX) level = i + 1;
  }
  return level;
}

/**
 * One cell's levels, showing whichever suits the camera about to draw it.
 * The renderer calls update(camera) on anything marked isLOD before each
 * render - so each eye of a stereo pair chooses for itself. Its parents
 * are never moved or turned, so its position is its world position.
 */
export class DetailSwitch extends THREE.Object3D {
  readonly isLOD = true;
  readonly autoUpdate = true;

  /** `levels`: the lines as given, then each simplified level, as the cell holds them. */
  constructor(
    private readonly levels: readonly THREE.Object3D[],
    private readonly radiusM: number,
    /** CSS-pixel height of the viewport being drawn into. */
    private readonly viewportHeight: { value: number }
  ) {
    super();
    levels.forEach((level, i) => {
      level.visible = i === 0;
      this.add(level);
    });
  }

  update(camera: THREE.Camera): void {
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 60;
    const pxPerRadian = this.viewportHeight.value / (2 * Math.tan((fov * Math.PI) / 360));
    // From the nearest the cell's lines can be to the eye.
    const shown = detailLevel(camera.position.distanceTo(this.position) - this.radiusM, pxPerRadian);
    for (let i = 0; i < this.levels.length; i++) this.levels[i].visible = i === shown;
  }
}
