import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createLookController } from '../input/look';
import { CompassBar, TAPE_SPAN_DEG, bearingOffsetDeg, compassPoint, horizontalFovDeg } from './compass-bar';

const AUSTIN = { lat: 30.2672, lon: -97.7431 };
const WIDTH = 400;

/** A camera aimed the way the app aims it, from a W3C attitude. */
function cameraFor(alpha: number, beta: number, gamma = 0, aspect = WIDTH / 800): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1e9);
  createLookController().updateCamera(camera, AUSTIN, { alpha, beta, gamma }, 0);
  return camera;
}

function visibleTicks(parent: HTMLElement): { text: string; x: number }[] {
  return [...parent.querySelectorAll<HTMLElement>('.compass-tick')]
    .filter((el) => el.style.display !== 'none')
    .map((el) => ({ text: el.textContent ?? '', x: parseFloat(/translateX\(([-\d.]+)px\)/.exec(el.style.transform)?.[1] ?? 'NaN') }));
}

describe('CompassBar', () => {
  it('reads the bearing an upright phone faces', () => {
    const bar = new CompassBar(document.createElement('div'));
    // alpha 90 = heading 270: facing west.
    bar.update(cameraFor(90, 90), AUSTIN, WIDTH);
    expect(bar.getBearing()).toBeCloseTo(270, 6);
  });

  it('keeps the forward bearing while the view tips down', () => {
    const bar = new CompassBar(document.createElement('div'));
    // Upright is beta 90; beta 20 tips the back camera 70° below the horizon.
    bar.update(cameraFor(90, 20), AUSTIN, WIDTH);
    expect(bar.getBearing()).toBeCloseTo(270, 6);
  });

  it('still has a heading looking straight down: the screen top', () => {
    const bar = new CompassBar(document.createElement('div'));
    // Face up, top edge north: the view goes through the Earth, screen top north.
    bar.update(cameraFor(0, 0), AUSTIN, WIDTH);
    expect(bar.getBearing()).toBeCloseTo(0, 6);
    // Same, top edge east.
    bar.update(cameraFor(270, 0), AUSTIN, WIDTH);
    expect(bar.getBearing()).toBeCloseTo(90, 6);
  });

  it('centres the faced bearing on a tape compressed to the fixed span', () => {
    const parent = document.createElement('div');
    const bar = new CompassBar(parent);
    bar.update(cameraFor(90, 90), AUSTIN, WIDTH);

    const pxPerDeg = WIDTH / TAPE_SPAN_DEG;
    const ticks = visibleTicks(parent);
    expect(ticks.find((t) => t.text === 'W')?.x).toBeCloseTo(WIDTH / 2, 1);
    expect(ticks.find((t) => t.text === '300')?.x).toBeCloseTo(WIDTH / 2 + 30 * pxPerDeg, 1);
    expect(parent.querySelector('.compass-bar__readout')?.textContent).toBe('270° W');
  });

  it('keeps cardinals on the tape at a narrow portrait field of view', () => {
    const parent = document.createElement('div');
    const bar = new CompassBar(parent);
    // Headings halfway between the 8 points: the worst case for seeing one.
    for (const alpha of [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5]) {
      bar.update(cameraFor(alpha, 90), AUSTIN, WIDTH);
      const texts = visibleTicks(parent)
        .filter((t) => t.x >= 0 && t.x <= WIDTH)
        .map((t) => t.text);
      expect(texts.filter((t) => ['N', 'E', 'S', 'W'].includes(t)).length).toBeGreaterThanOrEqual(1);
      expect(texts.filter((t) => /^[NESW]{1,2}$/.test(t)).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('brackets the slice of the tape the camera sees', () => {
    const parent = document.createElement('div');
    const bar = new CompassBar(parent);
    const camera = cameraFor(90, 90);
    bar.update(camera, AUSTIN, WIDTH);
    const fovPx = (horizontalFovDeg(camera.fov, camera.aspect) * WIDTH) / TAPE_SPAN_DEG;
    const bracket = parent.querySelector<HTMLElement>('.compass-bar__fov')!;
    expect(parseFloat(bracket.style.width)).toBeCloseTo(fovPx, 1);
    expect(bracket.style.transform).toBe(`translateX(${(WIDTH / 2 - fovPx / 2).toFixed(1)}px)`);
  });

  it('wraps the tape across north', () => {
    const parent = document.createElement('div');
    const bar = new CompassBar(parent);
    // alpha 5 = heading 355.
    bar.update(cameraFor(5, 90), AUSTIN, WIDTH);
    const texts = visibleTicks(parent).map((t) => t.text);
    expect(texts).toContain('N');
    expect(texts).toContain('330');
    const north = visibleTicks(parent).find((t) => t.text === 'N');
    expect(north!.x).toBeGreaterThan(WIDTH / 2);
  });
});

describe('compass helpers', () => {
  it('takes the shorter turn between bearings', () => {
    expect(bearingOffsetDeg(10, 350)).toBeCloseTo(20, 9);
    expect(bearingOffsetDeg(350, 10)).toBeCloseTo(-20, 9);
  });

  it('names 16 compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(293)).toBe('WNW');
    expect(compassPoint(359)).toBe('N');
  });

  it('widens the field of view with the aspect ratio', () => {
    expect(horizontalFovDeg(60, 1)).toBeCloseTo(60, 9);
    expect(horizontalFovDeg(60, 2)).toBeGreaterThan(60);
  });
});
