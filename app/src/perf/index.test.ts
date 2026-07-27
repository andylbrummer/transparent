import { describe, it, expect } from 'vitest';
import { ThermalProxy, createThermalProxy } from './index';

describe('perf module exports', () => {
  it('exports ThermalProxy class', () => {
    expect(ThermalProxy).toBeDefined();
    const proxy = new ThermalProxy();
    expect(proxy.getState()).toBe('normal');
  });

  it('exports createThermalProxy factory', () => {
    const proxy = createThermalProxy({ targetFrameTimeMs: 20 });
    expect(proxy).toBeInstanceOf(ThermalProxy);
  });
});
