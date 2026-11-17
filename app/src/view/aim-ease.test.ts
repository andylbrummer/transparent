import { describe, it, expect } from 'vitest';
import { EASE_MIN_MS, easeAim, type Aim } from './aim-ease';

const aim = (azDeg: number, altDeg: number, fovDeg = 60): Aim => ({ azDeg, altDeg, fovDeg });
/** Fractions of the way through, 0 to 1 in twentieths. */
const steps = Array.from({ length: 21 }, (_, i) => i / 20);

describe('easeAim', () => {
  it('starts at the first aim and ends exactly at the second', () => {
    const from = aim(10, -20, 60);
    const ease = easeAim(from, aim(40, 30, 20));
    expect(ease.at(-5)).toEqual(from);
    expect(ease.at(0)).toEqual(from);
    expect(ease.at(ease.durationMs)).toEqual(aim(40, 30, 20));
    expect(ease.at(ease.durationMs + 1000)).toEqual(aim(40, 30, 20));
  });

  it('turns the shorter way round, passing 360 rather than wrapping', () => {
    const forward = easeAim(aim(350, 0), aim(10, 0));
    expect(forward.at(forward.durationMs / 2).azDeg).toBe(360);
    expect(forward.at(forward.durationMs).azDeg).toBe(370);
    const back = easeAim(aim(10, 0), aim(350, 0));
    expect(back.at(back.durationMs).azDeg).toBe(-10);
    const across = easeAim(aim(170, 0), aim(-170, 0));
    expect(across.at(across.durationMs).azDeg).toBe(190);
  });

  it('turns clockwise for exactly half a turn, every time', () => {
    expect(easeAim(aim(0, 0), aim(180, 0)).at(Infinity).azDeg).toBe(180);
    expect(easeAim(aim(0, 0), aim(180, 0)).at(Infinity).azDeg).toBe(180);
  });

  it('eases in and out, steadily one way', () => {
    const ease = easeAim(aim(0, -40), aim(80, 40));
    const at = (t: number): Aim => ease.at(t * ease.durationMs);
    expect(at(0.5).azDeg).toBe(40);
    expect(at(0.5).altDeg).toBe(0);
    // Smoothstep at a quarter is 0.15625 of the way.
    expect(at(0.25).azDeg).toBeCloseTo(80 * 0.15625, 9);
    const path = steps.map(at);
    for (let i = 1; i < path.length; i++) {
      expect(path[i].azDeg).toBeGreaterThan(path[i - 1].azDeg);
      expect(path[i].altDeg).toBeGreaterThan(path[i - 1].altDeg);
    }
  });

  it('zooms evenly in log scale', () => {
    const ease = easeAim(aim(0, 0, 60), aim(0, 0, 15));
    expect(Math.abs(ease.at(ease.durationMs / 2).fovDeg - 30)).toBeLessThan(1e-9);
    const fovs = steps.map((t) => ease.at(t * ease.durationMs).fovDeg);
    for (let i = 1; i < fovs.length; i++) expect(fovs[i]).toBeLessThan(fovs[i - 1]);
  });

  it('takes the least time for a turn of up to 90°, and goes at a steady rate beyond', () => {
    expect(easeAim(aim(0, 0), aim(30, 0)).durationMs).toBe(EASE_MIN_MS);
    expect(easeAim(aim(0, 0), aim(90, 0)).durationMs).toBeCloseTo(1500, 6);
    expect(easeAim(aim(0, 0), aim(120, 0)).durationMs).toBeCloseTo(2000, 6);
    expect(easeAim(aim(0, -90), aim(0, 90)).durationMs).toBeCloseTo(3000, 6);
    // Half way round in azimuth near straight down is a turn of only 2°.
    expect(easeAim(aim(0, -89), aim(180, -89)).durationMs).toBe(1500);
  });

  it('takes the least time for a zoom alone, and none for no change', () => {
    expect(easeAim(aim(30, 10, 60), aim(30, 10, 20)).durationMs).toBe(EASE_MIN_MS);
    const still = easeAim(aim(30, 10), aim(390, 10));
    expect(still.durationMs).toBe(0);
    expect(still.at(-5)).toEqual(aim(30, 10));
    expect(still.at(0)).toEqual(aim(30, 10));
    expect(still.at(1000)).toEqual(aim(30, 10));
  });

  it('keeps the altitude between where it starts and ends', () => {
    const ease = easeAim(aim(0, -80), aim(170, 85));
    for (const t of [-0.5, ...steps, 1.5]) {
      const { altDeg } = ease.at(t * ease.durationMs);
      expect(altDeg).toBeGreaterThanOrEqual(-80);
      expect(altDeg).toBeLessThanOrEqual(85);
    }
  });
});
