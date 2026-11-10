import { describe, it, expect } from 'vitest';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { SLAB_PART, buildSlabMesh, parseSlabFile, slabDepthMarks, type SlabEntry } from './mesh';

interface TestSlab {
  readonly lon0: number;
  readonly lat0: number;
  readonly stepDeg: number;
  readonly columns: number;
  /** Row-major, row 0 first; null where the file stores no node. */
  readonly nodes: readonly ({ depthKm: number; thicknessKm: number; edgeCells: number } | null)[];
}

/** A slabs.bin holding the given slabs, laid out as tools/pipeline/generate_slabs.py writes it. */
function slabFile(slabs: readonly TestSlab[]): ArrayBuffer {
  const depthUnitKm = 1 / 80;
  const edgeUnitCells = 1 / 64;
  const payloads: Uint8Array[] = [];
  const entries: SlabEntry[] = [];
  let offset = 0;
  slabs.forEach((slab, index) => {
    const rows = slab.nodes.length / slab.columns;
    const runs: number[] = [];
    const stored: NonNullable<TestSlab['nodes'][number]>[] = [];
    for (let r = 0; r < rows; r++) {
      let c = 0;
      while (c < slab.columns) {
        if (slab.nodes[r * slab.columns + c] === null) {
          c++;
          continue;
        }
        const first = c;
        while (c < slab.columns && slab.nodes[r * slab.columns + c] !== null) stored[stored.length] = slab.nodes[r * slab.columns + c++]!;
        runs.splice(runs.length, 0, r, first, c - first);
      }
    }
    const size = runs.length * 2 + stored.length * 4;
    const bytes = new Uint8Array(size + (size % 2));
    const view = new DataView(bytes.buffer);
    runs.forEach((value, i) => view.setUint16(i * 2, value, true));
    const depths = runs.length * 2;
    stored.forEach((node, i) => {
      view.setUint16(depths + i * 2, Math.round(node.depthKm / depthUnitKm), true);
      view.setUint8(depths + stored.length * 2 + i, node.thicknessKm);
      view.setInt8(depths + stored.length * 3 + i, Math.round(node.edgeCells / edgeUnitCells));
    });
    entries[index] = {
      code: `t${index}`,
      name: `Test ${index}`,
      lon0: slab.lon0,
      lat0: slab.lat0,
      stepDeg: slab.stepDeg,
      columns: slab.columns,
      rows,
      runCount: runs.length / 3,
      vertexCount: stored.length,
      maxDepthKm: Math.max(...stored.filter((n) => n.edgeCells > 0).map((n) => n.depthKm)),
      label: { lon: slab.lon0, lat: slab.lat0, depthKm: 0 },
      offset,
    };
    payloads[index] = bytes;
    offset += bytes.length;
  });
  let header = JSON.stringify({ depthUnitKm, thicknessUnitKm: 1, edgeUnitCells, slabs: entries });
  header += ' '.repeat((4 - (header.length % 4)) % 4);
  const out = new Uint8Array(8 + header.length + offset);
  out.set([...'SLB1'].map((c) => c.charCodeAt(0)));
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(new TextEncoder().encode(header), 8);
  let at = 8 + header.length;
  for (const payload of payloads) {
    out.set(payload, at);
    at += payload.length;
  }
  return out.buffer;
}

/**
 * A 5 x 5 patch at the equator: a 3 x 3 block of slab, level at 100 km and
 * 50 km thick, inside one ring of nodes beyond its edge. Edge distances put
 * the outline half a cell past the block on every side.
 */
function flatSlab(): TestSlab {
  const nodes: TestSlab['nodes'][number][] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const ring = Math.max(Math.abs(r - 2), Math.abs(c - 2));
      nodes[r * 5 + c] = { depthKm: 100, thicknessKm: 50, edgeCells: ring === 2 ? -0.5 : ring === 1 ? 0.5 : 1.5 };
    }
  }
  return { lon0: 140, lat0: -0.4, stepDeg: 0.2, columns: 5, nodes };
}

