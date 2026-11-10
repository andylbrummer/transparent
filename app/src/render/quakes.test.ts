import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DEPTH_RAMP, depthColor, depthRampGradient, ecefAtDepth } from './interior';
import { LABEL_KIND_ORDER, LabelLayer, type LabelData } from './labels';
import { QuakeLayer, quakeDrawOrder, quakePointSizePx, quakeTimesMs, type QuakeData } from './quakes';

/**
 * Six real rows of app/public/geo/quakes.json (USGS ComCat), in file order,
 * each with where it must land: ECEF metres on the 6,371,000 m sphere,
 * worked outside the app (Python, r·cosφ·cosλ, r·cosφ·sinλ, r·sinφ with
 * r = 6371000 − 1000·depth) from the row's own numbers.
 */
const EVENTS = [
  // usp0000dce, 1975-10-31T16:02:50Z, south of Fiji: longitude 180 exactly.
  { minute: 3066722, lon: 18000, lat: -2353, depthKm: 515, magnitude10: 52, ecef: [-5369080.4, 0.0, -2337886.1] },
  // nc216859, 1989-10-18T00:04:15Z, Loma Prieta.
  { minute: 10411204, lon: -12188, lat: 3704, depthKm: 17, magnitude10: 69, ecef: [-2678661.6, -4306800.1, 3827474.4] },
  // usp0006dzc, 1994-06-09T00:33:16Z, Bolivia, 631 km deep.
  { minute: 12852033, lon: -6755, lat: -1384, depthKm: 631, magnitude10: 82, ecef: [2128335.8, -5150966.5, -1373073.3] },
  // official20110311054624120_30, 2011-03-11T05:46:24Z, Tōhoku.
  { minute: 21663706, lon: 14237, lat: 3830, depthKm: 29, magnitude10: 91, ecef: [-3941676.0, 3038788.3, 3930638.6] },
  // us1000gcii, 2018-08-19T00:19:40Z, Fiji, 600 km deep, west of the antimeridian.
  { minute: 25577299, lon: -17815, lat: -1811, depthKm: 600, magnitude10: 82, ecef: [-5482254.3, -177075.8, -1793871.0] },
  // us6000b9kr, 2020-08-05T08:48:05Z, Gakkel Ridge, 87.39° N.
  { minute: 26610288, lon: 707, lat: 8739, depthKm: 10, magnitude10: 53, ecef: [287460.6, 35652.3, 6354401.3] },
] as const;

const DATA: QuakeData = {
  quantumPerDegree: 100,
  minute: EVENTS.map((e, i) => e.minute - (i === 0 ? 0 : EVENTS[i - 1].minute)),
  lon: EVENTS.map((e) => e.lon),
  lat: EVENTS.map((e) => e.lat),
  depthKm: EVENTS.map((e) => e.depthKm),
  magnitude10: EVENTS.map((e) => e.magnitude10),
  labels: [
    { kind: 'quake', name: 'M9.1 Japan 2011', lon: 142.37, lat: 38.3, depthKm: 29, priority: 0.9 },
    { kind: 'quake', name: 'M8.2 Fiji 2018', lon: -178.15, lat: -18.11, depthKm: 600, priority: 1.8 },
    { kind: 'quake', name: 'M8.2 Bolivia 1994', lon: -67.55, lat: -13.84, depthKm: 631, priority: 1.8 },
  ],
};

describe('quakePointSizePx', () => {
  it('grows by magnitude, star-map style', () => {
    expect(quakePointSizePx(5)).toBeCloseTo(1.6, 9);
    expect(quakePointSizePx(9.1)).toBeGreaterThan(9);
    expect(quakePointSizePx(9.1)).toBeLessThan(10);
  });

  it('grows by the same factor for every magnitude step', () => {
    for (const m of [5, 6, 7, 8]) expect(quakePointSizePx(m + 1) / quakePointSizePx(m)).toBeCloseTo(1.55, 9);
  });
});

describe('quakeTimesMs', () => {
  it('sums the minute deltas into origin times', () => {
    const times = quakeTimesMs(DATA);
    expect(new Date(times[0]).toISOString()).toBe('1975-10-31T16:02:00.000Z');
    expect(new Date(times[3]).toISOString()).toBe('2011-03-11T05:46:00.000Z');
    expect(new Date(times[5]).toISOString()).toBe('2020-08-05T08:48:00.000Z');
  });
});

describe('quakeDrawOrder', () => {
  it('puts the greatest last and keeps equals oldest first', () => {
    // Magnitudes 5.2, 6.9, 8.2, 9.1, 8.2, 5.3.
    expect([...quakeDrawOrder(DATA)]).toEqual([0, 5, 1, 2, 4, 3]);
  });
});

