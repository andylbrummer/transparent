/**
 * HEALPix, nested scheme: the equal-area tiling of the sphere that
 * all-sky surveys are cut into (Gorski et al. 2005, ApJ 622:759). Twelve
 * base faces, each split in four at every order; a pixel of order k is
 * named by its face and by (ix, iy) within the face, x running toward the
 * face's north-east edge and y toward its north-west one, their bits
 * interleaved into one number.
 *
 * Only what drawing survey tiles needs: where a point of a pixel is on the
 * sky, which pixel holds a direction, which pixels a disc touches. Held to
 * healpy in healpix.test.ts.
 */

type Vec3Tuple = readonly [number, number, number];

/** Ring number of each face's northern corner, and its longitude in units of 45°. */
const JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4];
const JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7];

/** Orders above this would overflow the exact integers of a double once interleaved. */
export const HEALPIX_MAX_ORDER = 24;

export function healpixPixelCount(order: number): number {
  return 12 * 4 ** order;
}

export interface HealpixFaceXy {
  readonly face: number;
  readonly ix: number;
  readonly iy: number;
}

export function healpixNestedToFaceXy(order: number, ipix: number): HealpixFaceXy {
  const perFace = 4 ** order;
  const face = Math.floor(ipix / perFace);
  let rest = ipix - face * perFace;
  let ix = 0;
  let iy = 0;
  // Division, not shifts: the index passes 2^31 at order 14.
  for (let bit = 0; bit < order; bit++) {
    const pair = rest % 4;
    rest = (rest - pair) / 4;
    ix += (pair & 1) * 2 ** bit;
    iy += (pair >> 1) * 2 ** bit;
  }
  return { face, ix, iy };
}

export function healpixFaceXyToNested(order: number, face: number, ix: number, iy: number): number {
  let ipix = 0;
  for (let bit = order - 1; bit >= 0; bit--) {
    const scale = 2 ** bit;
    ipix = ipix * 4 + (Math.floor(ix / scale) % 2) + 2 * (Math.floor(iy / scale) % 2);
  }
  return face * 4 ** order + ipix;
}

/** The point at (x, y) of a base face, each in [0, 1], as a unit vector (z the pole, x toward longitude 0). */
export function healpixFaceXyToUnit(face: number, x: number, y: number): [number, number, number] {
  const jr = JRLL[face] - x - y;
  let nr: number;
  let z: number;
  if (jr < 1) {
    // North polar cap.
    nr = jr;
    z = 1 - (nr * nr) / 3;
  } else if (jr > 3) {
    nr = 4 - jr;
    z = (nr * nr) / 3 - 1;
  } else {
    nr = 1;
    z = ((2 - jr) * 2) / 3;
  }
  let tmp = JPLL[face] * nr + x - y;
  if (tmp < 0) tmp += 8;
  if (tmp >= 8) tmp -= 8;
  const phi = nr < 1e-15 ? 0 : ((Math.PI / 4) * tmp) / nr;
  const s = Math.sqrt(Math.max(0, 1 - z * z));
  return [s * Math.cos(phi), s * Math.sin(phi), z];
}

/** The point at (u, v) of a pixel, each in [0, 1]: (0, 0) its south corner, (1, 1) north, (1, 0) east, (0, 1) west. */
export function healpixPixelPoint(order: number, ipix: number, u: number, v: number): [number, number, number] {
  const { face, ix, iy } = healpixNestedToFaceXy(order, ipix);
  const nside = 2 ** order;
  return healpixFaceXyToUnit(face, (ix + u) / nside, (iy + v) / nside);
}