const vertexAt = (positions: Float32Array, vertex: number): [number, number, number] => [
  positions[vertex * 3],
  positions[vertex * 3 + 1],
  positions[vertex * 3 + 2],
];
const depthKmOf = ([x, y, z]: [number, number, number]): number => (EARTH_RADIUS_M - Math.hypot(x, y, z)) / 1000;
const lonOf = ([x, y]: [number, number, number]): number => (Math.atan2(y, x) * 180) / Math.PI;
const latOf = ([x, y, z]: [number, number, number]): number => (Math.asin(z / Math.hypot(x, y, z)) * 180) / Math.PI;

describe('parseSlabFile', () => {
  it('reads each node back at its place on the grid', () => {
    const slab = flatSlab();
    const sparse: TestSlab = { ...slab, nodes: slab.nodes.map((node, i) => (i === 0 || i === 12 ? null : node)) };
    const { grids } = parseSlabFile(slabFile([slab, sparse]));
    expect(grids).toHaveLength(2);
    expect(grids[0].entry.vertexCount).toBe(25);
    expect([...grids[0].stored]).toEqual(new Array(25).fill(1));
    expect(grids[0].depthKm[12]).toBeCloseTo(100, 6);
    expect(grids[0].thicknessKm[12]).toBe(50);
    expect(grids[0].edgeCells[12]).toBeCloseTo(1.5, 6);
    expect(grids[0].edgeCells[0]).toBeCloseTo(-0.5, 6);
    // The second slab's payload starts after the first's; its gaps stay gaps.
    expect(grids[1].entry.vertexCount).toBe(23);
    expect(grids[1].stored[0]).toBe(0);
    expect(grids[1].stored[12]).toBe(0);
    expect(grids[1].stored[13]).toBe(1);
    expect(grids[1].edgeCells[13]).toBeCloseTo(0.5, 6);
  });

  it('rejects a file that is not slabs.bin', () => {
    expect(() => parseSlabFile(new TextEncoder().encode('{"contours":[]}').buffer)).toThrow(/SLB1/);
  });
});

describe('buildSlabMesh', () => {
  const { grids } = parseSlabFile(slabFile([flatSlab()]));
  const mesh = buildSlabMesh(grids);
  const vertexCount = mesh.positions.length / 3;
  const part = (v: number): number => mesh.info[v * 2];
  const tops = [...Array(vertexCount).keys()].filter((v) => part(v) === SLAB_PART.top);
  const bottoms = [...Array(vertexCount).keys()].filter((v) => part(v) === SLAB_PART.bottom);
  const walls = [...Array(vertexCount).keys()].filter((v) => part(v) === SLAB_PART.wall);

  it('cuts the outline between nodes, where the edge distance crosses zero', () => {
    // The block spans columns 1..3 (140.2..140.6 E); half a cell further is 140.1..140.7.
    const lons = tops.map((v) => lonOf(vertexAt(mesh.positions, v)));
    const lats = tops.map((v) => latOf(vertexAt(mesh.positions, v)));
    expect(Math.min(...lons)).toBeCloseTo(140.1, 4);
    expect(Math.max(...lons)).toBeCloseTo(140.7, 4);
    expect(Math.min(...lats)).toBeCloseTo(-0.3, 4);
    expect(Math.max(...lats)).toBeCloseTo(0.3, 4);
    // 9 nodes, and a crossing on each of the 12 grid edges leaving the block.
    expect(tops).toHaveLength(21);
  });

  it('puts the top at the slab depth and the bottom one thickness below, along the normal', () => {
    for (const v of tops) {
      expect(depthKmOf(vertexAt(mesh.positions, v))).toBeCloseTo(100, 2);
      // A level slab: its normal is straight up.
      const [x, y, z] = vertexAt(mesh.positions, v);
      const r = Math.hypot(x, y, z);
      const [nx, ny, nz] = vertexAt(mesh.normals, v);
      expect(nx * (x / r) + ny * (y / r) + nz * (z / r)).toBeCloseTo(1, 4);
    }
    expect(bottoms).toHaveLength(tops.length);
    for (const v of bottoms) expect(depthKmOf(vertexAt(mesh.positions, v))).toBeCloseTo(150, 1);
  });

  it('measures each vertex from the outline in km, zero on it', () => {
    const edgeKm = tops.map((v) => mesh.info[v * 2 + 1]);
    expect(Math.min(...edgeKm)).toBe(0);
    // The centre node is 1.5 cells of 0.2 deg in: 33.4 km.
    expect(Math.max(...edgeKm)).toBeCloseTo(1.5 * 0.2 * 111.19, 1);
    for (const v of walls) expect(mesh.info[v * 2 + 1]).toBe(0);
  });

  it('closes the plate: every edge of every triangle is shared with exactly one other', () => {
    // Walls have vertices of their own, so match edges by position.
    const key = (v: number): string =>
      vertexAt(mesh.positions, v)
        .map((n) => Math.round(n))
        .join(',');
    const uses = new Map<string, number>();
    for (let t = 0; t < mesh.indices.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = key(mesh.indices[t + k]);
        const b = key(mesh.indices[t + ((k + 1) % 3)]);
        const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
        uses.set(edge, (uses.get(edge) ?? 0) + 1);
      }
    }
    expect([...uses.values()].every((count) => count === 2)).toBe(true);
  });

  it('walls the outline, facing outward', () => {
    // 12 crossings and no corner nodes outside: the outline has 12 edges, 4 wall vertices each.
    expect(walls).toHaveLength(12 * 4);
    const centre = vertexAt(mesh.positions, tops[tops.findIndex((v) => mesh.info[v * 2 + 1] > 30)]);
    for (const v of walls) {
      const p = vertexAt(mesh.positions, v);
      const n = vertexAt(mesh.normals, v);
      const outward = (p[0] - centre[0]) * n[0] + (p[1] - centre[1]) * n[1] + (p[2] - centre[2]) * n[2];
      expect(outward).toBeGreaterThan(0);
    }
  });

  it('counts the triangles of the tops', () => {
    expect(mesh.topTriangles).toBeGreaterThan(0);
    // Top and bottom alike, plus two per outline edge.
    expect(mesh.indices.length / 3).toBe(mesh.topTriangles * 2 + 12 * 2);
  });
});

