import { describe, it, expect } from 'vitest';
import { raDecToUnit } from '@transparent-earth/core';
import {
  buildCloud,
  buildMarkers,
  buildOutlines,
  catalogLabels,
  ellipseSegments,
  hexToRgb,
  rampColor,
  splitFeatured,
  type CatalogData,
} from './catalog';
import { DEEP_SKY_SPECS, classLegend, specCaption, type CatalogSpec, type CloudSpec } from './specs';

/** The baked catalogues themselves, by path under app/: what the app will fetch. */
const BAKED = import.meta.glob<CatalogData & { count?: number }>('/public/sky/deep/*.json', { eager: true, import: 'default' });
const baked = (file: string): CatalogData & { count?: number } => BAKED[`/public/${file}`];
const DEG = Math.PI / 180;

/** Offsets of an outline's points from its centre: [east, north] in degrees, small-angle. */
function offsets(centerRa: number, centerDec: number, segments: number[]): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i < segments.length; i += 6) {
    const [x, y, z] = segments.slice(i, i + 3);
    const ra = Math.atan2(y, x) / DEG;
    const dec = Math.asin(z) / DEG;
    points.push([(((ra - centerRa + 540) % 360) - 180) * Math.cos(centerDec * DEG), dec - centerDec]);
  }
  return points;
}

describe('ellipseSegments', () => {
  it('draws a circle of the given angular diameter', () => {
    const out: number[] = [];
    const center = raDecToUnit(80, -69);
    ellipseSegments(center, 600, 600, -1, out);
    for (let i = 0; i < out.length; i += 3) {
      const dot = out[i] * center[0] + out[i + 1] * center[1] + out[i + 2] * center[2];
      // 600′ across: every point 5° from the centre.
      expect(Math.acos(dot) / DEG).toBeCloseTo(5, 6);
    }
    // Closed: the last segment ends where the first began.
    expect(out.slice(-3)).toEqual([expect.closeTo(out[0], 9), expect.closeTo(out[1], 9), expect.closeTo(out[2], 9)]);
  });

  it('lays the major axis north-south at position angle 0 and east-west at 90', () => {
    const northSouth: number[] = [];
    ellipseSegments(raDecToUnit(10, 41), 180, 60, 0, northSouth);
    const ns = offsets(10, 41, northSouth);
    expect(Math.max(...ns.map(([, north]) => Math.abs(north)))).toBeCloseTo(1.5, 2);
    expect(Math.max(...ns.map(([east]) => Math.abs(east)))).toBeCloseTo(0.5, 1);

    const eastWest: number[] = [];
    ellipseSegments(raDecToUnit(10, 41), 180, 60, 90, eastWest);
    const ew = offsets(10, 41, eastWest);
    expect(Math.max(...ew.map(([east]) => Math.abs(east)))).toBeCloseTo(1.5, 1);
    expect(Math.max(...ew.map(([, north]) => Math.abs(north)))).toBeCloseTo(0.5, 2);
  });

  it('turns the major axis from north toward east, as position angles are measured', () => {
    // M31: 178′ × 70′ at position angle 35°. Its far tips lie to the north-east and the south-west.
    const out: number[] = [];
    ellipseSegments(raDecToUnit(10.685, 41.269), 178, 70, 35, out);
    const points = offsets(10.685, 41.269, out);
    const tip = points.reduce((far, p) => (Math.hypot(...p) > Math.hypot(...far) ? p : far));
    expect(Math.hypot(...tip)).toBeCloseTo(178 / 120, 1);
    // East and north offsets share a sign at both tips, and the angle from north is 35°.
    expect(tip[0] * tip[1]).toBeGreaterThan(0);
    // (The flat-sky offsets used here are good to a degree at this size.)
    expect(Math.abs(Math.atan2(Math.abs(tip[0]), Math.abs(tip[1])) / DEG - 35)).toBeLessThan(1);
  });

  it('survives a centre on the celestial pole', () => {
    const out: number[] = [];
    ellipseSegments([0, 0, 1], 120, 120, -1, out);
    expect(out.every(Number.isFinite)).toBe(true);
    expect(Math.asin(out[2]) / DEG).toBeCloseTo(89, 6);
  });
});

