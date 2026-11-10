import { describe, it, expect } from 'vitest';
import { markerOpacity, phaseText } from './moon';

describe('the Moon’s label and marker', () => {
  it('writes the phase and how much is lit', () => {
    expect(
      phaseText({ name: 'Waxing gibbous', illuminatedFraction: 0.748, phaseAngleDeg: 60, brightLimbAngleDeg: 248, elongationDeg: 120 })
    ).toBe('Waxing gibbous 75%');
  });

  it('marks the Moon with a ring while it is a few pixels wide, and not once its face shows', () => {
    expect(markerOpacity(7)).toBe(1);
    expect(markerOpacity(24)).toBeCloseTo(0.5, 5);
    expect(markerOpacity(83)).toBe(0);
  });
});
