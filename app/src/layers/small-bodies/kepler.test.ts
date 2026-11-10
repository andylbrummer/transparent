import { describe, expect, it } from 'vitest';
import { raDecToUnit, separationDeg } from '@transparent-earth/core';
import {
  asteroidMagnitude,
  cometMagnitude,
  earthAt,
  emptyView,
  heliocentricPosition,
  inPlanePosition,
  jdDateText,
  orbitBasis,
  outsideWindowStatus,
  solveKepler,
  viewFromEarth,
  withinWindow,
  type OrbitElements,
} from './kepler';
import type { SmallBodyData } from './bodies';

const raw = import.meta.glob(['../../../public/sky/small-bodies.json', './horizons.fixture.json'], { eager: true, query: '?raw', import: 'default' }) as Record<
  string,
  string
>;
const data = JSON.parse(raw['../../../public/sky/small-bodies.json']) as SmallBodyData;
interface Fixture {
  readonly bodies: readonly { name: string; comet: boolean; places: readonly { jdUtc: number; ra: number; dec: number }[] }[];
}
const fixture = JSON.parse(raw['./horizons.fixture.json']) as Fixture;
const jdToDate = (jd: number): Date => new Date((jd - 2440587.5) * 86400000);

describe('solveKepler', () => {
  it('satisfies Kepler’s equation at every eccentricity and anomaly', () => {
    for (const e of [0, 0.1, 0.5, 0.9, 0.99, 0.9999]) {
      for (let mean = -7; mean <= 7; mean += 0.173) {
        const ecc = solveKepler(mean, e);
        const wrapped = mean - 2 * Math.PI * Math.round(mean / (2 * Math.PI));
        expect(ecc - e * Math.sin(ecc)).toBeCloseTo(wrapped, 10);
      }
    }
  });
});

describe('inPlanePosition', () => {
  it('is at perihelion, on the axis, at the time of perihelion - whatever the conic', () => {
    for (const e of [0.2, 0.97, 1, 1.4, 6.1]) {
      const [x, y] = inPlanePosition(1.3, e, 2461000, 2461000, []);
      expect(x).toBeCloseTo(1.3, 12);
      expect(y).toBeCloseTo(0, 12);
    }
  });

  it('joins ellipse, parabola and hyperbola smoothly at e = 1', () => {
    const at = (e: number): number[] => inPlanePosition(0.8, e, 2461000, 2461090, []);
    const parabola = at(1);
    for (const e of [1 - 1e-7, 1 + 1e-7]) {
      expect(at(e)[0]).toBeCloseTo(parabola[0], 5);
      expect(at(e)[1]).toBeCloseTo(parabola[1], 5);
    }
  });

  it('sweeps equal areas: a circular orbit of 1 au goes round in a Gaussian year', () => {
    const year = (2 * Math.PI) / 0.01720209895;
    const [x, y] = inPlanePosition(1, 0, 0, year / 4, []);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(1, 12);
  });
});

describe('orbitBasis', () => {
  it('gives two unit vectors at right angles, and the ecliptic pole for an orbit in the ecliptic', () => {
    const b = orbitBasis(17.1, 110.3, 113.8);
    expect(Math.hypot(b[0], b[1], b[2])).toBeCloseTo(1, 12);
    expect(Math.hypot(b[3], b[4], b[5])).toBeCloseTo(1, 12);
    expect(b[0] * b[3] + b[1] * b[4] + b[2] * b[5]).toBeCloseTo(0, 12);
    const flat = orbitBasis(0, 0, 0);
    // P is the equinox; Q is 90° along the ecliptic, tipped 23.44° off the equator.
    expect(flat.slice(0, 3)).toEqual([1, 0, 0]);
    expect(flat[5]).toBeCloseTo(Math.sin((23.4392911 * Math.PI) / 180), 8);
  });
});

