import { describe, it, expect } from 'vitest';
import type { EventRecord, UsgsFeedName } from '@transparent-earth/core';
import {
  LABELLED_LARGEST,
  LABELLED_LATEST,
  ageText,
  loadRecent,
  pickLabelled,
  recentLabelText,
  recentRingSizePx,
  recentStatus,
  toMarkers,
  utcDate,
  utcTime,
  type RecentData,
  type RecentIo,
} from './recent';

const NOW = Date.parse('2026-11-10T00:48:00Z');
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function quake(id: string, mag: number, agoMs: number, depthKm = 10): EventRecord {
  return { id, time: new Date(NOW - agoMs).toISOString(), lon: 10, lat: 20, depthKm, mag, name: id, eventType: 'earthquake' };
}

/** A feed as USGS sends it, holding the given events. */
function feed(generatedMs: number, events: readonly EventRecord[], type = 'earthquake'): unknown {
  return {
    type: 'FeatureCollection',
    metadata: { generated: generatedMs, count: events.length },
    features: events.map((e) => ({
      type: 'Feature',
      id: e.id,
      properties: { mag: e.mag, place: e.name, time: Date.parse(e.time), magType: 'mww', type },
      geometry: { type: 'Point', coordinates: [e.lon, e.lat, e.depthKm] },
    })),
  };
}

interface FakeIo extends RecentIo {
  cache: string | null;
  readonly errors: string[];
}

function fakeIo(parts: {
  feeds?: Partial<Record<UsgsFeedName, unknown>>;
  snapshot?: unknown;
  cache?: string | null;
}): FakeIo {
  const io: FakeIo = {
    cache: parts.cache ?? null,
    errors: [],
    fetchFeed: async (name) => {
      const json = parts.feeds?.[name];
      if (json === undefined) throw new Error(`${name}: network down`);
      return json;
    },
    fetchSnapshot: async () => {
      if (parts.snapshot === undefined) throw new Error('snapshot: HTTP 404');
      return parts.snapshot;
    },
    readCache: () => io.cache,
    writeCache: (value) => {
      io.cache = value;
    },
    reportError: (message) => {
      io.errors.push(message);
    },
  };
  return io;
}

describe('ageText', () => {
  it('counts whole minutes, hours, then days', () => {
    expect(ageText(20000)).toBe('just now');
    expect(ageText(12 * MIN + 59000)).toBe('12 min ago');
    expect(ageText(59 * MIN)).toBe('59 min ago');
    expect(ageText(3 * HOUR + 40 * MIN)).toBe('3 h ago');
    expect(ageText(47 * HOUR)).toBe('47 h ago');
    expect(ageText(2 * DAY)).toBe('2 d ago');
    expect(ageText(29 * DAY + 23 * HOUR)).toBe('29 d ago');
  });
});

describe('recentLabelText', () => {
  it('reads "magnitude · depth · age"', () => {
    expect(recentLabelText(quake('a', 6.1, 3 * HOUR, 35.2), NOW)).toBe('M6.1 · 35 km · 3 h ago');
    expect(recentLabelText(quake('b', 5, 61 * MIN, 126.01), NOW)).toBe('M5.0 · 126 km · 1 h ago');
  });

  it('puts an event above sea level at 0 km, where it is drawn', () => {
    expect(recentLabelText(quake('c', 3.13, 5 * DAY, -1.97), NOW)).toBe('M3.1 · 0 km · 5 d ago');
  });
});

