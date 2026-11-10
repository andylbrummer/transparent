import { describe, it, expect } from 'vitest';
import {
  EONET_QUERIES,
  geometryPosition,
  hazardStatus,
  loadHazards,
  reduceAnswers,
  reduceEvent,
  type HazardEvent,
  type HazardIo,
} from './eonet';
import {
  OLDEST_ALPHA,
  LABEL_LIMITS,
  ageText,
  categoryOf,
  cleanTitle,
  eventsBy,
  fireHectares,
  hazardLabelText,
  hazardMarkers,
  hazardSizePx,
  hazardAlpha,
  magnitudeText,
  pickLabelled,
} from './hazards';
import hazardsLive, { HAZARD_CATEGORIES, OTHER_HAZARD } from './layer';

/** Events as EONET v3 sent them on 9 Nov 2026, cut to the fields read. */
const RAW_STORM = {
  id: 'EONET_26159',
  title: 'Tropical Cyclone 03S',
  closed: null,
  categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
  sources: [{ id: 'JTWC', url: 'https://www.metoc.navy.mil/jtwc/products/sh0327.tcw' }],
  geometry: [
    { magnitudeValue: 35.0, magnitudeUnit: 'kts', date: '2026-11-07T18:00:00Z', type: 'Point', coordinates: [52.6, -13.5] },
    { magnitudeValue: 35.0, magnitudeUnit: 'kts', date: '2026-11-08T00:00:00Z', type: 'Point', coordinates: [52.3, -13.4] },
    { magnitudeValue: 30.0, magnitudeUnit: 'kts', date: '2026-11-08T12:00:00Z', type: 'Point', coordinates: [50.9, -11.9] },
  ],
};
const RAW_FIRE = {
  id: 'EONET_26166',
  title: 'Wildfire in Australia 1033644',
  closed: '2026-11-08T00:00:00Z',
  categories: [{ id: 'wildfires', title: 'Wildfires' }],
  sources: [{ id: 'GDACS', url: 'https://www.gdacs.org/report.aspx?eventtype=WF&eventid=1033644' }],
  geometry: [{ magnitudeValue: 5123.0, magnitudeUnit: 'hectare', date: '2026-11-07T19:00:00Z', type: 'Point', coordinates: [124.25122638707, -19.348134338772] }],
};
const RAW_VOLCANO = {
  id: 'EONET_20710',
  title: 'Nevados del Chillan Volcano, Chile',
  closed: null,
  categories: [{ id: 'volcanoes', title: 'Volcanoes' }],
  sources: [{ id: 'SIVolcano', url: 'https://volcano.si.edu/volcano.cfm?vn=357070' }],
  geometry: [{ magnitudeValue: null, magnitudeUnit: null, date: '2026-06-15T00:00:00Z', type: 'Point', coordinates: [-71.378, -36.868] }],
};
const RAW_ICEBERG = {
  id: 'EONET_25990',
  title: 'Iceberg B22K',
  closed: null,
  categories: [{ id: 'seaLakeIce', title: 'Sea and Lake Ice' }],
  sources: [{ id: 'NATICE', url: 'https://usicecenter.gov/pub/Iceberg_Tabular.csv' }],
  geometry: [{ magnitudeValue: 19.62, magnitudeUnit: 'NM^2', date: '2026-10-30T00:00:00Z', type: 'Point', coordinates: [163.35, -69.76] }],
};
const RAW_FLOOD = {
  id: 'EONET_26164',
  title: 'Flood in Portugal 1104276',
  closed: '2026-11-08T00:00:00Z',
  categories: [{ id: 'floods', title: 'Floods' }],
  sources: [{ id: 'GDACS', url: 'https://www.gdacs.org/report.aspx?eventtype=FL&eventid=1104276' }],
  geometry: [
    {
      magnitudeValue: null,
      magnitudeUnit: null,
      date: '2026-11-06T20:00:00Z',
      type: 'Polygon',
      coordinates: [[[-17.3, 32.6], [-15.27, 32.6], [-15.27, 33.652], [-17.3, 33.652], [-17.3, 32.6]]],
    },
  ],
};

