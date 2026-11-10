import { describe, expect, it } from 'vitest';
import { raDecToUnit } from '@transparent-earth/core';
import definitions, { TRANSIENT_SPECS, type TransientSpec } from './layer';
import {
  buildBoxes,
  buildMarkers,
  buildRegions,
  countUpTo,
  dayText,
  daysSince2000,
  labelsUpTo,
  transientStatus,
  type TransientData,
} from './transients';

const SPEC: TransientSpec = {
  id: 'test',
  label: 'Test',
  order: 0,
  file: 'sky/transients/test.json',
  noun: 'events',
  caption: '',
  classes: {
    a: { label: 'a', color: '#ff0000', shape: 'star' },
    b: { label: 'b', color: '#0000ff', shape: 'ring' },
  },
  sizePx: (value) => value,
  labelRank: 6.4,
  labelColor: '#ffffff',
  region: { sizePx: 4, alpha: 0.5 },
  boxColor: '#ffffff',
  credits: [],
};

const DATA: TransientData = {
  quantumPerDegree: 1000,
  classes: ['a', 'b'],
  t: [-100, 10, 20, 30],
  ra: [0, 90000, 180000, 270000],
  dec: [0, 0, 45000, -45000],
  cls: [0, 1, 0, 1],
  val: [5, 6, 0, 8],
  labels: [
    [3, 'last', 0],
    [0, 'first', 1],
  ],
  boxes: [
    [1, 2, 2, 1, 1],
    [3, 0.5, 0.5, 0.5, 0.5],
  ],
  regions: [
    { row: 1, ra: [89000, 91000], dec: [0, 0] },
    { row: 3, ra: [270000], dec: [-45000] },
  ],
};

const BAKED = import.meta.glob<TransientData>('/public/sky/transients/*.json', { eager: true, import: 'default' });
const loadBaked = (file: string): TransientData => BAKED[`/public/${file}`];

describe('the clock', () => {
  it('counts days from the start of 2000 in UTC', () => {
    expect(daysSince2000(new Date('2000-01-01T00:00:00Z'))).toBe(0);
    expect(daysSince2000(new Date('2017-08-17T12:41:04Z'))).toBeCloseTo(6438.5285, 3);
    expect(dayText(6438.528)).toBe('17 Aug 2017');
    expect(dayText(-38164)).toBe('6 Jul 1895');
  });

  it('counts the events at or before a time', () => {
    expect(countUpTo(DATA.t, -200)).toBe(0);
    expect(countUpTo(DATA.t, 10)).toBe(2);
    expect(countUpTo(DATA.t, 29.99)).toBe(3);
    expect(countUpTo(DATA.t, 1e6)).toBe(4);
    expect(countUpTo([], 0)).toBe(0);
  });
});

describe('buildMarkers', () => {
  const batches = buildMarkers(DATA, SPEC);

  it('batches by shape, keeps time order and drops rows of no size', () => {
    expect(batches.map((b) => b.shape)).toEqual(['star', 'ring']);
    expect([...batches[0].times]).toEqual([-100]);
    expect([...batches[1].times]).toEqual([10, 30]);
    expect([...batches[1].sizes]).toEqual([6, 8]);
  });

  it('places a marker at its right ascension and declination', () => {
    const expected = raDecToUnit(270, -45);
    const got = batches[1].directions.slice(3, 6);
    expected.forEach((value, axis) => expect(got[axis]).toBeCloseTo(value, 6));
    expect([...batches[1].colors.slice(0, 3)]).toEqual([0, 0, 1]);
  });
});

describe('regions and boxes', () => {
  it('gives every region pixel its event’s time and colour', () => {
    const regions = buildRegions(DATA, SPEC);
    expect(regions).not.toBeNull();
    expect([...regions!.times]).toEqual([10, 10, 30]);
    expect([...regions!.colors.slice(0, 3)]).toEqual([0, 0, 1]);
    expect(buildRegions(DATA, { ...SPEC, region: undefined })).toBeNull();
  });

  it('outlines an error rectangle through its four corners, in time order', () => {
    const boxes = buildBoxes(DATA);
    expect(boxes).not.toBeNull();
    const { segments, segmentEnds, times } = boxes!;
    expect([...times]).toEqual([10, 30]);
    // 4° × 2° at 1° steps: 4 + 2 + 4 + 2 segments; then a 1° square: 4.
    expect([...segmentEnds]).toEqual([12, 16]);
    const first = raDecToUnit(88, -1);
    first.forEach((value, axis) => expect(segments[axis]).toBeCloseTo(value, 6));
    // Closed: the last segment of the first box ends where its first began.
    first.forEach((value, axis) => expect(segments[11 * 6 + 3 + axis]).toBeCloseTo(value, 6));
    for (let i = 0; i < segments.length; i += 3) {
      expect(Math.hypot(segments[i], segments[i + 1], segments[i + 2])).toBeCloseTo(1, 5);
    }
  });
});

describe('what the clock hides', () => {
  it('names only what has happened', () => {
    expect(labelsUpTo(DATA, 0).map((l) => l.text)).toEqual(['first']);
    expect(labelsUpTo(DATA, 30).map((l) => l.text)).toEqual(['last', 'first']);
    expect(labelsUpTo(DATA, -1000)).toEqual([]);
  });

  it('says how far the clock has come through the catalogue', () => {
    expect(transientStatus(DATA, 1e6, 'events')).toBe('4 events · catalogue to 31 Jan 2000');
    expect(transientStatus(DATA, 15, 'events')).toBe('2 of 4 events by this date');
    expect(transientStatus(DATA, -1000, 'events')).toBe('none yet at this date · catalogue 23 Sep 1999 – 31 Jan 2000');
  });
});

describe('the baked files', () => {
  it('has one definition per spec, each with a file whose classes the spec can draw', () => {
    expect(definitions.map((d) => d.id)).toEqual(TRANSIENT_SPECS.map((s) => s.id));
    for (const spec of TRANSIENT_SPECS) {
      const data = loadBaked(spec.file);
      expect(data.t.length).toBeGreaterThan(0);
      for (const name of data.classes) expect(spec.classes[name], `${spec.id}: ${name}`).toBeDefined();
      for (let i = 1; i < data.t.length; i++) expect(data.t[i]).toBeGreaterThanOrEqual(data.t[i - 1]);
      for (const length of [data.ra.length, data.dec.length, data.cls.length, data.val.length]) expect(length).toBe(data.t.length);
      const batches = buildMarkers(data, spec);
      for (const batch of batches) {
        for (const size of batch.sizes) expect(size).toBeGreaterThan(0);
        for (const size of batch.sizes) expect(size).toBeLessThanOrEqual(16);
      }
    }
  });

  it('shows three gravitational-wave events at the end of 2016, the merger of 2017 once it has happened', () => {
    const spec = TRANSIENT_SPECS.find((s) => s.id === 'gw-events')!;
    const data = loadBaked(spec.file);
    expect(countUpTo(data.t, daysSince2000(new Date('2016-12-31T00:00:00Z')))).toBe(3);
    const before = labelsUpTo(data, daysSince2000(new Date('2017-08-17T12:00:00Z'))).map((l) => l.text);
    const after = labelsUpTo(data, daysSince2000(new Date('2017-08-17T13:00:00Z'))).map((l) => l.text);
    expect(before.some((text) => text.startsWith('GW170817'))).toBe(false);
    expect(after.some((text) => text.startsWith('GW170817'))).toBe(true);
  });
});
