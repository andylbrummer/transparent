/**
 * Subducting slabs as solid plates: reads app/public/geo/slabs.bin
 * (tools/pipeline/generate_slabs.py - Slab2's depth and thickness grids,
 * sampled) and builds the triangles the layer draws.
 *
 * A slab arrives as a grid of nodes over longitude and latitude, each with
 * the depth of the slab's top, the plate's thickness there, and its
 * distance from the slab's edge. The top surface is the grid's cells, cut
 * where that distance crosses zero, so the outline runs between nodes
 * instead of in grid steps. The bottom is the top moved down its own
 * normal by the thickness, and walls close the edge between the two, so
 * each slab is a watertight plate with Slab2's thickness.
 *
 * No three.js here: plain arrays in, plain arrays out.
 */

import { EARTH_RADIUS_M } from '@transparent-earth/core';

const EARTH_RADIUS_KM = EARTH_RADIUS_M / 1000;
const KM_PER_DEGREE = (Math.PI * EARTH_RADIUS_KM) / 180;

/** One slab's entry in the header of slabs.bin. */
export interface SlabEntry {
  readonly code: string;
  /** Slab2's region name, e.g. "Cascadia". */
  readonly name: string;
  /** Longitude (0-360) and latitude of row 0, column 0. */
  readonly lon0: number;
  readonly lat0: number;
  readonly stepDeg: number;
  readonly columns: number;
  readonly rows: number;
  readonly runCount: number;
  readonly vertexCount: number;
  readonly maxDepthKm: number;
  /** A node near the middle of the slab, for its name. */
  readonly label: { readonly lon: number; readonly lat: number; readonly depthKm: number };
  /** Byte offset of this slab in the payload. */
  readonly offset: number;
}

export interface SlabHeader {
  readonly depthUnitKm: number;
  readonly thicknessUnitKm: number;
  readonly edgeUnitCells: number;
  readonly slabs: readonly SlabEntry[];
}

/** A slab's nodes on its full grid; `stored` is 0 where the file holds no node. */
export interface SlabGrid {
  readonly entry: SlabEntry;
  readonly stored: Uint8Array;
  readonly depthKm: Float32Array;
  readonly thicknessKm: Float32Array;
  /** Distance from the slab's edge in cells: positive inside, zero on the outline. */
  readonly edgeCells: Float32Array;
}

const MAGIC = 'SLB1';

/** Split slabs.bin into its header and one grid per slab. */
export function parseSlabFile(buffer: ArrayBuffer): { header: SlabHeader; grids: SlabGrid[] } {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== MAGIC) throw new Error(`slabs.bin: expected ${MAGIC}, found ${JSON.stringify(magic)}`);
  const headerLength = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength))) as SlabHeader;
  const payloadStart = 8 + headerLength;
  const grids = header.slabs.map((entry): SlabGrid => {
    const size = entry.columns * entry.rows;
    const stored = new Uint8Array(size);
    const depthKm = new Float32Array(size);
    const thicknessKm = new Float32Array(size);
    const edgeCells = new Float32Array(size);
    const runs = payloadStart + entry.offset;
    const depths = runs + entry.runCount * 6;
    const thicknesses = depths + entry.vertexCount * 2;
    const edges = thicknesses + entry.vertexCount;
    let node = 0;
    for (let run = 0; run < entry.runCount; run++) {
      const row = view.getUint16(runs + run * 6, true);
      const first = view.getUint16(runs + run * 6 + 2, true);
      const length = view.getUint16(runs + run * 6 + 4, true);
      for (let i = 0; i < length; i++, node++) {
        const cell = row * entry.columns + first + i;
        stored[cell] = 1;
        depthKm[cell] = view.getUint16(depths + node * 2, true) * header.depthUnitKm;
        thicknessKm[cell] = view.getUint8(thicknesses + node) * header.thicknessUnitKm;
        edgeCells[cell] = view.getInt8(edges + node) * header.edgeUnitCells;
      }
    }
    if (node !== entry.vertexCount) throw new Error(`slabs.bin: ${entry.code} holds ${node} nodes, header says ${entry.vertexCount}`);
    return { entry, stored, depthKm, thicknessKm, edgeCells };
  });
  return { header, grids };
}

/** Which face of the plate a vertex belongs to. */
export const SLAB_PART = { top: 0, bottom: 1, wall: 2 } as const;

