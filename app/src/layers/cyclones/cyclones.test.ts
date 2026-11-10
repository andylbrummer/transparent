import { describe, expect, it, vi } from 'vitest';
import {
  listUrl,
  loadLive,
  parseAdvisoryTime,
  parseCone,
  parseEventList,
  parseIsoUtc,
  parseTimeline,
  stormName,
  timelineUrlOf,
  type LiveIo,
  type LiveStorm,
  type TrackPoint,
} from './gdacs';
import { coneGeometry, forecastLabel, legSegments, liveStatus, stormLabel, stormView } from './live';
import { CLASS_COLORS, CLASS_MIN_KT, cycloneClass, ktToKmh, scaleLegend, windColor, UNKNOWN_WIND_COLOR } from './scale';
import { symbolSizePx } from './symbols';
import {
  decodeTracks,
  peakPoint,
  stormFixAt,
  stormLabelText,
  stormLabels,
  stormsUnderWay,
  trackSegments,
  tracksStatus,
  underWayLabelText,
  type TrackIndex,
} from './tracks';
import cycloneLayers from './layer';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('the Saffir-Simpson scale', () => {
  it('puts winds in the classes the scale defines', () => {
    expect([0, 33, 34, 63, 64, 82, 83, 95, 96, 112, 113, 136, 137, 185].map(cycloneClass)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    expect(CLASS_MIN_KT).toHaveLength(CLASS_COLORS.length);
  });

  it('colours a wind by its class and an absent wind apart', () => {
    expect(windColor(150)).toBe(CLASS_COLORS[6]);
    expect(windColor(40)).toBe(CLASS_COLORS[1]);
    expect(windColor(0)).toBe(UNKNOWN_WIND_COLOR);
  });

  it('converts knots as advisories do', () => {
    expect(ktToKmh(100)).toBe(185);
    expect(ktToKmh(35)).toBe(65);
  });

  it('draws a legend of seven hard bands', () => {
    const legend = scaleLegend();
    expect(legend.match(/#[0-9a-f]{6}/g)).toHaveLength(7);
    expect(legend).toContain('#ff6060 85.71% 100.00%');
    for (const layer of cycloneLayers) expect(layer.legend).toBe(legend);
  });

  it('sizes the symbol by wind within bounds', () => {
    expect(symbolSizePx(0)).toBe(18);
    expect(symbolSizePx(140)).toBe(30);
    expect(symbolSizePx(185)).toBe(30);
  });
});

/** Two storms: A of three points from 2005-08-27 00:00, B of two over the date line. */
function fixture(): { index: TrackIndex; buffer: ArrayBuffer } {
  const lonLat = [-8500, 2400, -8600, 2450, -8800, 2600, 17950, -1500, -17950, -1700];
  const minutes = [0, 360, 720, 0, 360];
  const winds = [30, 100, 150, 100, 0];
  const n = winds.length;
  const buffer = new ArrayBuffer(7 * n);
  const view = new DataView(buffer);
  lonLat.forEach((v, i) => view.setInt16(2 * i, v, true));
  minutes.forEach((v, i) => view.setUint16(4 * n + 2 * i, v, true));
  winds.forEach((v, i) => view.setUint8(6 * n + i, v));
  const index: TrackIndex = {
    source: 'test',
    firstSeason: 1980,
    majorKt: 96,
    lastRecord: '2010-01-01T06:00Z',
    pointCount: n,
    storms: [
      { id: 'A', name: 'Alpha', basin: 'NA', start: '2005-08-27T00:00Z', points: 3, maxWindKt: 150, minPressureHpa: 902, featured: true },
      { id: 'B', name: '', basin: 'SP', start: '2010-01-01T00:00Z', points: 2, maxWindKt: 100, minPressureHpa: null },
    ],
  };
  return { index, buffer };
}

describe('the baked tracks', () => {
  const { index, buffer } = fixture();
  const tracks = decodeTracks(index, buffer);
  const [alpha, nameless] = tracks.storms;

  it('decodes the three blocks onto the storms', () => {
    expect(alpha.offset).toBe(0);
    expect(nameless.offset).toBe(3);
    expect(alpha.startMs).toBe(Date.UTC(2005, 7, 27));
    expect(alpha.endMs).toBe(Date.UTC(2005, 7, 27, 12));
    expect([...tracks.winds]).toEqual([30, 100, 150, 100, 0]);
    expect(tracks.lonLat[6]).toBe(17950);
  });

  it('refuses a binary of the wrong length', () => {
    expect(() => decodeTracks(index, buffer.slice(1))).toThrow(/bytes/);
    expect(() => decodeTracks({ ...index, storms: index.storms.slice(0, 1) }, buffer)).toThrow(/points/);
  });

  it('makes one segment per leg, weakest first, on the sphere', () => {
    const { positions, colors } = trackSegments(tracks, tracks.storms);
    expect(positions).toHaveLength(3 * 6);
    expect(colors).toHaveLength(3 * 6);
    // Alpha's 30 kt leg first, then the two 100 kt legs.
    expect(colors[0]).toBeCloseTo(0x5e / 255, 5);
    expect(Math.hypot(positions[0], positions[1], positions[2])).toBeCloseTo(6_371_000, -3);
  });

  it('cuts tracks at an instant and filters legs by wind', () => {
    expect(trackSegments(tracks, [alpha], alpha.startMs + 7 * HOUR).positions).toHaveLength(6);
    expect(trackSegments(tracks, [alpha], alpha.startMs).positions).toHaveLength(0);
    expect(trackSegments(tracks, tracks.storms, Infinity, (kt) => kt >= 64).positions).toHaveLength(2 * 6);
  });

  it('finds the storms under way at an instant', () => {
    expect(stormsUnderWay(tracks, alpha.startMs + HOUR)).toEqual([alpha]);
    expect(stormsUnderWay(tracks, alpha.endMs + 1)).toEqual([]);
  });

  it('places a storm between its records', () => {
    expect(stormFixAt(tracks, alpha, alpha.startMs + 3 * HOUR)).toEqual({ lon: -85.5, lat: 24.25, windKt: 30 });
    expect(stormFixAt(tracks, alpha, alpha.endMs)).toEqual({ lon: -88, lat: 26, windKt: 150 });
    expect(stormFixAt(tracks, alpha, alpha.endMs + 1)).toBeNull();
    expect(stormFixAt(tracks, alpha, alpha.startMs - 1)).toBeNull();
  });

  it('takes the short way over the date line', () => {
    const fix = stormFixAt(tracks, nameless, nameless.startMs + 3 * HOUR);
    expect(Math.abs(fix?.lon ?? 0)).toBeCloseTo(180, 5);
    expect(fix?.lat).toBeCloseTo(-16, 5);
  });

  it('names storms at their peak', () => {
    expect(peakPoint(tracks, alpha)).toBe(2);
    expect(stormLabelText(alpha)).toBe('Alpha 2005 · 150 kt · 902 hPa');
    expect(stormLabelText(nameless)).toBe('2010 storm · 100 kt');
    expect(underWayLabelText(alpha, { lon: 0, lat: 0, windKt: 150 })).toBe('Alpha · Cat 5 · 150 kt');
    expect(underWayLabelText(nameless, { lon: 0, lat: 0, windKt: 0 })).toBe('Unnamed storm');
    const [featured, others] = stormLabels(tracks);
    expect(featured.map((l) => l.text)).toEqual(['Alpha 2005 · 150 kt · 902 hPa']);
    expect(others).toHaveLength(1);
  });

  it('reports the archive, or the storms under way', () => {
    expect(tracksStatus(tracks, [], 0)).toBe('2 storms · 2005–2010');
    expect(tracksStatus(tracks, [alpha], Date.UTC(2005, 7, 27, 6))).toBe('27 Aug 2005: Alpha');
  });
});

describe('reading GDACS', () => {
  it('reads its two ways of writing a UTC time', () => {
    expect(parseIsoUtc('2026-11-10T03:35:03')).toBe(Date.UTC(2026, 10, 10, 3, 35, 3));
    expect(parseIsoUtc('2026-11-10T03:35:03Z')).toBe(Date.UTC(2026, 10, 10, 3, 35, 3));
    expect(parseIsoUtc(5)).toBeNaN();
    expect(parseAdvisoryTime('10 Nov 2026 00:00')).toBe(Date.UTC(2026, 10, 10));
    expect(parseAdvisoryTime('6 Nov 2026 06:00')).toBe(Date.UTC(2026, 10, 6, 6));
    expect(parseAdvisoryTime('11/3/2013 6:00:00 AM')).toBe(Date.UTC(2013, 10, 3, 6));
    expect(parseAdvisoryTime('11/7/2013 12:00:00 PM')).toBe(Date.UTC(2013, 10, 7, 12));
    expect(parseAdvisoryTime('11/8/2013 12:00:00 AM')).toBe(Date.UTC(2013, 10, 8));
    expect(parseAdvisoryTime('yesterday')).toBeNaN();
  });

  it('turns event names into storm names', () => {
    expect(stormName('CEMPAKA-26')).toBe('Cempaka');
    expect(stormName('THREE-C-26')).toBe('Three-C');
    expect(stormName('IN-FA-26')).toBe('In-Fa');
    expect(stormName('02-20262027-27')).toBe('TC 02-20262027');
    expect(stormName('')).toBe('Unnamed');
  });

  it('asks for the ten days up to the clock', () => {
    expect(listUrl(Date.UTC(2026, 10, 10, 4))).toBe(
      'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&fromdate=2026-10-31&todate=2026-11-11&alertlevel=Green;Orange;Red'
    );
  });

  const listJson = {
    type: 'FeatureCollection',
    features: [
      {
        properties: {
          eventtype: 'TC',
          eventid: 1001346,
          episodeid: 10,
          eventname: 'MURASU-26',
          source: 'JTWC',
          todate: '2026-11-03T06:00:00',
          datemodified: '2026-11-04T06:01:20',
        },
      },
      {
        properties: {
          eventtype: 'TC',
          eventid: 1001347,
          episodeid: 16,
          eventname: 'CEMPAKA-26',
          source: 'JTWC',
          todate: '2026-11-10T00:00:00',
          datemodified: '2026-11-10T03:35:03',
        },
      },
      { properties: { eventtype: 'EQ', eventid: 1, episodeid: 1, todate: '2026-11-10T00:00:00' } },
      { properties: { eventtype: 'TC', eventid: 'x', episodeid: 1, todate: '2026-11-10T00:00:00' } },
    ],
  };

  it('lists the cyclones, latest advisory first', () => {
    const storms = parseEventList(listJson);
    expect(storms.map((s) => s.name)).toEqual(['Cempaka', 'Murasu']);
    expect(storms[0]).toMatchObject({ id: 1001347, episode: 16, source: 'JTWC', toMs: Date.UTC(2026, 10, 10) });
    expect(() => parseEventList({ message: 'Eventtype is required.' })).toThrow();
  });

  const item = (time: string, lat: string, lon: string, wind: string, actual: string): Record<string, string> => ({
    advisory_datetime: time,
    latitude: lat,
    longitude: lon,
    wind_speed: wind,
    actual,
  });
  // As GDACS served Cempaka on 10 Nov 2026 (advisories 15 and 16 and the first two forecast points).
  const timelineJson = {
    channel: {
      item: [
        item('10 Nov 2026 00:00', '25', '138', '48.868', 'True'),
        item('09 Nov 2026 18:00', '24.6', '136.6', '48.868', 'True'),
        item('10 Nov 2026 12:00', '26.1', '141.8', '46.296', 'False'),
        item('11 Nov 2026 00:00', '27.5', '146.2', '41.152', 'False'),
        item('09 Nov 2026 12:00', '24.3', '135.3', '46.296', 'False'),
        item('never', '1', '1', '1', 'True'),
      ],
    },
  };

  it('reads a timeline: advisories, then the forecast, winds in knots', () => {
    const points = parseTimeline(timelineJson);
    expect(points.map((p) => [p.forecast, p.lat, p.lon, p.windKt])).toEqual([
      [false, 24.6, 136.6, 95],
      [false, 25, 138, 95],
      [true, 26.1, 141.8, 90],
      [true, 27.5, 146.2, 80],
    ]);
    expect(points[1].timeMs).toBe(Date.UTC(2026, 10, 10));
    expect(() => parseTimeline({})).toThrow();
  });

  it('finds the timeline and the cone', () => {
    const url = 'https://www.gdacs.org/gdacsapi/api/export/gettimeline?id=820792';
    expect(timelineUrlOf({ properties: { impacts: [{ resource: { timeline: url } }] } })).toBe(url);
    expect(timelineUrlOf({ properties: { impacts: [{ resource: { timeline: 'https://elsewhere.example/x' } }] } })).toBeNull();
    expect(timelineUrlOf({ properties: {} })).toBeNull();
    const ring = [
      [138, 24.75],
      [150, 26],
      [150, 30],
      [138, 24.75],
    ];
    const geometry = {
      features: [
        { properties: { Class: 'Poly_Green' }, geometry: { type: 'Polygon', coordinates: [[[0, 0]]] } },
        { properties: { Class: 'Poly_Cones' }, geometry: { type: 'Polygon', coordinates: [ring] } },
      ],
    };
    expect(parseCone(geometry)).toEqual([ring]);
    const halves = { features: [{ properties: { Class: 'Poly_Cones' }, geometry: { type: 'MultiPolygon', coordinates: [[ring], [ring]] } }] };
    expect(parseCone(halves)).toEqual([ring, ring]);
    expect(parseCone({ features: [] })).toBeNull();
  });

  const episodeJson = { properties: { impacts: [{ resource: { timeline: 'https://www.gdacs.org/gdacsapi/api/export/gettimeline?id=1' } }] } };

  function io(answers: (url: string) => unknown, cache: string | null = null, snapshot: unknown = null): LiveIo & { urls: string[]; written: string[] } {
    const urls: string[] = [];
    const written: string[] = [];
    return {
      urls,
      written,
      fetchJson: async (url) => {
        urls.push(url);
        return answers(url);
      },
      fetchSnapshot: async () => {
        if (snapshot === null) throw new Error('no snapshot');
        return snapshot;
      },
      readCache: () => cache,
      writeCache: (value) => void written.push(value),
      reportError: vi.fn(),
    };
  }
  const gdacs = (url: string): unknown => {
    if (url.includes('geteventlist')) return listJson;
    if (url.includes('getepisodedata')) return episodeJson;
    if (url.includes('gettimeline')) return timelineJson;
    if (url.includes('getgeometry')) return { features: [] };
    throw new Error(`unexpected ${url}`);
  };
  const now = Date.UTC(2026, 10, 10, 4);

  it('loads every listed storm, and the cone only of one with a fresh forecast', async () => {
    const world = io(gdacs);
    const data = await loadLive(world, now);
    expect(data.source).toBe('live');
    expect(data.storms.map((s) => s.name)).toEqual(['Murasu', 'Cempaka']);
    expect(data.dataMs).toBe(Date.UTC(2026, 10, 10, 3, 35, 3));
    expect(world.urls.filter((u) => u.includes('getgeometry'))).toEqual([
      'https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1001347&episodeid=16',
    ]);
    expect(world.written).toHaveLength(1);
  });

  it('does not fetch again a storm it holds at the same advisory', async () => {
    const first = await loadLive(io(gdacs), now);
    const world = io(gdacs);
    const second = await loadLive(world, now, first);
    expect(world.urls).toHaveLength(1);
    expect(second.storms).toEqual(first.storms);
  });

  it('counts a storm whose details fail and keeps the rest', async () => {
    const world = io((url) => {
      if (url.includes('eventid=1001346')) throw new Error('boom');
      return gdacs(url);
    });
    const data = await loadLive(world, now);
    expect(data.storms.map((s) => s.name)).toEqual(['Cempaka']);
    expect(data.missing).toBe(1);
  });

  it('reports no storms as live, not as a failure', async () => {
    const data = await loadLive(io(() => ({ type: 'FeatureCollection', features: [] })), now);
    expect(data).toMatchObject({ source: 'live', storms: [], dataMs: null });
    expect(liveStatus(data, [], now)).toEqual({ text: 'live · no active storms', tone: 'live' });
  });

  it('falls back to the cache, then the snapshot, then nothing', async () => {
    const live = await loadLive(io(gdacs), now);
    const down = (): unknown => {
      throw new Error('offline');
    };
    const cached = await loadLive(io(down, JSON.stringify({ dataMs: 5, storms: live.storms })), now);
    expect(cached.source).toBe('cache');
    expect(cached.storms).toHaveLength(2);
    const snapshot = await loadLive(io(down, null, { generated: '2026-11-10T04:00:00Z', storms: live.storms }), now);
    expect(snapshot).toMatchObject({ source: 'snapshot', dataMs: Date.UTC(2026, 10, 10, 4) });
    expect(liveStatus(snapshot, [], now).text).toBe('offline · snapshot 10 Nov 2026');
    expect(liveStatus(snapshot, [], now).tone).toBe('stale');
    const nothing = await loadLive(io(down, 'not json'), now);
    expect(nothing.source).toBe('none');
    expect(liveStatus(nothing, [], now)).toEqual({ text: 'no data · GDACS unreachable', tone: 'error' });
    const held = await loadLive(io(down), now, live);
    expect(held.source).toBe('cache');
  });

  it('prefers the kept data nearest the clock', async () => {
    const live = await loadLive(io(gdacs), now);
    const old: LiveStorm = { ...live.storms[0], points: live.storms[0].points.map((p) => ({ ...p, timeMs: p.timeMs - 400 * DAY })) };
    const down = (): unknown => {
      throw new Error('offline');
    };
    const data = await loadLive(io(down, JSON.stringify({ dataMs: 1, storms: [old] }), { generated: '2026-11-10T04:00:00Z', storms: live.storms }), now);
    expect(data.source).toBe('snapshot');
  });
});

describe('a storm at the app clock', () => {
  const t0 = Date.UTC(2026, 10, 9, 18);
  const point = (hours: number, lon: number, lat: number, windKt: number, forecast = false): TrackPoint => ({
    timeMs: t0 + hours * HOUR,
    lon,
    lat,
    windKt,
    forecast,
  });
  const storm: LiveStorm = {
    id: 1,
    episode: 3,
    name: 'Cempaka',
    source: 'JTWC',
    points: [point(-6, 135, 24, 90), point(0, 136, 24.5, 95), point(6, 138, 25, 95), point(18, 142, 26, 90, true), point(30, 146, 27.5, 45, true)],
    cone: null,
  };

  it('is not drawn before it begins', () => {
    expect(stormView(storm, t0 - 7 * HOUR)).toBeNull();
  });

  it('inside its track is cut at the clock, without a forecast', () => {
    const view = stormView(storm, t0 + 3 * HOUR);
    expect(view?.state).toBe('under-way');
    expect(view?.track).toHaveLength(2);
    expect(view?.fix).toEqual({ lon: 137, lat: 24.75, windKt: 95 });
    expect(view?.forecast).toEqual([]);
    expect(view?.advisoryAgeMs).toBeNull();
    expect(view && stormLabel(view)).toBe('Cempaka · Cat 2 · 95 kt');
  });

  it('after its latest advisory shows that advisory and the forecast from it', () => {
    const view = stormView(storm, t0 + 10 * HOUR);
    expect(view?.state).toBe('under-way');
    expect(view?.track).toHaveLength(3);
    expect(view?.fix).toEqual({ lon: 138, lat: 25, windKt: 95 });
    expect(view?.forecast.map((p) => p.lon)).toEqual([138, 142, 146]);
    expect(view && stormLabel(view)).toBe('Cempaka · Cat 2 · 95 kt · advisory 4 h ago');
    expect(view && forecastLabel(view.forecast[2])).toBe('→ 11 Nov 00:00 UTC · TS · 45 kt');
  });

  it('stays under way through a silence while its forecast runs, then ends', () => {
    expect(stormView(storm, t0 + 6 * HOUR + 20 * HOUR)?.state).toBe('under-way');
    // The forecast has run out at +30 h.
    expect(stormView(storm, t0 + 31 * HOUR)?.state).toBe('ended');
    const ended = stormView(storm, t0 + 5 * DAY);
    expect(ended?.forecast).toEqual([]);
    expect(ended && stormLabel(ended)).toBe('ex-Cempaka · peak 95 kt · ended 10 Nov');
    expect(stormView(storm, t0 + 11 * DAY)).toBeNull();
  });

  it('ends at once when its final advisory has no forecast', () => {
    const final: LiveStorm = { ...storm, points: storm.points.filter((p) => !p.forecast) };
    expect(stormView(final, t0 + 6 * HOUR + 11 * HOUR)?.state).toBe('under-way');
    expect(stormView(final, t0 + 6 * HOUR + 13 * HOUR)?.state).toBe('ended');
  });

  it('says how many are active and when GDACS last spoke', () => {
    const view = stormView(storm, t0 + 10 * HOUR);
    const data = { source: 'live' as const, storms: [storm], dataMs: Date.UTC(2026, 10, 10, 3, 35), missing: 0 };
    const at = t0 + 10 * HOUR;
    expect(liveStatus(data, view ? [view] : [], at)).toEqual({ text: 'live · 1 active · 03:35 UTC', tone: 'live' });
    expect(liveStatus({ ...data, missing: 2 }, view ? [view] : [], at).text).toBe('live · 1 active · 03:35 UTC · 2 unread');
    expect(liveStatus({ ...data, dataMs: at + 30 * DAY }, view ? [view] : [], at).text).toBe('live · 1 active · as of 10 Nov 2026');
    expect(liveStatus({ ...data, source: 'cache' }, [], at).text).toBe('offline · data of 10 Nov 2026 03:35 UTC');
  });

  it('builds a segment per leg', () => {
    const { positions, colors } = legSegments([storm.points.slice(0, 3), [], [storm.points[0]]]);
    expect(positions).toHaveLength(12);
    expect(colors).toHaveLength(12);
  });

  it('triangulates a cone, over the date line too', () => {
    const square: [number, number][] = [
      [179, 10],
      [-179, 10],
      [-179, 12],
      [179, 12],
      [179, 10],
    ];
    const { triangles, outline } = coneGeometry(square);
    expect(triangles).toHaveLength(2 * 9);
    // The two edges along the date line... there are none here: 179 and -179 are a degree off it.
    expect(outline).toHaveLength(4 * 6);
    const half: [number, number][] = [
      [180, 10],
      [180, 12],
      [178, 12],
      [178, 10],
      [180, 10],
    ];
    expect(coneGeometry(half).outline).toHaveLength(3 * 6);
    // Every corner stays near the date line: no triangle spans the globe.
    for (let i = 0; i < triangles.length; i += 3) expect(triangles[i]).toBeLessThan(-6_000_000);
  });
});
