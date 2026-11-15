import { describe, it, expect } from 'vitest';
import type { LayerContext } from '../types';
import switches, { BELOW_HORIZON_BRIGHTNESS, WHOLE_SKY_BRIGHTNESS } from './layer';

const contextWith = (uniform: { value: number }) => ({ skyUniforms: { uBelowHorizon: uniform } }) as unknown as LayerContext;

describe('below-horizon switches', () => {
  it('set the shared brightness while on and clear it while off', async () => {
    const expected: Record<string, number> = { 'sky-below-horizon': BELOW_HORIZON_BRIGHTNESS, 'sky-whole': WHOLE_SKY_BRIGHTNESS };
    for (const definition of switches) {
      const uniform = { value: 0 };
      const layer = await definition.load(contextWith(uniform));
      layer.setVisible(true);
      expect(uniform.value, definition.id).toBe(expected[definition.id]);
      layer.setVisible(false);
      expect(uniform.value, definition.id).toBe(0);
    }
  });

  it('are one at a time, since both write the same brightness', () => {
    expect(new Set(switches.map((s) => s.exclusiveGroup)).size).toBe(1);
    expect(switches[0].exclusiveGroup).toBeTruthy();
  });
});