export interface SlabMesh {
  /** ECEF metres. */
  readonly positions: Float32Array;
  /** Unit normals: up out of the top, down out of the bottom, outward from the walls. */
  readonly normals: Float32Array;
  /** Per vertex: SLAB_PART, then km in from the slab's outline along the surface (0 on walls). */
  readonly info: Float32Array;
  readonly indices: Uint32Array;
  /** Triangles in the top surfaces alone. */
  readonly topTriangles: number;
}

/** A growing set of surface points in grid terms. */
interface Surface {
  readonly lon: number[];
  readonly lat: number[];
  readonly depthKm: number[];
  readonly thicknessKm: number[];
  readonly edgeKm: number[];
  /** Unit normal of the top surface, pointing up. */
  readonly normal: number[];
  readonly triangles: number[];
}

function ecefKm(lonDeg: number, latDeg: number, depthKm: number, out: Float64Array, at: number): void {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const radius = EARTH_RADIUS_KM - depthKm;
  out[at] = radius * Math.cos(lat) * Math.cos(lon);
  out[at + 1] = radius * Math.cos(lat) * Math.sin(lon);
  out[at + 2] = radius * Math.sin(lat);
}

/**
 * Unit normals of the slab's top at every stored node, pointing up.
 *
 * Taken from the grid, not from the clipped triangles: the slivers the
 * outline cuts have normals of their own, and a plate's underside, hung
 * from them, would come out ragged. A node inside the slab differences its
 * inside neighbours (the ring outside only repeats the edge's depth); a
 * ring node takes the mean of the inside nodes around it.
 */
function nodeNormals(grid: SlabGrid): Float64Array {
  const { entry, stored, depthKm, edgeCells } = grid;
  const { columns, rows, stepDeg } = entry;
  const position = new Float64Array(columns * rows * 3);
  for (let cell = 0; cell < columns * rows; cell++) {
    if (!stored[cell]) continue;
    ecefKm(entry.lon0 + (cell % columns) * stepDeg, entry.lat0 + Math.floor(cell / columns) * stepDeg, depthKm[cell], position, cell * 3);
  }
  const inside = (r: number, c: number): boolean => r >= 0 && r < rows && c >= 0 && c < columns && edgeCells[r * columns + c] > 0;
  const normal = new Float64Array(columns * rows * 3);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const cell = r * columns + c;
      if (!inside(r, c)) continue;
      const east = (inside(r, c + 1) ? cell + 1 : cell) * 3;
      const west = (inside(r, c - 1) ? cell - 1 : cell) * 3;
      const north = (inside(r + 1, c) ? cell + columns : cell) * 3;
      const south = (inside(r - 1, c) ? cell - columns : cell) * 3;
      const ux = position[east] - position[west];
      const uy = position[east + 1] - position[west + 1];
      const uz = position[east + 2] - position[west + 2];
      const vx = position[north] - position[south];
      const vy = position[north + 1] - position[south + 1];
      const vz = position[north + 2] - position[south + 2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      let length = Math.hypot(nx, ny, nz);
      if (length === 0) {
        // A node with no inside neighbour along one axis: straight up.
        nx = position[cell * 3];
        ny = position[cell * 3 + 1];
        nz = position[cell * 3 + 2];
        length = Math.hypot(nx, ny, nz);
      }
      normal[cell * 3] = nx / length;
      normal[cell * 3 + 1] = ny / length;
      normal[cell * 3 + 2] = nz / length;
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const cell = r * columns + c;
      if (!stored[cell] || inside(r, c)) continue;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!inside(r + dr, c + dc)) continue;
          const neighbour = ((r + dr) * columns + c + dc) * 3;
          nx += normal[neighbour];
          ny += normal[neighbour + 1];
          nz += normal[neighbour + 2];
        }
      }
      let length = Math.hypot(nx, ny, nz);
      if (length === 0) {
        nx = position[cell * 3];
        ny = position[cell * 3 + 1];
        nz = position[cell * 3 + 2];
        length = Math.hypot(nx, ny, nz);
      }
      normal[cell * 3] = nx / length;
      normal[cell * 3 + 1] = ny / length;
      normal[cell * 3 + 2] = nz / length;
    }
  }
  return normal;
}

/**
 * The top surface of one slab: grid cells clipped to the inside of the
 * outline. Triangles wind counter-clockwise seen from above.
 */