describe('two-body places against JPL Horizons', () => {
  const orbits = new Map<string, OrbitElements>([...data.bodies, ...data.comets].map((b) => [b.name, b]));

  it('covers a dwarf planet, main-belt asteroids, a Trojan, a near-Earth asteroid, a centaur and comets', () => {
    const names = fixture.bodies.map((b) => b.name);
    for (const name of ['Ceres', 'Vesta', 'Pluto', 'Eris', 'Hektor', 'Eros', 'Chiron']) expect(names).toContain(name);
    expect(fixture.bodies.filter((b) => b.comet).length).toBeGreaterThanOrEqual(3);
  });

  // Measured when baked (arcseconds, worst of eight dates from a year before the epoch to a year after):
  // Ceres 99, Vesta 40, Pluto 1.3, Eris 1.4, Hektor 13, Eros 103, Chiron 7; comets 13 - 58.
  // The limits leave room for VSOP87's Earth, which is the app's and not Horizons'.
  const limitArcsec = (name: string): number => (['Pluto', 'Eris', 'Chiron'].includes(name) ? 12 : name === 'Hektor' ? 25 : 130);

  for (const body of fixture.bodies) {
    it(`${body.name}: within ${limitArcsec(body.name)}″ of Horizons across the two years`, () => {
      const orbit = orbits.get(body.name);
      expect(orbit).toBeDefined();
      if (!orbit) return;
      const view = emptyView();
      let worst = 0;
      let atEpoch = Infinity;
      for (const place of body.places) {
        const { jd, earth } = earthAt(jdToDate(place.jdUtc));
        viewFromEarth(orbit, jd, earth, view);
        const error = separationDeg(view.direction, raDecToUnit(place.ra, place.dec)) * 3600;
        worst = Math.max(worst, error);
        if (place.jdUtc === data.epochJd) atEpoch = error;
      }
      expect(worst).toBeLessThan(limitArcsec(body.name));
      // At the epoch the orbit is exact: what is left is the Earth's place and rounding.
      expect(atEpoch).toBeLessThan(6);
    });
  }

  it('every baked body was within a quarter of a degree of Horizons when baked', () => {
    for (const body of [...data.bodies, ...data.comets]) expect(body.errorArcsec).toBeLessThan(900);
  });
});

describe('magnitudes', () => {
  it('H is the magnitude at 1 au from Sun and Earth at full phase', () => {
    expect(asteroidMagnitude(3.34, 0.12, 1, 1, 0)).toBeCloseTo(3.34, 10);
  });

  it('puts Ceres near magnitude 7 at a good opposition and Vesta brighter', () => {
    // Ceres: 2.55 au from the Sun, 1.6 au from the Earth, a few degrees of phase.
    const ceres = asteroidMagnitude(3.34, 0.12, 2.55, 1.6, (5 * Math.PI) / 180);
    expect(ceres).toBeGreaterThan(6.6);
    expect(ceres).toBeLessThan(7.6);
    expect(asteroidMagnitude(3.2, 0.32, 2.15, 1.14, (5 * Math.PI) / 180)).toBeLessThan(6.2);
  });

  it('fades with phase and with distance', () => {
    expect(asteroidMagnitude(10, 0.15, 1, 1, 1)).toBeGreaterThan(asteroidMagnitude(10, 0.15, 1, 1, 0.2));
    expect(cometMagnitude(8, 10, 2, 1)).toBeCloseTo(8 + 10 * Math.log10(2), 10);
    expect(cometMagnitude(8, 10, 1, 2)).toBeCloseTo(8 + 5 * Math.log10(2), 10);
  });
});

describe('the validity window', () => {
  const window = { epochJd: 2461406.5, validFromJd: 2461041.5, validToJd: 2461771.5 };

  it('is the two years round the epoch, and nothing outside it', () => {
    expect(data.epochJd).toBe(window.epochJd);
    expect(withinWindow(data, 2461354)).toBe(true);
    expect(withinWindow(data, window.validFromJd - 0.01)).toBe(false);
    expect(withinWindow(data, window.validToJd + 0.01)).toBe(false);
  });

  it('names its dates', () => {
    expect(jdDateText(window.epochJd)).toBe('1 Jan 2027');
    expect(outsideWindowStatus(window)).toBe('hidden · orbits good 1 Jan 2026 – 1 Jan 2028 only');
  });
});

describe('heliocentricPosition', () => {
  it('puts Ceres 2.5 - 3 au from the Sun, near the ecliptic', () => {
    const ceres = data.bodies.find((b) => b.name === 'Ceres');
    expect(ceres).toBeDefined();
    if (!ceres) return;
    const p = heliocentricPosition(ceres, data.epochJd);
    const r = Math.hypot(p[0], p[1], p[2]);
    expect(r).toBeGreaterThan(2.5);
    expect(r).toBeLessThan(3.0);
  });
});
