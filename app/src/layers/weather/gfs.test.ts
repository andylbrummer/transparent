import { describe, it, expect } from 'vitest';
import {
  assertGfsGrid,
  candidateRuns,
  decodeSnapshotGrids,
  GFS_NI,
  GFS_NJ,
  gfsFileUrl,
  gfsSource,
  parseInventory,
  runTag,
  runValidTime,
} from './gfs';
import { GRIB_SIMPLE } from './grib2.fixture';

const at = (iso: string): Date => new Date(iso);

/** The head and tail of a real inventory: gfs.t12z.pgrb2.1p00.f000.idx of 9 Nov 2026. */
const INVENTORY = [
  '1:0:d=2026110912:PRMSL:mean sea level:anl:',
  '2:82365:d=2026110912:CLMR:1 hybrid level:anl:',
  '276:17431372:d=2026110912:UGRD:250 mb:anl:',
  '277:17484120:d=2026110912:VGRD:250 mb:anl:',
  '278:17538203:d=2026110912:ABSV:250 mb:anl:',
  '',
].join('\n');

describe('gfsFileUrl', () => {
  it('names the 1° file of a run and forecast hour on the NOAA bucket', () => {
    expect(gfsFileUrl({ cycle: at('2026-11-09T18:00:00Z'), forecastHours: 6 })).toBe(
      'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261109/18/atmos/gfs.t18z.pgrb2.1p00.f006'
    );
    expect(gfsFileUrl({ cycle: at('2026-01-02T00:00:00Z'), forecastHours: 120 })).toContain('/gfs.20260102/00/atmos/gfs.t00z.pgrb2.1p00.f120');
  });

  it('tags a run and knows when its file is valid', () => {
    const run = { cycle: at('2026-11-09T18:00:00Z'), forecastHours: 6 };
    expect(runTag(run)).toBe('2026-11-09T18Z+006');
    expect(runValidTime(run).toISOString()).toBe('2026-11-10T00:00:00.000Z');
  });
});

describe('candidateRuns', () => {
  it('starts from the newest run likely to be published, at the hour nearest now', () => {
    // 00:30: the 00Z run will not be out for hours; 18Z + 6 h is valid at 00:00.
    const runs = candidateRuns(at('2026-11-10T00:30:00Z'));
    expect(runs.map(runTag)).toEqual(['2026-11-09T18Z+006', '2026-11-09T12Z+012', '2026-11-09T06Z+018', '2026-11-09T00Z+024']);
  });

  it('gives every candidate the same valid time, a 3-hour step from now', () => {
    for (const now of ['2026-11-10T04:10:00Z', '2026-11-10T07:40:00Z', '2026-11-10T22:29:00Z']) {
      const runs = candidateRuns(at(now));
      const valid = runs.map((run) => runValidTime(run).getTime());
      expect(new Set(valid).size).toBe(1);
      expect(Math.abs(valid[0] - at(now).getTime())).toBeLessThanOrEqual(1.5 * 3_600_000);
      for (const run of runs) expect(run.forecastHours % 3).toBe(0);
    }
  });

  it('takes a new run once it has had time to publish', () => {
    expect(runTag(candidateRuns(at('2026-11-10T03:29:00Z'))[0])).toBe('2026-11-09T18Z+009');
    expect(runTag(candidateRuns(at('2026-11-10T03:31:00Z'))[0])).toBe('2026-11-10T00Z+003');
  });
});

describe('parseInventory', () => {
  const ranges = parseInventory(INVENTORY);

  it('gives each field the bytes up to the next field', () => {
    expect(ranges.get('UGRD:250 mb')).toEqual({ start: 17431372, end: 17484119 });
    expect(ranges.get('VGRD:250 mb')).toEqual({ start: 17484120, end: 17538202 });
    expect(ranges.get('PRMSL:mean sea level')).toEqual({ start: 0, end: 82364 });
  });

  it('leaves out the last field, whose end it cannot know', () => {
    expect(ranges.has('ABSV:250 mb')).toBe(false);
  });

  it('reads nothing from an error page', () => {
    expect(parseInventory('<?xml version="1.0"?><Error><Code>NoSuchKey</Code></Error>').size).toBe(0);
  });
});