describe('a dipping slab', () => {
  // Depth grows 20 km per 0.2 deg cell eastward: a dip of 42 deg.
  const flat = flatSlab();
  const dipping: TestSlab = { ...flat, nodes: flat.nodes.map((node, i) => ({ ...node!, depthKm: 100 + 20 * (i % 5) })) };
  const { grids } = parseSlabFile(slabFile([dipping]));
  const mesh = buildSlabMesh(grids);

  it('tilts its normals with the dip and hangs the underside square to the surface, not straight down', () => {
    const centre = [...Array(mesh.positions.length / 3).keys()].find((v) => mesh.info[v * 2] === SLAB_PART.top && mesh.info[v * 2 + 1] > 30)!;
    const [nx, ny] = vertexAt(mesh.normals, centre);
    // At 140.4 E on the equator east is (-sin, cos, 0). A surface falling away
    // to the east faces up and east, by the sine of its dip.
    const lon = (140.4 * Math.PI) / 180;
    const eastward = -nx * Math.sin(lon) + ny * Math.cos(lon);
    expect(eastward).toBeCloseTo(Math.sin(Math.atan2(20, 0.2 * 111.19 * ((6371 - 140) / 6371))), 2);
    // The bottom twin of the centre node: 50 km away, but less than 50 km deeper.
    const topCount = [...Array(mesh.positions.length / 3).keys()].filter((v) => mesh.info[v * 2] === SLAB_PART.top).length;
    const top = vertexAt(mesh.positions, centre);
    const bottom = vertexAt(mesh.positions, centre + topCount);
    expect(Math.hypot(top[0] - bottom[0], top[1] - bottom[1], top[2] - bottom[2]) / 1000).toBeCloseTo(50, 3);
    expect(depthKmOf(bottom) - depthKmOf(top)).toBeLessThan(40);
  });

  it('marks each 100 km contour that crosses it, clear of the edge', () => {
    // Only the centre column is more than a cell from the outline; it sits at 140 km.
    expect(slabDepthMarks(grids[0], 100)).toEqual([]);
    const marks = slabDepthMarks(grids[0], 140);
    expect(marks).toHaveLength(1);
    expect(marks[0].contourKm).toBe(140);
    expect(marks[0].lon).toBeCloseTo(140.4, 6);
    expect(marks[0].depthKm).toBeCloseTo(140, 3);
  });
});