/** The pixel of `order` that holds a direction. */
export function healpixUnitToNested(order: number, direction: Vec3Tuple): number {
  const nside = 2 ** order;
  const norm = Math.hypot(direction[0], direction[1], direction[2]);
  const z = direction[2] / norm;
  const za = Math.abs(z);
  let tt = Math.atan2(direction[1], direction[0]) / (Math.PI / 2);
  if (tt < 0) tt += 4;
  if (tt >= 4) tt -= 4;
  let face: number;
  let ix: number;
  let iy: number;
  if (za <= 2 / 3) {
    const temp1 = nside * (0.5 + tt);
    const temp2 = nside * z * 0.75;
    const jp = Math.floor(temp1 - temp2);
    const jm = Math.floor(temp1 + temp2);
    const ifp = Math.floor(jp / nside);
    const ifm = Math.floor(jm / nside);
    face = ifp === ifm ? (ifp % 4) + 4 : ifp < ifm ? ifp : ifm + 8;
    ix = jm % nside;
    iy = nside - (jp % nside) - 1;
  } else {
    const ntt = Math.min(3, Math.floor(tt));
    const tp = tt - ntt;
    // sqrt(3 (1 - |z|)), from the direction's own xy length near the pole, where 1 - |z| loses digits.
    const sinTheta = Math.hypot(direction[0], direction[1]) / norm;
    const tmp = nside * (za > 0.99 ? sinTheta * Math.sqrt(3 / (1 + za)) : Math.sqrt(3 * (1 - za)));
    const jp = Math.min(nside - 1, Math.floor(tp * tmp));
    const jm = Math.min(nside - 1, Math.floor((1 - tp) * tmp));
    if (z >= 0) {
      face = ntt;
      ix = nside - jm - 1;
      iy = nside - jp - 1;
    } else {
      face = ntt + 8;
      ix = jp;
      iy = jm;
    }
  }
  return healpixFaceXyToNested(order, face, ix, iy);
}

const angleBetween = (a: Vec3Tuple, b: Vec3Tuple): number => {
  const cross = Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
  return Math.atan2(cross, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
};

const CORNERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

/**
 * Pixels of `order` that a disc of `radiusRad` about `direction` may
 * touch: every one whose bounding circle reaches the disc, so a superset
 * of those that truly overlap, never missing one. Nearest first; at most
 * `limit` of them.
 */
export function healpixPixelsInDisc(order: number, direction: Vec3Tuple, radiusRad: number, limit = Infinity): number[] {
  const norm = Math.hypot(direction[0], direction[1], direction[2]);
  const d: Vec3Tuple = [direction[0] / norm, direction[1] / norm, direction[2] / norm];
  const found: { ipix: number; distance: number }[] = [];
  const visit = (level: number, ipix: number): void => {
    const centre = healpixPixelPoint(level, ipix, 0.5, 0.5);
    let bound = 0;
    for (const [u, v] of CORNERS) bound = Math.max(bound, angleBetween(centre, healpixPixelPoint(level, ipix, u, v)));
    const distance = angleBetween(centre, d);
    if (distance > radiusRad + bound) return;
    if (level === order) {
      found.push({ ipix, distance });
      return;
    }
    for (let child = 0; child < 4; child++) visit(level + 1, ipix * 4 + child);
  };
  for (let face = 0; face < 12; face++) visit(0, face);
  found.sort((a, b) => a.distance - b.distance);
  return (found.length > limit ? found.slice(0, limit) : found).map((entry) => entry.ipix);
}

export interface HealpixWindow {
  /** The ancestor pixel. */
  readonly ipix: number;
  /** Where the descendant's south corner sits in the ancestor's (u, v), and its width there. */
  readonly u0: number;
  readonly v0: number;
  readonly size: number;
}

/** Where a pixel of `order` sits inside its ancestor of `ancestorOrder`. */
export function healpixAncestorWindow(order: number, ipix: number, ancestorOrder: number): HealpixWindow {
  const levels = order - ancestorOrder;
  const span = 2 ** levels;
  const { ix, iy } = healpixNestedToFaceXy(order, ipix);
  return { ipix: Math.floor(ipix / 4 ** levels), u0: (ix % span) / span, v0: (iy % span) / span, size: 1 / span };
}