const NOW = Date.parse('2026-11-09T22:00:00Z');
const reduced = (raw: unknown): HazardEvent => {
  const event = reduceEvent(raw);
  if (!event) throw new Error('fixture did not reduce');
  return event;
};
const STORM = reduced(RAW_STORM);
const FIRE = reduced(RAW_FIRE);
const VOLCANO = reduced(RAW_VOLCANO);
const ICEBERG = reduced(RAW_ICEBERG);
const FLOOD = reduced(RAW_FLOOD);

describe('reducing EONET events', () => {
  it('puts an event at its latest report', () => {
    expect(STORM).toMatchObject({ lon: 50.9, lat: -11.9, mag: 30, unit: 'kts', category: 'severeStorms', from: 'JTWC', closed: null });
    expect(STORM.first).toBe('2026-11-07T18:00:00Z');
    expect(STORM.date).toBe('2026-11-08T12:00:00Z');
    // Whatever order the reports come in.
    expect(reduced({ ...RAW_STORM, geometry: [...RAW_STORM.geometry].reverse() })).toEqual(STORM);
  });

  it('marks a polygon at the middle of its box', () => {
    expect(FLOOD.lon).toBeCloseTo(-16.285);
    expect(FLOOD.lat).toBeCloseTo(33.126);
    expect(geometryPosition({ type: 'LineString', coordinates: [[0, 0]] })).toBeNull();
  });

  it('drops what cannot be placed or dated', () => {
    expect(reduceEvent({ ...RAW_FIRE, geometry: [] })).toBeNull();
    expect(reduceEvent({ ...RAW_FIRE, categories: [] })).toBeNull();
    expect(reduceEvent({ ...RAW_FIRE, geometry: [{ type: 'Point', coordinates: [10, 95], date: '2026-11-07T19:00:00Z' }] })).toBeNull();
    expect(reduceEvent({ ...RAW_FIRE, geometry: [{ type: 'Point', coordinates: [10, 5], date: 'soon' }] })).toBeNull();
    expect(reduceEvent(null)).toBeNull();
  });

  it('merges answers: each event once, latest report first', () => {
    const events = reduceAnswers([{ events: [RAW_VOLCANO, RAW_STORM] }, { events: [RAW_FIRE, RAW_STORM] }]);
    expect(events.map((e) => e.id)).toEqual(['EONET_26159', 'EONET_26166', 'EONET_20710']);
    expect(() => reduceAnswers([{ title: 'no list' }])).toThrow();
  });
});

interface FakeIo extends HazardIo {
  cache: string | null;
  readonly errors: string[];
}

function fakeIo(overrides: Partial<HazardIo>): FakeIo {
  const io: FakeIo = {
    cache: null,
    errors: [],
    fetchQuery: () => Promise.reject(new Error('offline')),
    fetchSnapshot: () => Promise.reject(new Error('no snapshot')),
    readCache: () => io.cache,
    writeCache: (value) => {
      io.cache = value;
    },
    wallNow: () => NOW,
    reportError: (message) => {
      io.errors.push(message);
    },
    ...overrides,
  };
  return io;
}