function clipSurface(grid: SlabGrid): Surface {
  const { entry, stored, depthKm, thicknessKm, edgeCells } = grid;
  const { columns, rows, stepDeg } = entry;
  const surface: Surface = { lon: [], lat: [], depthKm: [], thicknessKm: [], edgeKm: [], normal: [], triangles: [] };
  const normals = nodeNormals(grid);
  const kmPerCell = stepDeg * KM_PER_DEGREE;
  const nodeVertex = new Int32Array(columns * rows).fill(-1);
  // A crossing on the edge from a node to its east (2n) or north (2n + 1) neighbour.
  const crossingVertex = new Map<number, number>();

  const node = (cell: number): number => {
    if (nodeVertex[cell] < 0) {
      nodeVertex[cell] = surface.lon.length;
      surface.lon.push(entry.lon0 + (cell % columns) * stepDeg);
      surface.lat.push(entry.lat0 + Math.floor(cell / columns) * stepDeg);
      surface.depthKm.push(depthKm[cell]);
      surface.thicknessKm.push(thicknessKm[cell]);
      surface.edgeKm.push(edgeCells[cell] * kmPerCell);
      surface.normal.push(normals[cell * 3], normals[cell * 3 + 1], normals[cell * 3 + 2]);
    }
    return nodeVertex[cell];
  };
  const crossing = (a: number, b: number): number => {
    const low = Math.min(a, b);
    const key = low * 2 + (Math.abs(a - b) === 1 ? 0 : 1);
    let vertex = crossingVertex.get(key);
    if (vertex === undefined) {
      const t = edgeCells[a] / (edgeCells[a] - edgeCells[b]);
      const mix = (values: Float32Array): number => values[a] + (values[b] - values[a]) * t;
      const column = (a % columns) + ((b % columns) - (a % columns)) * t;
      const row = Math.floor(a / columns) + (Math.floor(b / columns) - Math.floor(a / columns)) * t;
      vertex = surface.lon.length;
      surface.lon.push(entry.lon0 + column * stepDeg);
      surface.lat.push(entry.lat0 + row * stepDeg);
      surface.depthKm.push(mix(depthKm));
      surface.thicknessKm.push(mix(thicknessKm));
      surface.edgeKm.push(0);
      let nx = normals[a * 3] + (normals[b * 3] - normals[a * 3]) * t;
      let ny = normals[a * 3 + 1] + (normals[b * 3 + 1] - normals[a * 3 + 1]) * t;
      let nz = normals[a * 3 + 2] + (normals[b * 3 + 2] - normals[a * 3 + 2]) * t;
      const length = Math.hypot(nx, ny, nz);
      surface.normal.push((nx /= length), (ny /= length), (nz /= length));
      crossingVertex.set(key, vertex);
    }
    return vertex;
  };

  const corners = [0, 0, 0, 0];
  const polygon: number[] = [];
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < columns; c++) {
      // Counter-clockwise from above: south-west, south-east, north-east, north-west.
      corners[0] = r * columns + c;
      corners[1] = corners[0] + 1;
      corners[2] = corners[1] + columns;
      corners[3] = corners[0] + columns;
      if (!(stored[corners[0]] && stored[corners[1]] && stored[corners[2]] && stored[corners[3]])) continue;
      polygon.length = 0;
      for (let k = 0; k < 4; k++) {
        const here = corners[k];
        const next = corners[(k + 1) % 4];
        const inside = edgeCells[here] > 0;
        if (inside) polygon.push(node(here));
        if (inside !== edgeCells[next] > 0) polygon.push(crossing(here, next));
      }
      for (let k = 1; k + 1 < polygon.length; k++) surface.triangles.push(polygon[0], polygon[k], polygon[k + 1]);
    }
  }
  return surface;
}

/**
 * Every slab as one mesh of closed plates: top, bottom and edge walls.
 */