describe('decodeSnapshotGrids', () => {
  it('scales each int8 grid back to its units', () => {
    const size = GFS_NI * GFS_NJ;
    const raw = new Int8Array(2 * size);
    raw[0] = 100;
    raw[size] = -127;
    const [u, v] = decodeSnapshotGrids(raw.buffer, 2, 0.81);
    expect(u[0]).toBeCloseTo(81, 4);
    expect(v[0]).toBeCloseTo(-102.87, 4);
    expect(u).toHaveLength(size);
  });

  it('refuses a file of the wrong size', () => {
    expect(() => decodeSnapshotGrids(new ArrayBuffer(100), 2, 1)).toThrow('100 bytes');
  });

  it('accepts only the GFS 1° grid', () => {
    const grid = { ni: 360, nj: 181, latFirst: 90, latStep: -1, lonFirst: 0, lonStep: 1 };
    expect(() => assertGfsGrid(grid)).not.toThrow();
    expect(() => assertGfsGrid({ ...grid, latFirst: -90, latStep: 1 })).toThrow('not the GFS 1° grid');
  });
});

describe('gfsSource', () => {
  const FIELDS = ['UGRD:250 mb', 'VGRD:250 mb'];
  const snapshot = async (): Promise<never> => {
    throw new Error('no snapshot in this test');
  };

  /** A bucket holding only the 12Z run: newer inventories are 404. */
  function bucket(body: (range: string) => ArrayBuffer) {
    const requests: { url: string; range: string | null }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      const range = new Headers(init?.headers).get('Range');
      requests.push({ url, range });
      if (!url.includes('/gfs.20261109/12/')) return new Response('', { status: 404 });
      if (url.endsWith('.idx')) return new Response(INVENTORY);
      return new Response(body(range ?? ''), { status: 206 });
    };
    return { requests, fetchImpl };
  }

  const lengthOf = (range: string): number => {
    const [start, end] = range.replace('bytes=', '').split('-').map(Number);
    return end - start + 1;
  };

  it('steps back to the newest run that is on the bucket', async () => {
    const { requests, fetchImpl } = bucket(() => new ArrayBuffer(0));
    const source = gfsSource({ storeKey: 'test-step-back', fields: FIELDS, snapshot, fetchImpl });
    const latest = await source.latest(at('2026-11-10T00:30:00Z'));
    expect(latest.tag).toBe('2026-11-09T12Z+012');
    expect(latest.validTime.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(requests.map((r) => r.url.split('/atmos/')[1])).toEqual(['gfs.t18z.pgrb2.1p00.f006.idx', 'gfs.t12z.pgrb2.1p00.f012.idx']);
  });

  it('downloads each field by its byte range and nothing else', async () => {
    const { requests, fetchImpl } = bucket((range) => new ArrayBuffer(lengthOf(range)));
    const source = gfsSource({ storeKey: 'test-ranges', fields: FIELDS, snapshot, fetchImpl });
    const { tag } = await source.latest(at('2026-11-10T00:10:00Z'));
    const blob = await source.download(tag);
    const ranged = requests.filter((r) => r.range);
    expect(ranged.map((r) => r.range)).toEqual(['bytes=17431372-17484119', 'bytes=17484120-17538202']);
    expect(ranged.every((r) => r.url.endsWith('gfs.t12z.pgrb2.1p00.f012'))).toBe(true);
    expect(blob.size).toBe(52748 + 54083);
  });

  it('rejects a server that ignores the range and sends something else', async () => {
    const { fetchImpl } = bucket(() => new ArrayBuffer(1000));
    const source = gfsSource({ storeKey: 'test-ignored-range', fields: FIELDS, snapshot, fetchImpl });
    const { tag } = await source.latest(at('2026-11-10T00:20:00Z'));
    await expect(source.download(tag)).rejects.toThrow('got 1000 bytes');
  });

  it('fails when no recent run has the fields', async () => {
    const fetchImpl = async (): Promise<Response> => new Response('', { status: 404 });
    const source = gfsSource({ storeKey: 'test-none', fields: FIELDS, snapshot, fetchImpl });
    await expect(source.latest(at('2031-01-01T00:00:00Z'))).rejects.toThrow('HTTP 404');
  });

  it('fails when the inventory lacks a field, rather than fetch the wrong bytes', async () => {
    const { fetchImpl } = bucket(() => new ArrayBuffer(0));
    const source = gfsSource({ storeKey: 'test-missing', fields: ['UGRD:250 mb', 'TMP:2 m above ground'], snapshot, fetchImpl });
    await expect(source.latest(at('2026-11-10T00:40:00Z'))).rejects.toThrow('no "TMP:2 m above ground"');
  });

  it('decodes only fields on the GFS grid', async () => {
    const source = gfsSource({ storeKey: 'test-grid', fields: ['UGRD:250 mb'], snapshot });
    const subregion = Uint8Array.from(atob(GRIB_SIMPLE.base64), (c) => c.charCodeAt(0));
    await expect(source.decode(new Blob([subregion]))).rejects.toThrow('not the GFS 1° grid');
    await expect(source.decode(new Blob([subregion, subregion]))).rejects.toThrow('expected 1 GFS fields, got 2');
  });
});