describe('loadHazards', () => {
  it('asks both queries, merges them, caches the result and calls it live', async () => {
    const asked: string[] = [];
    const io = fakeIo({
      fetchQuery: (query) => {
        asked.push(query);
        return Promise.resolve({ events: query.includes('status=open') ? [RAW_VOLCANO, RAW_STORM] : [RAW_FIRE] });
      },
    });
    const data = await loadHazards(io);
    expect(asked).toEqual([...EONET_QUERIES]);
    expect(data.source).toBe('live');
    expect(data.events).toHaveLength(3);
    expect(data.fetchedMs).toBe(NOW);
    expect(JSON.parse(io.cache ?? '{}').events).toHaveLength(3);
    expect(hazardStatus(data)).toEqual({ text: 'live · 3 events · 22:00 UTC', tone: 'live' });
  });

  it('falls back to the cache, dated, and never calls it live', async () => {
    const io = fakeIo({});
    io.cache = JSON.stringify({ fetchedMs: NOW - 86400000, events: [FIRE] });
    const data = await loadHazards(io);
    expect(data.source).toBe('cache');
    expect(hazardStatus(data)).toEqual({ text: 'offline · list of 8 Nov 2026 22:00 UTC', tone: 'stale' });
    expect(io.errors[0]).toContain('EONET unavailable');
  });

  it('falls back to the baked snapshot when there is no cache, or the snapshot is newer', async () => {
    const snapshot = { generated: '2026-11-10T04:17:07Z', events: [VOLCANO, FIRE] };
    const io = fakeIo({ fetchSnapshot: () => Promise.resolve(snapshot) });
    const data = await loadHazards(io);
    expect(data.source).toBe('snapshot');
    expect(data.events).toHaveLength(2);
    expect(hazardStatus(data)).toEqual({ text: 'offline · snapshot 10 Nov 2026', tone: 'stale' });
    io.cache = JSON.stringify({ fetchedMs: Date.parse('2026-11-01T00:00:00Z'), events: [FIRE] });
    expect((await loadHazards(io)).source).toBe('snapshot');
    io.cache = JSON.stringify({ fetchedMs: Date.parse('2026-11-20T00:00:00Z'), events: [FIRE] });
    expect((await loadHazards(io)).source).toBe('cache');
  });

  it('keeps what it holds over an older fallback, demoted from live', async () => {
    const io = fakeIo({});
    const held = { source: 'live' as const, events: [STORM], fetchedMs: NOW };
    const data = await loadHazards(io, held);
    expect(data.source).toBe('cache');
    expect(data.events).toEqual([STORM]);
  });

  it('reports an error state with nothing to show', async () => {
    const data = await loadHazards(fakeIo({}));
    expect(data).toEqual({ source: 'none', events: [], fetchedMs: null });
    expect(hazardStatus(data).tone).toBe('error');
  });

  it('survives an unreadable cache and a malformed answer', async () => {
    const io = fakeIo({ fetchQuery: () => Promise.resolve({ nothing: true }) });
    io.cache = '{not json';
    expect((await loadHazards(io)).source).toBe('none');
  });
});

describe('the app clock', () => {
  it('hides events not yet reported and fades fires as their report ages', () => {
    const all = [STORM, FIRE, VOLCANO];
    expect(eventsBy(all, NOW)).toEqual(all);
    expect(eventsBy(all, Date.parse('2026-11-07T20:00:00Z'))).toEqual([FIRE, VOLCANO]);
    expect(eventsBy(all, Date.parse('2026-01-01T00:00:00Z'))).toEqual([]);
    expect(hazardAlpha(FIRE, Date.parse(FIRE.date))).toBe(1);
    expect(hazardAlpha(FIRE, Date.parse(FIRE.date) + 7 * 86400000)).toBeCloseTo((1 + OLDEST_ALPHA) / 2);
    expect(hazardAlpha(FIRE, Date.parse(FIRE.date) + 30 * 86400000)).toBeCloseTo(OLDEST_ALPHA);
    // An eruption reported in June is still an eruption.
    expect(hazardAlpha(VOLCANO, NOW)).toBe(1);
    const markers = hazardMarkers([FIRE, VOLCANO], NOW);
    expect(markers.find((m) => m.shape === 'disc')?.alpha).toBeLessThan(1);
    expect(markers.find((m) => m.shape === 'triangle')?.alpha).toBe(1);
  });

  it('counts ages from it', () => {
    expect(ageText(20 * 60000)).toBe('just now');
    expect(ageText(5.5 * 3600000)).toBe('5 h ago');
    expect(ageText(47 * 3600000)).toBe('47 h ago');
    expect(ageText(3.2 * 86400000)).toBe('3 d ago');
  });
});