const SPEC: CatalogSpec = {
  kind: 'catalog',
  id: 'test',
  label: 'Test',
  order: 1,
  file: 'sky/deep/test.json',
  about: 'test',
  classes: {
    galaxy: { label: 'galaxy', color: '#ff0000', shape: 'ring' },
    cluster: { label: 'cluster', color: '#00ff00', shape: 'ring' },
    nebula: { label: 'nebula', color: '#0000ff', shape: 'square' },
  },
  sizePx: (value) => value / 10,
  alpha: (_value, className) => (className === 'nebula' ? 0.5 : 1),
  labelRank: 6.5,
  labelColor: '#ffffff',
  credits: [],
};

const DATA: CatalogData = {
  quantumPerDegree: 1000,
  classes: ['galaxy', 'cluster', 'nebula', 'unstyled'],
  ra: [10685, 56870, 83820, 0],
  dec: [41269, 24110, -5390, 90000],
  cls: [0, 1, 2, 3],
  val: [34, 12, 40, 99],
  labels: [
    [0, 'M31 Andromeda Galaxy', 3.4],
    [2, 'M42 Orion Nebula', 4],
  ],
  ellipses: [
    [0, 178, 70, 35],
    [1, 150, 150, -1],
  ],
};

describe('buildMarkers', () => {
  const batches = buildMarkers(DATA, SPEC);

  it('batches by marker shape and leaves out classes it has no style for', () => {
    expect(batches.map((batch) => [batch.shape, batch.sizes.length])).toEqual([
      ['ring', 2],
      ['square', 1],
    ]);
  });

  it('sizes, colours and fades each marker as the spec says', () => {
    const [rings, squares] = batches;
    expect([...rings.sizes]).toEqual([expect.closeTo(3.4, 5), expect.closeTo(1.2, 5)]);
    expect([...rings.colors]).toEqual([1, 0, 0, 0, 1, 0]);
    expect([...squares.colors]).toEqual([0, 0, 1]);
    expect(squares.alphas[0]).toBe(0.5);
    expect(rings.alphas[0]).toBe(1);
  });

  it('places each marker at its unit ICRS direction', () => {
    const expected = raDecToUnit(10.685, 41.269);
    expect([...batches[0].directions.subarray(0, 3)]).toEqual(expected.map((v) => expect.closeTo(v, 6)));
  });
});

describe('buildOutlines', () => {
  it('groups outlines by class colour', () => {
    const outlines = buildOutlines(DATA, SPEC);
    expect([...outlines.keys()]).toEqual(['#ff0000', '#00ff00']);
    // 178′ and 150′ are both "large": 64 segments of two points each.
    expect(outlines.get('#ff0000')?.length).toBe(64 * 6);
  });
});

describe('catalogLabels', () => {
  it('puts each name at its object, keeping the pipeline’s priority', () => {
    const labels = catalogLabels(DATA);
    expect(labels.map((label) => label.text)).toEqual(['M31 Andromeda Galaxy', 'M42 Orion Nebula']);
    expect(labels[0].priority).toBe(3.4);
    expect(labels[1].position.z).toBeCloseTo(Math.sin(-5.39 * DEG), 6);
  });
});

describe('splitFeatured', () => {
  const labels = catalogLabels(DATA);

  it('keeps one group at the catalogue rank when nothing is featured', () => {
    expect(splitFeatured(labels, { labelRank: 6.5 })).toEqual([{ rank: 6.5, labels }]);
  });

  it('ranks the showpieces apart from the rest', () => {
    const groups = splitFeatured(labels, { labelRank: 6.5, featured: { maxPriority: 3.5, rank: 6.39 } });
    expect(groups.map((group) => [group.rank, group.labels.map((label) => label.text)])).toEqual([
      [6.39, ['M31 Andromeda Galaxy']],
      [6.5, ['M42 Orion Nebula']],
    ]);
  });
});