describe('QuakeLayer', () => {
  const layer = new QuakeLayer(DATA);
  const geometry = (layer.getObject() as THREE.Points).geometry;
  const order = [...quakeDrawOrder(DATA)];
  const drawn = (event: number): number => order.indexOf(event);
  const positionOf = (event: number): THREE.Vector3 =>
    new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), drawn(event));

  it('places every quake at its hypocentre', () => {
    EVENTS.forEach((event, i) => {
      const p = positionOf(i);
      // Float32 holds 6,371 km to half a metre.
      expect(p.x).toBeCloseTo(event.ecef[0], -0.5);
      expect(p.y).toBeCloseTo(event.ecef[1], -0.5);
      expect(p.z).toBeCloseTo(event.ecef[2], -0.5);
    });
  });

  it('measures depth straight down from a 6371 km sphere, unexaggerated', () => {
    EVENTS.forEach((event, i) => {
      expect((6371000 - positionOf(i).length()) / 1000).toBeCloseTo(event.depthKm, 2);
    });
  });

  it('puts east longitudes at +y, north latitudes at +z, and 180° on the −x axis', () => {
    expect(positionOf(3).y).toBeGreaterThan(0); // Japan, 142° E
    expect(positionOf(1).y).toBeLessThan(0); // California, 122° W
    expect(positionOf(2).z).toBeLessThan(0); // Bolivia, 14° S
    expect(positionOf(5).z).toBeGreaterThan(6.35e6); // 87° N
    expect(positionOf(0).x).toBeLessThan(0);
    expect(Math.abs(positionOf(0).y)).toBeLessThan(1);
    // Fiji at 178.15° W sits just across the antimeridian from the 180° event, not on the far side.
    expect(positionOf(4).y).toBeLessThan(0);
    expect(positionOf(4).y).toBeGreaterThan(-200000);
  });

  it('colours by depth on the legend ramp and sizes by magnitude', () => {
    const color = geometry.getAttribute('aColor');
    const size = geometry.getAttribute('aSize');
    const expected = new THREE.Color();
    EVENTS.forEach((event, i) => {
      depthColor(event.depthKm, expected);
      expect(color.getX(drawn(i))).toBeCloseTo(expected.r, 6);
      expect(color.getY(drawn(i))).toBeCloseTo(expected.g, 6);
      expect(color.getZ(drawn(i))).toBeCloseTo(expected.b, 6);
      expect(size.getX(drawn(i))).toBeCloseTo(quakePointSizePx(event.magnitude10 / 10), 5);
    });
    // Drawn last, so on top: Tōhoku, the largest.
    expect(drawn(3)).toBe(EVENTS.length - 1);
  });

  it('draws after everything else inside the Earth, without a depth test', () => {
    const points = layer.getObject() as THREE.Points;
    const material = points.material as THREE.ShaderMaterial;
    expect(points.renderOrder).toBe(3);
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(points.frustumCulled).toBe(false);
  });

  it('puts each label on its point', () => {
    const container = document.createElement('div');
    const labels = new LabelLayer(container, [DATA as LabelData]);
    const placed = (labels as unknown as { placed: { name: string; position: THREE.Vector3 }[] }).placed;
    const byName = new Map(placed.map((p) => [p.name, p.position]));
    expect(byName.get('M9.1 Japan 2011')?.distanceTo(positionOf(3))).toBeLessThan(2);
    expect(byName.get('M8.2 Fiji 2018')?.distanceTo(positionOf(4))).toBeLessThan(2);
    expect(byName.get('M8.2 Bolivia 1994')?.distanceTo(positionOf(2))).toBeLessThan(2);
    expect(LABEL_KIND_ORDER).toContain('quake');
  });
});

describe('depth colours', () => {
  const hex = (depthKm: number): string => `#${depthColor(depthKm, new THREE.Color()).getHexString()}`;

  it('run red at the surface to violet at 700 km, clamped beyond', () => {
    expect(hex(0)).toBe('#ff453a');
    expect(hex(-3)).toBe('#ff453a');
    expect(hex(70)).toBe('#ff9f0a');
    expect(hex(300)).toBe('#32d74b');
    expect(hex(700)).toBe('#bf5af2');
    expect(hex(900)).toBe('#bf5af2');
  });

  it('are the colours of the legend, stop for stop', () => {
    const gradient = depthRampGradient(700);
    for (const stop of DEPTH_RAMP) {
      const percent = ((stop.depthKm / 700) * 100).toFixed(1);
      expect(gradient).toContain(`${hex(stop.depthKm)} ${percent}%`);
    }
    expect(DEPTH_RAMP[DEPTH_RAMP.length - 1].depthKm).toBe(700);
  });
});

describe('the sphere against the WGS84 ellipsoid', () => {
  const A = 6378137;
  const E2 = 0.00669437999014;
  /** Geodetic position to true Earth-centred metres. */
  function wgs84(lonDeg: number, latDeg: number, heightM: number): THREE.Vector3 {
    const lon = (lonDeg * Math.PI) / 180;
    const lat = (latDeg * Math.PI) / 180;
    const n = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
    return new THREE.Vector3(
      (n + heightM) * Math.cos(lat) * Math.cos(lon),
      (n + heightM) * Math.cos(lat) * Math.sin(lon),
      (n * (1 - E2) + heightM) * Math.sin(lat)
    );
  }

  it('is off by 7 to 22 km in absolute place, the same at every depth', () => {
    let worst = 0;
    for (let lat = -90; lat <= 90; lat += 5) {
      const surface = ecefAtDepth(20, lat, 0, new THREE.Vector3()).distanceTo(wgs84(20, lat, 0));
      const deep = ecefAtDepth(20, lat, 700, new THREE.Vector3()).distanceTo(wgs84(20, lat, -700000));
      expect(surface).toBeGreaterThan(7000);
      expect(Math.abs(deep - surface)).toBeLessThan(0.01);
      worst = Math.max(worst, surface);
    }
    expect(worst).toBeGreaterThan(21000);
    expect(worst).toBeLessThan(22000);
  });

  it('keeps a hypocentre exactly under its epicentre: depth runs along the ellipsoid normal', () => {
    for (const [lon, lat, depthKm] of [[142.37, 38.3, 29], [-178.15, -18.11, 600], [-67.55, -13.84, 631]]) {
      const app = ecefAtDepth(lon, lat, 0, new THREE.Vector3()).sub(ecefAtDepth(lon, lat, depthKm, new THREE.Vector3()));
      const truth = wgs84(lon, lat, 0).sub(wgs84(lon, lat, -depthKm * 1000));
      expect(app.distanceTo(truth)).toBeLessThan(0.01);
    }
  });
});