describe('pickLabelled', () => {
  const events = [
    ...Array.from({ length: 12 }, (_, i) => quake(`big${i}`, 7.5 - i * 0.1, (10 + i) * DAY)),
    quake('latest', 4.6, 10 * MIN),
    quake('second', 4.7, 2 * HOUR),
    quake('third', 5.0, 5 * HOUR),
    quake('fourth', 4.5, 9 * HOUR),
    quake('fifth', 4.9, 20 * HOUR),
    quake('tiny-and-newest', 2.6, 2 * MIN),
    quake('tomorrow', 8.0, -DAY),
  ];
  const picked = pickLabelled(events, NOW).map((e) => e.id);

  it('takes the largest and the latest M4.5+, each once, largest first', () => {
    expect(picked).toEqual(['big0', 'big1', 'big2', 'big3', 'big4', 'big5', 'big6', 'big7', 'third', 'second', 'latest', 'fourth']);
    expect(picked).toHaveLength(LABELLED_LARGEST + LABELLED_LATEST);
  });

  it('leaves out what has not happened yet on the app clock', () => {
    expect(picked).not.toContain('tomorrow');
    expect(pickLabelled(events, NOW + 2 * DAY).map((e) => e.id)[0]).toBe('tomorrow');
  });

  it('does not label an event twice when it is both large and recent', () => {
    const few = [quake('a', 6.0, HOUR), quake('b', 5.0, 2 * HOUR)];
    expect(pickLabelled(few, NOW).map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('recentRingSizePx', () => {
  it('grows with magnitude and stays visible for the smallest', () => {
    expect(recentRingSizePx(2.5)).toBeGreaterThan(5);
    expect(recentRingSizePx(6)).toBeCloseTo(4 + 2.2 * 1.6 * 1.55, 6);
    expect(recentRingSizePx(8)).toBeGreaterThan(recentRingSizePx(7));
    expect(recentRingSizePx(9)).toBeLessThan(26);
  });
});

describe('toMarkers', () => {
  it('carries place, depth, magnitude and origin time', () => {
    expect(toMarkers([quake('a', 6.1, 3 * HOUR, 35)])).toEqual([{ lon: 10, lat: 20, depthKm: 35, mag: 6.1, timeMs: NOW - 3 * HOUR }]);
  });
});

describe('recentStatus', () => {
  const at = Date.parse('2026-11-09T14:32:10Z');
  const status = (source: RecentData['source']): { text: string; tone: string } => recentStatus({ source, events: [], generatedMs: at });

  it('says live only for live data, with the feed time', () => {
    expect(status('live')).toEqual({ text: 'live · 14:32 UTC', tone: 'live' });
  });

  it('marks every fallback stale and names its date', () => {
    expect(status('cache')).toEqual({ text: 'offline · data of 9 Nov 2026 14:32 UTC', tone: 'stale' });
    expect(status('snapshot')).toEqual({ text: 'offline · snapshot 9 Nov 2026', tone: 'stale' });
  });

  it('is an error when there is nothing to show', () => {
    expect(status('none').tone).toBe('error');
  });

  it('formats dates in UTC', () => {
    expect(utcDate(Date.parse('2026-01-01T00:00:00Z'))).toBe('1 Jan 2026');
    expect(utcTime(Date.parse('2026-01-01T00:05:00Z'))).toBe('00:05 UTC');
  });
});

describe('loadRecent', () => {
  const month = [quake('m1', 6.4, 21 * HOUR), quake('m2', 5.0, 20 * DAY)];
  const week = [quake('w1', 2.7, 3 * HOUR), { ...quake('m1', 6.5, 21 * HOUR), depthKm: 17 }];

  it('merges both feeds, the later feed winning a shared id, and caches the result', async () => {
    const io = fakeIo({ feeds: { '4.5_month': feed(NOW - 2 * MIN, month), '2.5_week': feed(NOW - MIN, week) } });
    const data = await loadRecent(io);
    expect(data.source).toBe('live');
    expect(data.generatedMs).toBe(NOW - MIN);
    expect(data.events.map((e) => e.id)).toEqual(['m2', 'm1', 'w1']);
    expect(data.events[1]).toMatchObject({ mag: 6.5, depthKm: 17 });
    expect(io.errors).toEqual([]);
    expect(JSON.parse(io.cache ?? '{}')).toMatchObject({ generatedMs: NOW - MIN });
  });

  it('keeps earthquakes only', async () => {
    const io = fakeIo({
      feeds: { '4.5_month': feed(NOW, month), '2.5_week': feed(NOW, [quake('blast', 2.7, HOUR)], 'quarry blast') },
    });
    expect((await loadRecent(io)).events.map((e) => e.id)).toEqual(['m2', 'm1']);
  });

  it('falls back to the cache when a feed fails, and does not call it live', async () => {
    const online = fakeIo({ feeds: { '4.5_month': feed(NOW - HOUR, month), '2.5_week': feed(NOW - HOUR, week) } });
    await loadRecent(online);
    const offline = fakeIo({ feeds: { '4.5_month': feed(NOW, month) }, cache: online.cache, snapshot: feed(NOW - 30 * DAY, month) });
    const data = await loadRecent(offline);
    expect(data.source).toBe('cache');
    expect(data.generatedMs).toBe(NOW - HOUR);
    expect(data.events).toHaveLength(3);
    expect(recentStatus(data).tone).toBe('stale');
    expect(offline.errors).toHaveLength(1);
  });

  it('falls back to the baked snapshot with no cache', async () => {
    const data = await loadRecent(fakeIo({ snapshot: feed(NOW - 3 * DAY, month) }));
    expect(data).toMatchObject({ source: 'snapshot', generatedMs: NOW - 3 * DAY });
    expect(data.events).toHaveLength(2);
  });

  it('prefers a snapshot newer than the cache', async () => {
    const stale = JSON.stringify({ generatedMs: NOW - 40 * DAY, events: [quake('old', 5, 41 * DAY)] });
    const data = await loadRecent(fakeIo({ cache: stale, snapshot: feed(NOW - 3 * DAY, month) }));
    expect(data.source).toBe('snapshot');
  });

  it('keeps what is on screen, as stale, when a refresh fails', async () => {
    const held: RecentData = { source: 'live', events: month, generatedMs: NOW - 5 * MIN };
    const data = await loadRecent(fakeIo({}), held);
    expect(data).toMatchObject({ source: 'cache', generatedMs: NOW - 5 * MIN });
    expect(data.events).toBe(month);
  });

  it('reports nothing to show when nothing can be reached', async () => {
    const io = fakeIo({ cache: 'not json' });
    const data = await loadRecent(io);
    expect(data).toEqual({ source: 'none', events: [], generatedMs: null });
    expect(recentStatus(data).tone).toBe('error');
    expect(io.errors).toHaveLength(2);
  });

  it('treats an error page served as JSON as a failure, not as an empty feed', async () => {
    const io = fakeIo({ feeds: { '4.5_month': { error: 'throttled' }, '2.5_week': feed(NOW, week) }, snapshot: feed(NOW - DAY, month) });
    expect((await loadRecent(io)).source).toBe('snapshot');
  });

  it('still shows live data when the cache cannot be written', async () => {
    const io = fakeIo({ feeds: { '4.5_month': feed(NOW, month), '2.5_week': feed(NOW, week) } });
    io.writeCache = () => {
      throw new Error('QuotaExceededError');
    };
    expect((await loadRecent(io)).source).toBe('live');
    expect(io.errors).toHaveLength(1);
  });
});