describe('rampColor', () => {
  const ramp = [
    [0, '#000000'],
    [100, '#ff0000'],
    [200, '#ffffff'],
  ] as const;

  it('interpolates between stops and clamps beyond the ends', () => {
    expect(rampColor(ramp, -5)).toEqual([0, 0, 0]);
    expect(rampColor(ramp, 50)).toEqual([expect.closeTo(0.5, 5), 0, 0]);
    expect(rampColor(ramp, 150)).toEqual([1, expect.closeTo(0.5, 5), expect.closeTo(0.5, 5)]);
    expect(rampColor(ramp, 1e6)).toEqual([1, 1, 1]);
  });
});

describe('buildCloud', () => {
  it('unpacks six-byte records: ra, dec, value', () => {
    const buffer = new ArrayBuffer(12);
    const view = new DataView(buffer);
    // RA 90°, Dec +45°, value 7000; then RA 270°, Dec −90°, value 0.
    view.setUint16(0, 16384, true);
    view.setInt16(2, 16384, true);
    view.setUint16(4, 7000, true);
    view.setUint16(6, 49152, true);
    view.setInt16(8, -32767, true);
    view.setUint16(10, 0, true);
    const spec = DEEP_SKY_SPECS.find((candidate) => candidate.id === 'galaxy-survey') as CloudSpec;
    const cloud = buildCloud(buffer, spec);
    expect(cloud.sizes.length).toBe(2);
    expect(cloud.directions[0]).toBeCloseTo(0, 4);
    expect(cloud.directions[1]).toBeCloseTo(Math.cos(45 * DEG), 3);
    expect(cloud.directions[2]).toBeCloseTo(Math.sin(45 * DEG), 3);
    expect(cloud.directions[5]).toBeCloseTo(-1, 6);
    // Nearer galaxies are drawn larger, and bluer than far ones.
    expect(cloud.sizes[1]).toBeGreaterThan(cloud.sizes[0]);
    expect(cloud.colors[5]).toBeGreaterThan(cloud.colors[2]);
  });
});

describe('hexToRgb', () => {
  it('reads #rrggbb', () => {
    expect(hexToRgb('#ff8000')).toEqual([1, expect.closeTo(128 / 255, 6), 0]);
  });
});

describe('DEEP_SKY_SPECS', () => {
  it('gives every catalogue a unique id and a legend that names its classes', () => {
    const ids = DEEP_SKY_SPECS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const spec of DEEP_SKY_SPECS) {
      expect(specCaption(spec).length).toBeGreaterThan(20);
      if (spec.kind !== 'catalog') continue;
      const styles = Object.values(spec.classes);
      for (const style of styles) expect(style.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(classLegend(spec.classes).match(/#[0-9a-f]{6}/g)?.length).toBe(styles.length);
    }
  });

  it('has a style for every class in the baked files, and the files are sane', () => {
    for (const spec of DEEP_SKY_SPECS) {
      const data = baked(spec.file);
      expect(data, spec.file).toBeDefined();
      if (spec.kind === 'cloud') {
        expect(data.count).toBeGreaterThan(1000);
        continue;
      }
      for (const className of data.classes) expect(Object.keys(spec.classes), `${spec.id}: ${className}`).toContain(className);
      const drawn = buildMarkers(data, spec).reduce((sum, batch) => sum + batch.sizes.length, 0);
      expect(drawn).toBe(data.ra.length);
      for (const batch of buildMarkers(data, spec)) {
        for (const size of batch.sizes) {
          expect(size).toBeGreaterThanOrEqual(2);
          expect(size).toBeLessThanOrEqual(18);
        }
      }
      // Names stay few enough to read: see render/labels.ts.
      expect(data.labels.length).toBeLessThanOrEqual(500);
    }
  });

  it('finds the Andromeda galaxy, labelled, with its true outline', () => {
    const data = baked('sky/deep/dso.json');
    const label = data.labels.find(([, text]) => text === 'M31 Andromeda Galaxy');
    expect(label).toBeDefined();
    const row = label![0];
    expect(data.ra[row] / 1000).toBeCloseTo(10.685, 2);
    expect(data.dec[row] / 1000).toBeCloseTo(41.269, 2);
    const outline = data.ellipses?.find(([index]) => index === row);
    // About 3° × 1°, tilted 35° east of north.
    expect(outline?.[1]).toBeGreaterThan(150);
    expect(outline?.[3]).toBe(35);
  });
});
