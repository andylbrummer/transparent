import { describe, it, expect } from 'vitest';
import {
  buildQueryUrl,
  normalizeEvent,
  parseEventCollection,
  mergeEvents,
  usgsFeedUrl,
  activeEventsAt,
  DEFAULT_CLOCK,
  MAX_ACTIVE_EVENTS,
  tickClock,
  seekClock,
  setCompression,
  togglePlay,
  loadEvents,
  type EventRecord,
} from './index';
import { FDSN_QUERY_TOHOKU, FEED_EXCERPT } from './usgs-fixtures';

describe('buildQueryUrl', () => {
  it('builds basic query', () => {
    const url = buildQueryUrl('https://example.com', {
      startTime: '2024-01-01',
      endTime: '2024-01-02',
    });
    expect(url).toContain('format=geojson');
    expect(url).toContain('starttime=2024-01-01');
    expect(url).toContain('endtime=2024-01-02');
  });

  it('includes magnitude bounds', () => {
    const url = buildQueryUrl('https://example.com', {
      startTime: '2024-01-01',
      endTime: '2024-01-02',
      minMagnitude: 5,
      maxMagnitude: 7,
    });
    expect(url).toContain('minmagnitude=5');
    expect(url).toContain('maxmagnitude=7');
  });

  it('builds the very query the recorded response answered', () => {
    // The fixture's metadata.url is what USGS echoed back for this request.
    const url = buildQueryUrl('https://earthquake.usgs.gov/fdsnws/event/1/query', {
      startTime: '2011-03-11T05:00:00',
      endTime: '2011-03-11T07:00:00',
      minMagnitude: 7,
      orderBy: 'time-asc',
    });
    const recorded = (FDSN_QUERY_TOHOKU as { metadata: { url: string } }).metadata.url;
    expect(url).toBe(recorded);
  });

  it('names type, paging and box parameters as FDSN does', () => {
    const params = new URL(
      buildQueryUrl('https://example.com/query', {
        startTime: '2018-08-19',
        endTime: '2018-08-20',
        minLatitude: -30,
        maxLatitude: -10,
        minLongitude: 170,
        maxLongitude: 190,
        eventType: 'earthquake',
        limit: 20000,
        offset: 20001,
      })
    ).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      format: 'geojson',
      starttime: '2018-08-19',
      endtime: '2018-08-20',
      minlatitude: '-30',
      maxlatitude: '-10',
      minlongitude: '170',
      maxlongitude: '190',
      eventtype: 'earthquake',
      limit: '20000',
      offset: '20001',
    });
  });
});

describe('usgsFeedUrl', () => {
  it('points at the summary feed', () => {
    expect(usgsFeedUrl('4.5_month')).toBe('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson');
  });
});

