import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  CARDBOARD_SPACING_STORAGE_KEY,
  CardboardCalibration,
  MAX_SPACING_RATE_PX_PER_S,
  NOMINAL_SPACING_PX,
  SPACING_RANGE_PX,
  headRollRad,
  loadSpacingPx,
  spacingRatePxPerS,
} from './cardboard-calibration';

const DEG = Math.PI / 180;

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('loadSpacingPx', () => {
  it('starts from the nominal 63 mm with nothing stored, and reads back a stored spacing', () => {
    expect(NOMINAL_SPACING_PX).toBe(397);
    expect(loadSpacingPx(null)).toBe(NOMINAL_SPACING_PX);
    expect(loadSpacingPx('412')).toBe(412);
  });

  it('reports a stored value that is not a spacing and starts from the nominal one', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(loadSpacingPx('wide')).toBe(NOMINAL_SPACING_PX);
    expect(loadSpacingPx('9000')).toBe(NOMINAL_SPACING_PX);
    expect(errors).toHaveBeenCalledTimes(2);
  });
});

describe('spacingRatePxPerS', () => {
  it('holds inside the dead zone, widens for a tilt to the right, narrows to the left', () => {
    expect(spacingRatePxPerS(4 * DEG)).toBe(0);
    expect(spacingRatePxPerS(-4 * DEG)).toBe(0);
    // Right shoulder down: the screen's right edge drops, roll is negative.
    expect(spacingRatePxPerS(-10 * DEG)).toBeCloseTo(20, 9);
    expect(spacingRatePxPerS(10 * DEG)).toBeCloseTo(-20, 9);
  });

  it('is capped for a large tilt', () => {
    expect(spacingRatePxPerS(-45 * DEG)).toBe(MAX_SPACING_RATE_PX_PER_S);
  });
});

describe('headRollRad', () => {
  it('reads negative for a head tilted to the right shoulder', () => {
    const up = new THREE.Vector3(0, 1, 0);
    const head = new THREE.PerspectiveCamera();
    expect(headRollRad(head, up)).toBeCloseTo(0, 9);
    // Clockwise as the wearer sees it: about the view axis, toward -z.
    head.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -10 * DEG);
    expect(headRollRad(head, up)).toBeCloseTo(-10 * DEG, 9);
  });
});

describe('CardboardCalibration', () => {
  it('moves the spacing with the tilt, inside its range and the screen, and keeps it', () => {
    const storage = memoryStorage();
    const parent = document.createElement('div');
    const calibration = new CardboardCalibration(parent, storage);
    expect(calibration.spacingPx()).toBe(NOMINAL_SPACING_PX);

    calibration.update(-10 * DEG, 1000, 900, 400);
    expect(calibration.spacingPx()).toBeCloseTo(NOMINAL_SPACING_PX + 20, 6);
    // Readouts sit either side of the middle, the spacing apart.
    const [left, right] = Array.from(parent.querySelectorAll<HTMLElement>('.cardboard-calibration__readout'));
    expect(parseFloat(right.style.left) - parseFloat(left.style.left)).toBeCloseTo(calibration.spacingPx(), 6);
    expect(left.textContent).toBe(right.textContent);

    calibration.update(-45 * DEG, 60_000, 900, 400);
    expect(calibration.spacingPx()).toBe(SPACING_RANGE_PX[1]);
    calibration.update(-45 * DEG, 60_000, 500, 400);
    expect(calibration.spacingPx()).toBe(500);

    calibration.save();
    expect(storage.items.get(CARDBOARD_SPACING_STORAGE_KEY)).toBe('500');
    expect(new CardboardCalibration(parent, storage).spacingPx()).toBe(500);
    calibration.dispose();
  });
});