describe('symbols and labels', () => {
  it('draws each kind in its own shape and colour', () => {
    expect(categoryOf(FIRE).shape).toBe('disc');
    expect(categoryOf(VOLCANO).shape).toBe('triangle');
    expect(categoryOf(STORM).shape).toBe('ring');
    expect(categoryOf(FLOOD).shape).toBe('diamond');
    expect(categoryOf(ICEBERG).shape).toBe('square');
    expect(categoryOf({ ...FIRE, category: 'dustHaze' })).toBe(OTHER_HAZARD);
    const colors = [...HAZARD_CATEGORIES, OTHER_HAZARD].map((c) => c.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('sizes fires by area whichever unit they come in', () => {
    expect(fireHectares(FIRE)).toBe(5123);
    expect(fireHectares({ ...FIRE, mag: 1000, unit: 'acres' })).toBeCloseTo(404.686);
    expect(fireHectares(VOLCANO)).toBeNull();
    expect(hazardSizePx({ ...FIRE, mag: 100 })).toBeCloseTo(5.5);
    expect(hazardSizePx({ ...FIRE, mag: 100000 })).toBeCloseTo(12.5);
    expect(hazardSizePx({ ...FIRE, mag: 5 })).toBe(5.5);
    expect(hazardSizePx(STORM)).toBeGreaterThan(hazardSizePx(VOLCANO));
  });

  it('draws storms and eruptions over the crowd of fires', () => {
    const markers = hazardMarkers([STORM, VOLCANO, FIRE, ICEBERG, FLOOD], NOW);
    expect(markers.map((m) => m.shape)).toEqual(['disc', 'diamond', 'square', 'triangle', 'ring']);
  });

  it('labels with title, magnitude as given and age or standing', () => {
    expect(cleanTitle('Wildfire in Australia 1033644')).toBe('Wildfire in Australia');
    expect(cleanTitle('Iceberg D35')).toBe('Iceberg D35');
    expect(magnitudeText(ICEBERG)).toBe('20 nmi²');
    expect(hazardLabelText(FIRE, NOW)).toBe('● Wildfire in Australia · 5,123 ha · 2 d ago');
    expect(cleanTitle('Fuego Volcano, Guatemala')).toBe('Fuego, Guatemala');
    expect(hazardLabelText(FIRE, Date.parse('2026-11-07T22:00:00Z'))).toBe('● Wildfire in Australia · 5,123 ha · 3 h ago');
    expect(hazardLabelText(STORM, NOW)).toBe('◯ Tropical Cyclone 03S · 30 kt · 34 h ago');
    expect(hazardLabelText(VOLCANO, NOW)).toBe('▲ Nevados del Chillan, Chile · since Jun 2026');
    expect(hazardLabelText(FLOOD, NOW)).toBe('◆ Flood in Portugal · 3 d ago');
  });

  it('labels storms first, then eruptions, then the largest fires', () => {
    const fires = Array.from({ length: 20 }, (_, i): HazardEvent => ({ ...FIRE, id: `F${i}`, mag: 1000 + i }));
    const picked = pickLabelled([...fires, VOLCANO, FLOOD, STORM, ICEBERG]);
    expect(picked[0]).toBe(STORM);
    expect(picked[1]).toBe(VOLCANO);
    const pickedFires = picked.filter((e) => e.category === 'wildfires');
    expect(pickedFires).toHaveLength(LABEL_LIMITS.wildfires);
    expect(pickedFires.map((e) => e.id)).toEqual(['F19', 'F18', 'F17', 'F16', 'F15', 'F14', 'F13', 'F12']);
    expect(picked).toContain(FLOOD);
    expect(picked).toContain(ICEBERG);
  });
});

describe('the layer definition', () => {
  it('is off by default and names every kind in its caption', () => {
    expect(hazardsLive.id).toBe('hazards-live');
    expect(hazardsLive.defaultOn).toBeUndefined();
    for (const category of HAZARD_CATEGORIES) expect(hazardsLive.caption).toContain(category.label);
    expect(hazardsLive.credits[0].source).toContain('EONET');
  });
});