export function buildSlabMesh(grids: readonly SlabGrid[]): SlabMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const info: number[] = [];
  const indices: number[] = [];
  let topTriangles = 0;

  for (const grid of grids) {
    const surface = clipSurface(grid);
    const count = surface.lon.length;
    if (count === 0) continue;
    const triangles = surface.triangles;
    topTriangles += triangles.length / 3;

    // Positions in km, in doubles: walls come from differences of ~6000 km vectors.
    const top = new Float64Array(count * 3);
    for (let v = 0; v < count; v++) ecefKm(surface.lon[v], surface.lat[v], surface.depthKm[v], top, v * 3);
    const normal = surface.normal;

    const base = positions.length / 3;
    // Top, then bottom: vertex v of the bottom is base + count + v.
    for (let v = 0; v < count; v++) {
      positions.push(top[v * 3] * 1000, top[v * 3 + 1] * 1000, top[v * 3 + 2] * 1000);
      normals.push(normal[v * 3], normal[v * 3 + 1], normal[v * 3 + 2]);
      info.push(SLAB_PART.top, surface.edgeKm[v]);
    }
    const bottom = new Float64Array(count * 3);
    for (let v = 0; v < count; v++) {
      const thickness = surface.thicknessKm[v];
      for (let k = 0; k < 3; k++) bottom[v * 3 + k] = top[v * 3 + k] - normal[v * 3 + k] * thickness;
      positions.push(bottom[v * 3] * 1000, bottom[v * 3 + 1] * 1000, bottom[v * 3 + 2] * 1000);
      normals.push(-normal[v * 3], -normal[v * 3 + 1], -normal[v * 3 + 2]);
      info.push(SLAB_PART.bottom, surface.edgeKm[v]);
    }
    for (let t = 0; t < triangles.length; t += 3) {
      indices.push(base + triangles[t], base + triangles[t + 1], base + triangles[t + 2]);
      indices.push(base + count + triangles[t], base + count + triangles[t + 2], base + count + triangles[t + 1]);
    }

    // An edge with no triangle on its other side is the outline: wall it.
    const directed = new Set<number>();
    for (let t = 0; t < triangles.length; t += 3) {
      for (let k = 0; k < 3; k++) directed.add(triangles[t + k] * count + triangles[t + ((k + 1) % 3)]);
    }
    for (let t = 0; t < triangles.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = triangles[t + k];
        const b = triangles[t + ((k + 1) % 3)];
        if (directed.has(b * count + a)) continue;
        // The slab is on the left of a -> b seen from above, so outward is along-edge x up.
        const ex = top[b * 3] - top[a * 3];
        const ey = top[b * 3 + 1] - top[a * 3 + 1];
        const ez = top[b * 3 + 2] - top[a * 3 + 2];
        const ux = normal[a * 3] + normal[b * 3];
        const uy = normal[a * 3 + 1] + normal[b * 3 + 1];
        const uz = normal[a * 3 + 2] + normal[b * 3 + 2];
        let ox = ey * uz - ez * uy;
        let oy = ez * ux - ex * uz;
        let oz = ex * uy - ey * ux;
        const length = Math.hypot(ox, oy, oz) || 1;
        ox /= length;
        oy /= length;
        oz /= length;
        const wall = positions.length / 3;
        for (const [source, vertex] of [
          [top, a],
          [top, b],
          [bottom, b],
          [bottom, a],
        ] as const) {
          positions.push(source[vertex * 3] * 1000, source[vertex * 3 + 1] * 1000, source[vertex * 3 + 2] * 1000);
          normals.push(ox, oy, oz);
          info.push(SLAB_PART.wall, 0);
        }
        // Seen from outside the plate, a -> b runs right to left: wind b, a, a', b'.
        indices.push(wall + 1, wall, wall + 3, wall + 1, wall + 3, wall + 2);
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    info: new Float32Array(info),
    indices: new Uint32Array(indices),
    topTriangles,
  };
}

export interface SlabDepthMark {
  readonly lon: number;
  readonly lat: number;
  readonly depthKm: number;
  /** The contour it marks: a whole multiple of the interval. */
  readonly contourKm: number;
}

/** A node within this of a contour's depth can carry its mark. */
const MARK_TOLERANCE_KM = 6;

/**
 * One point on each `intervalKm` depth contour of a slab, about half way
 * along it, where the contour's depth can be written.
 */
export function slabDepthMarks(grid: SlabGrid, intervalKm: number): SlabDepthMark[] {
  const { entry, depthKm, edgeCells } = grid;
  const marks: SlabDepthMark[] = [];
  for (let contourKm = intervalKm; contourKm <= entry.maxDepthKm; contourKm += intervalKm) {
    const cells: number[] = [];
    for (let cell = 0; cell < depthKm.length; cell++) {
      // Clear of the outline, so the mark sits on the sheet.
      if (edgeCells[cell] > 1 && Math.abs(depthKm[cell] - contourKm) <= MARK_TOLERANCE_KM) cells.push(cell);
    }
    if (cells.length === 0) continue;
    const cell = cells[cells.length >> 1];
    marks.push({
      lon: entry.lon0 + (cell % entry.columns) * entry.stepDeg,
      lat: entry.lat0 + Math.floor(cell / entry.columns) * entry.stepDeg,
      depthKm: depthKm[cell],
      contourKm,
    });
  }
  return marks;
}
