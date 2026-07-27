import { describe, it, expect } from 'vitest';
import { ThermalProxy, DEFAULT_THERMAL_CONFIG } from './thermal';

describe('ThermalProxy', () => {
  it('starts in normal state', () => {
    const proxy = new ThermalProxy();
    expect(proxy.getState()).toBe('normal');
  });

  it('returns full shell quality in normal state', () => {
    const proxy = new ThermalProxy();
    expect(proxy.shellQuality()).toBe(1.0);
  });

  it('computes EWMA from samples', () => {
    const proxy = new ThermalProxy();
    const target = DEFAULT_THERMAL_CONFIG.targetFrameTimeMs;
    for (let i = 0; i < 20; i++) {
      proxy.tick(target, i * 100);
    }
    const ewma = proxy.getEwma();
    expect(ewma).toBeCloseTo(target, 0);
  });

  it('transitions normal → warming when frame time exceeds threshold', () => {
    const proxy = new ThermalProxy();
    const target = DEFAULT_THERMAL_CONFIG.targetFrameTimeMs;
    const warmingMs = target * DEFAULT_THERMAL_CONFIG.warmingThreshold + 1;

    // Feed enough samples at normal first (spaced > hysteresis)
    for (let i = 0; i < 10; i++) {
      proxy.tick(target, i * 600);
    }
    expect(proxy.getState()).toBe('normal');

    // Now feed degraded frames (spaced > hysteresis)
    for (let i = 10; i < 30; i++) {
      proxy.tick(warmingMs, i * 600);
    }
    expect(proxy.getState()).toBe('warming');
  });

  it('transitions warming → critical when frame time exceeds critical threshold', () => {
    const proxy = new ThermalProxy();
    const target = DEFAULT_THERMAL_CONFIG.targetFrameTimeMs;
    const criticalMs = target * DEFAULT_THERMAL_CONFIG.criticalThreshold + 1;

    // Warm up to warming first (spaced > hysteresis)
    for (let i = 0; i < 15; i++) {
      proxy.tick(target * 1.5, i * 600);
    }
    expect(proxy.getState()).toBe('warming');

    // Push to critical (spaced > hysteresis from last transition)
    for (let i = 15; i < 35; i++) {
      proxy.tick(criticalMs, i * 600);
    }
    expect(proxy.getState()).toBe('critical');
  });

  it('restores critical → recovering when frame time improves', () => {
    const proxy = new ThermalProxy();
    const target = DEFAULT_THERMAL_CONFIG.targetFrameTimeMs;

    // Enter critical (spaced > hysteresis)
    for (let i = 0; i < 30; i++) {
      proxy.tick(target * 2.0, i * 600);
    }
    expect(proxy.getState()).toBe('critical');

    // Improve to below critical restore threshold (spaced > hysteresis)
    const restoreMs = target * DEFAULT_THERMAL_CONFIG.criticalRestoreThreshold - 1;
    for (let i = 30; i < 50; i++) {
      proxy.tick(restoreMs, i * 600);
    }
    expect(proxy.getState()).toBe('recovering');
  });

  it('restores recovering → warming when frame time partially recovers', () => {
    const proxy = new ThermalProxy();
    const target = DEFAULT_THERMAL_CONFIG.targetFrameTimeMs;

    // Enter critical then recovering
    for (let i = 0; i < 30; i++) {
      proxy.tick(target * 2.0, i * 600);
    }
    // Use a value just below critical restore (1.4) but above warming (1.3)
    // to stay in recovering for a bit, then transition to warming
    for (let i = 30; i < 50; i++) {
      proxy.tick(target * 1.35, i * 600);
    }
    expect(proxy.getState()).toBe('recovering');

    // Now feed a value that brings EWMA below warming threshold (1.3)
    for (let i = 50; i < 70; i++) {
      proxy.tick(target * 1.15, i * 600);
    }
    expect(proxy.getState()).toBe('warming');
  });

  it('restores warming → normal when frame time fully recovers', () => {
    const proxy = new ThermalProxy();
    const target = DEFAULT_THERMAL_CONFIG.targetFrameTimeMs;

    // Enter warming
    for (let i = 0; i < 20; i++) {
      proxy.tick(target * 1.5, i * 600);
    }
    expect(proxy.getState()).toBe('warming');

    // Full recovery below warmingRestoreThreshold (1.1)
    for (let i = 20; i < 40; i++) {
      proxy.tick(target * 0.9, i * 600);
    }
    expect(proxy.getState()).toBe('normal');
  });

  it('does not oscillate due to hysteresis', () => {
    const proxy = new ThermalProxy();
    const target = DEFAULT_THERMAL_CONFIG.targetFrameTimeMs;

    // Enter warming (spaced > hysteresis)
    for (let i = 0; i < 20; i++) {
      proxy.tick(target * 1.5, i * 600);
    }
    expect(proxy.getState()).toBe('warming');

    // Rapidly toggle around threshold — but time still advances enough
    const states: string[] = [];
    let t = 20 * 600;
    for (let i = 0; i < 20; i++) {
      t += 600; // ensure > hysteresis each tick
      proxy.tick(i % 2 === 0 ? target * 1.5 : target * 1.0, t);
      states.push(proxy.getState());
    }
    // No rapid flipping between normal and warming
    const flips = states.filter((s, i) => i > 0 && s !== states[i - 1]).length;
    expect(flips).toBeLessThanOrEqual(1);
  });

  it('degrades shell quality before dropping frames', () => {
    const proxy = new ThermalProxy();
    expect(proxy.shellQuality()).toBe(1.0);

    proxy.tick(30, 0);
    expect(proxy.shellQuality()).toBe(1.0); // Still normal (not enough samples)

    // Force into warming
    for (let i = 0; i < 20; i++) {
      proxy.tick(30, i * 600);
    }
    expect(proxy.getState()).toBe('warming');
    expect(proxy.shellQuality()).toBe(0.7);

    // Force into critical
    for (let i = 20; i < 40; i++) {
      proxy.tick(40, i * 600);
    }
    expect(proxy.getState()).toBe('critical');
    expect(proxy.shellQuality()).toBe(0.3);
  });

  it('returns session messages for non-normal states', () => {
    const proxy = new ThermalProxy();
    expect(proxy.sessionMessage()).toBeNull();

    // Force critical
    for (let i = 0; i < 30; i++) {
      proxy.tick(40, i * 600);
    }
    expect(proxy.sessionMessage()).toContain('Thermal limit');
  });

  it('resets to initial state', () => {
    const proxy = new ThermalProxy();
    for (let i = 0; i < 30; i++) {
      proxy.tick(40, i * 600);
    }
    expect(proxy.getState()).toBe('critical');

    proxy.reset();
    expect(proxy.getState()).toBe('normal');
    expect(proxy.getEwma()).toBe(0);
    expect(proxy.shellQuality()).toBe(1.0);
  });

  it('reports trend as degrading when frame times increase', () => {
    const proxy = new ThermalProxy();
    // Feed 15 samples: first 7 low, next 8 high
    // At tick 15, last 5 = indices 10-14 (all high)
    // previous 5 = indices 5-9 (mixed: 5-6 low, 7-9 high)
    for (let i = 0; i < 7; i++) {
      proxy.tick(16, i * 100);
    }
    for (let i = 7; i < 15; i++) {
      proxy.tick(45, i * 100);
    }
    const snapshot = proxy.tick(50, 15 * 100);
    expect(snapshot.trend).toBe('degrading');
  });

  it('reports trend as improving when frame times decrease', () => {
    const proxy = new ThermalProxy();
    // Feed 15 samples: first 7 high, next 8 low
    for (let i = 0; i < 7; i++) {
      proxy.tick(45, i * 100);
    }
    for (let i = 7; i < 15; i++) {
      proxy.tick(15, i * 100);
    }
    const snapshot = proxy.tick(14, 15 * 100);
    expect(snapshot.trend).toBe('improving');
  });
});

describe('createThermalProxy', () => {
  it('creates a proxy with default config', () => {
    const proxy = new ThermalProxy();
    expect(proxy.getState()).toBe('normal');
  });

  it('accepts custom config overrides', () => {
    const proxy = new ThermalProxy({ targetFrameTimeMs: 33.33 });
    for (let i = 0; i < 20; i++) {
      proxy.tick(33.33, i * 600);
    }
    expect(proxy.getState()).toBe('normal');
  });
});