describe('normalizeEvent', () => {
  it('normalizes a valid USGS feature', () => {
    const feature = {
      id: 'us7000abc',
      properties: {
        time: 1704067200000, // USGS: epoch ms
        mag: 6.5,
        place: 'Test Location',
      },
      geometry: {
        coordinates: [120.5, 35.2, 15], // USGS: depth in km
      },
    };
    const event = normalizeEvent(feature);
    expect(event).not.toBeNull();
    expect(event?.id).toBe('us7000abc');
    expect(event?.lat).toBe(35.2);
    expect(event?.lon).toBe(120.5);
    expect(event?.depthKm).toBe(15);
    expect(event?.time).toBe('2024-01-01T00:00:00.000Z');
    expect(event?.mag).toBe(6.5);
    expect(event?.name).toBe('Test Location');
  });

  it('handles missing place', () => {
    const feature = {
      id: 'test1',
      properties: { time: 1704067200000, mag: 5.0 },
      geometry: { coordinates: [0, 0, 0] },
    };
    const event = normalizeEvent(feature);
    expect(event?.name).toBe('Unknown location');
  });

  it('returns null for invalid data', () => {
    const event = normalizeEvent({});
    expect(event).toBeNull();
  });

  it('builds a missing id from network and code, never from the code alone', () => {
    const properties = { time: 1704067200000, mag: 5.0, net: 'us', code: '7000abcd' };
    const geometry = { coordinates: [10, 20, 30] };
    expect(normalizeEvent({ properties, geometry })?.id).toBe('us7000abcd');
    expect(normalizeEvent({ properties: { ...properties, net: undefined }, geometry })).toBeNull();
  });

  it('rejects a null magnitude or depth instead of reading it as zero', () => {
    const base = { id: 'x', properties: { time: 1704067200000, mag: 5.0 }, geometry: { coordinates: [10, 20, 30] } };
    expect(normalizeEvent({ ...base, properties: { ...base.properties, mag: null } })).toBeNull();
    expect(normalizeEvent({ ...base, geometry: { coordinates: [10, 20, null] } })).toBeNull();
    expect(normalizeEvent({ ...base, geometry: { coordinates: [10, 20] } })).toBeNull();
    expect(normalizeEvent({ ...base, properties: { ...base.properties, mag: true } })).toBeNull();
    expect(normalizeEvent({ ...base, properties: { ...base.properties, time: 9e15 } })).toBeNull();
  });

  it('keeps the antimeridian and both poles', () => {
    const at = (lon: number, lat: number): EventRecord | null =>
      normalizeEvent({ id: 'x', properties: { time: 0, mag: 5 }, geometry: { coordinates: [lon, lat, 10] } });
    expect(at(180, -20)?.lon).toBe(180);
    expect(at(-180, -20)?.lon).toBe(-180);
    expect(at(0, 90)?.lat).toBe(90);
    expect(at(180.01, 0)).toBeNull();
    expect(at(0, -90.01)).toBeNull();
  });
});

describe('parseEventCollection, on recorded USGS responses', () => {
  it('reads an FDSN query: Tōhoku 2011 and its two great aftershocks', () => {
    const parsed = parseEventCollection(FDSN_QUERY_TOHOKU);
    expect(parsed.rejected).toBe(0);
    expect(parsed.generatedMs).toBe(1794270502000);
    expect(parsed.events.map((e) => e.id)).toEqual(['official20110311054624120_30', 'usp000hvpa', 'usp000hvpg']);
    // https://earthquake.usgs.gov/earthquakes/eventpage/official20110311054624120_30
    expect(parsed.events[0]).toEqual({
      id: 'official20110311054624120_30',
      time: '2011-03-11T05:46:24.120Z',
      lon: 142.373,
      lat: 38.297,
      depthKm: 29,
      mag: 9.1,
      name: '2011 Great Tohoku Earthquake, Japan',
      magType: 'mww',
      eventType: 'earthquake',
    });
    expect(parsed.events[1]).toMatchObject({ time: '2011-03-11T06:15:40.280Z', lon: 141.111, lat: 36.281, depthKm: 42.6, mag: 7.9 });
  });

  it('reads a real-time feed, leaving out what is not an earthquake', () => {
    const parsed = parseEventCollection(FEED_EXCERPT);
    expect(parsed.generatedMs).toBe(1794270550000);
    expect(parsed.rejected).toBe(1); // the quarry blast near Ferry, Alaska
    expect(parsed.events.map((e) => e.id)).toEqual(['us7000twg9', 'uu80163296', 'us7000tx16']);
    expect(parsed.events.every((e) => e.eventType === 'earthquake')).toBe(true);
    // Depth is positive down; this one is 1.97 km above sea level, and stays so.
    expect(parsed.events[1]).toMatchObject({ depthKm: -1.97, mag: 3.13, magType: 'ml' });
    expect(parsed.events[2]).toMatchObject({ lon: 165.5616, lat: -10.8669, depthKm: 17, mag: 6.4 });
  });

  it('keeps every type on request', () => {
    const parsed = parseEventCollection(FEED_EXCERPT, { eventTypes: null });
    expect(parsed.rejected).toBe(0);
    expect(parsed.events.map((e) => e.eventType)).toContain('quarry blast');
  });

  it('throws on anything that is not a feature collection', () => {
    expect(() => parseEventCollection({ error: 'Bad Request' })).toThrow();
    expect(() => parseEventCollection('<html>')).toThrow();
    expect(() => parseEventCollection(null)).toThrow();
  });
});

