import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { raDecToUnit, separationDeg, sunGeocentricAu } from '@transparent-earth/core';
import {
  bodyAlpha,
  bodyLabel,
  bodyMagnitude,
  bodySizePx,
  cometLabel,
  cometSizePx,
  magnitudeText,
  tailMarkEnd,
  type Comet,
  type NamedBody,
  type SmallBodyData,
} from './bodies';
import { cometMagnitude, earthAt, emptyView, viewFromEarth } from './kepler';
import LAYERS, { COMET_MAG_LIMIT } from './layer';

const raw = import.meta.glob('../../../public/sky/small-bodies.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const data = JSON.parse(Object.values(raw)[0]) as SmallBodyData;
const body = (name: string): NamedBody => {
  const found = data.bodies.find((b) => b.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

describe('the baked list', () => {
  it('has the five dwarf planets, the big asteroids and the bake’s comet limit', () => {
    expect(data.bodies.filter((b) => b.group === 'dwarf').map((b) => b.name)).toEqual(['Ceres', 'Pluto', 'Eris', 'Haumea', 'Makemake']);
    expect(data.bodies.filter((b) => b.group === 'asteroid')).toHaveLength(50);
    expect(data.cometMagLimit).toBe(COMET_MAG_LIMIT);
  });

  it('gives magnitudes that match what observers see', () => {
    const view = emptyView();
    const at = new Date('2026-11-10T00:00:00Z');
    const { jd, earth } = earthAt(at);
    const mag = (name: string): number => bodyMagnitude(body(name), viewFromEarth(body(name), jd, earth, view));
    // Pluto has been near magnitude 14.5 - 15 for years; Eris near 18.7; Vesta 6 - 8.5; Ceres 7 - 9.5.
    expect(mag('Pluto')).toBeGreaterThan(14);
    expect(mag('Pluto')).toBeLessThan(15.6);
    expect(mag('Eris')).toBeGreaterThan(18);
    expect(mag('Eris')).toBeLessThan(19.2);
    expect(mag('Vesta')).toBeGreaterThan(5.5);
    expect(mag('Vesta')).toBeLessThan(8.6);
    expect(mag('Ceres')).toBeGreaterThan(6.8);
    expect(mag('Ceres')).toBeLessThan(9.6);
  });

  it('puts Pluto in Capricornus and Eris in Cetus in late 2026', () => {
    const view = emptyView();
    const { jd, earth } = earthAt(new Date('2026-11-10T00:00:00Z'));
    // Capricornus: RA 20h - 22h, Dec −10° to −27°. Eris has sat near RA 1h 50m, Dec −1° for a decade.
    viewFromEarth(body('Pluto'), jd, earth, view);
    expect(separationDeg(view.direction, raDecToUnit(307, -23))).toBeLessThan(8);
    viewFromEarth(body('Eris'), jd, earth, view);
    expect(separationDeg(view.direction, raDecToUnit(27, -1))).toBeLessThan(4);
  });

  it('brings Encke to its brightest near its February 2027 perihelion', () => {
    const encke = data.comets.find((c) => c.name === '2P/Encke');
    expect(encke).toBeDefined();
    if (!encke) return;
    const view = emptyView();
    const mag = (iso: string): number => {
      const { jd, earth } = earthAt(new Date(iso));
      viewFromEarth(encke, jd, earth, view);
      return cometMagnitude(encke.m1, encke.k1, view.sunDistanceAu, view.distanceAu);
    };
    expect(mag('2027-02-10T00:00:00Z')).toBeLessThan(mag('2026-11-10T00:00:00Z') - 2);
    expect(mag('2027-02-10T00:00:00Z')).toBeLessThan(mag('2027-06-10T00:00:00Z') - 2);
  });
});

describe('labels and marks', () => {
  it('writes tenths for bright bodies and whole magnitudes for faint ones', () => {
    expect(magnitudeText(8.94)).toBe('8.9');
    expect(magnitudeText(9.96)).toBe('10');
    expect(magnitudeText(17.4)).toBe('17');
  });

  it('names dwarf planets ahead of asteroids, and brighter ahead of fainter', () => {
    const p = new THREE.Vector3();
    const pluto = bodyLabel(body('Pluto'), 15, p);
    const vesta = bodyLabel(body('Vesta'), 6.9, p);
    const juno = bodyLabel(body('Juno'), 10.2, p);
    expect(pluto.text).toBe('Pluto 15');
    expect(vesta.text).toBe('Vesta 6.9');
    expect(pluto.priority).toBeLessThan(vesta.priority);
    expect(vesta.priority).toBeLessThan(juno.priority);
  });

  it('marks a comet’s magnitude as a prediction', () => {
    const comet = { name: '2P/Encke' } as Comet;
    expect(cometLabel(comet, 7.26, new THREE.Vector3()).text).toBe('☄ 2P/Encke ~7.3');
  });

  it('sizes marks within their limits', () => {
    expect(bodySizePx(5)).toBe(12);
    expect(bodySizePx(22)).toBe(6);
    expect(bodyAlpha(8)).toBe(1);
    expect(bodyAlpha(30)).toBeCloseTo(0.55, 10);
    expect(cometSizePx(COMET_MAG_LIMIT)).toBe(11);
    expect(cometSizePx(2)).toBe(22);
  });

  it('points the tail mark straight away from the Sun', () => {
    const comet = raDecToUnit(40, 10);
    const sunAu = sunGeocentricAu(new Date('2026-11-10T00:00:00Z'));
    const length = Math.hypot(sunAu[0], sunAu[1], sunAu[2]);
    const sun = [sunAu[0] / length, sunAu[1] / length, sunAu[2] / length] as const;
    const end = tailMarkEnd(comet, sun, []) as [number, number, number];
    expect(Math.hypot(end[0], end[1], end[2])).toBeCloseTo(1, 12);
    expect(separationDeg(end, comet)).toBeCloseTo(2.2, 6);
    // Further from the Sun than the comet by the mark's whole length: on the great circle through both.
    expect(separationDeg(end, sun) - separationDeg(comet, sun)).toBeCloseTo(2.2, 6);
  });
});

describe('layer definitions', () => {
  it('sit after the planets in the Sky section, off by default, with JPL credited', () => {
    expect(LAYERS.map((l) => l.id)).toEqual(expect.arrayContaining(['dwarf-planets-asteroids', 'comets', 'asteroid-belt-cloud']));
    for (const layer of LAYERS) {
      expect(layer.section).toBe('Sky');
      expect(layer.order).toBeGreaterThan(55);
      expect(layer.order).toBeLessThan(60);
      expect(layer.defaultOn).toBeUndefined();
      expect(layer.credits.every((c) => c.source.includes('JPL'))).toBe(true);
    }
  });
});