describe('mergeEvents', () => {
  it('keeps the later list for a repeated id and sorts by time', () => {
    const month = parseEventCollection(FDSN_QUERY_TOHOKU).events;
    const revised: EventRecord = { ...month[1], mag: 8.0 };
    const merged = mergeEvents(month, [revised]);
    expect(merged.map((e) => e.id)).toEqual(month.map((e) => e.id));
    expect(merged[1].mag).toBe(8.0);
  });
});

function eventAt(id: string, time: string): EventRecord {
  return { id, time, lat: 0, lon: 0, depthKm: 10, mag: 5, name: id };
}

describe('playback clock', () => {
  it('ticks forward when running', () => {
    const state = { ...DEFAULT_CLOCK, running: true, compression: 60 };
    const next = tickClock(state, 1000); // 1s wall
    expect(next.simTimeMs).toBe(60000); // 60s sim
  });

  it('does not tick when paused', () => {
    const state = { ...DEFAULT_CLOCK, running: false };
    const next = tickClock(state, 1000);
    expect(next.simTimeMs).toBe(0);
  });

  it('seek is idempotent', () => {
    const state = seekClock(DEFAULT_CLOCK, 3600000);
    const again = seekClock(state, 3600000);
    expect(again.simTimeMs).toBe(3600000);
  });

  it('compression change preserves sim-time', () => {
    const state = { ...DEFAULT_CLOCK, simTimeMs: 3600000 };
    const next = setCompression(state, 120);
    expect(next.simTimeMs).toBe(3600000);
    expect(next.compression).toBe(120);
  });

  it('toggles play/pause', () => {
    const state = togglePlay(DEFAULT_CLOCK);
    expect(state.running).toBe(true);
    const again = togglePlay(state);
    expect(again.running).toBe(false);
  });

  it('culls to max 8 active events', () => {
    const events = Array.from({ length: 12 }, (_, i) => eventAt(`e${i}`, `2024-01-01T${String(i).padStart(2, '0')}:00:00Z`));
    const state = seekClock(loadEvents(DEFAULT_CLOCK, events), Date.parse('2024-01-01T23:00:00Z'));
    expect(state.events).toHaveLength(12);
    expect(state.activeEvents).toHaveLength(MAX_ACTIVE_EVENTS);
    // Oldest culled first.
    expect(state.activeEvents[0].id).toBe('e4');
  });

  it('counts an event as active only once it has happened, and for a day', () => {
    const events = [eventAt('a', '2024-01-01T00:00:00Z'), eventAt('b', '2024-01-03T00:00:00Z')];
    const ids = (iso: string): string[] => activeEventsAt(events, Date.parse(iso)).map((e) => e.id);
    expect(ids('2023-12-31T23:59:59Z')).toEqual([]);
    expect(ids('2024-01-01T00:00:00Z')).toEqual(['a']);
    expect(ids('2024-01-02T00:00:01Z')).toEqual([]);
    expect(ids('2024-01-03T12:00:00Z')).toEqual(['b']);
  });

  it('brings earlier events back when seeking backwards', () => {
    const events = [eventAt('a', '2024-01-01T00:00:00Z'), eventAt('b', '2024-01-03T00:00:00Z')];
    const late = seekClock(loadEvents(DEFAULT_CLOCK, events), Date.parse('2024-01-03T01:00:00Z'));
    expect(late.activeEvents.map((e) => e.id)).toEqual(['b']);
    const early = seekClock(late, Date.parse('2024-01-01T01:00:00Z'));
    expect(early.activeEvents.map((e) => e.id)).toEqual(['a']);
  });

  it('activates events as playback reaches them', () => {
    const start = Date.parse('2024-01-01T00:00:00Z');
    const loaded = loadEvents({ ...DEFAULT_CLOCK, simTimeMs: start - 60000, running: true }, [eventAt('a', '2024-01-01T00:00:00Z')]);
    expect(loaded.activeEvents).toEqual([]);
    expect(tickClock(loaded, 1000).activeEvents.map((e) => e.id)).toEqual(['a']);
  });
});
