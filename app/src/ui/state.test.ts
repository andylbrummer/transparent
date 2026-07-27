import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STATE,
  toggleLayer,
  setLayerOpacity,
  setLayerOffline,
  isLayerOffline,
  probeCapabilities,
} from './state';

describe('toggleLayer', () => {
  it('toggles visibility', () => {
    const state = toggleLayer(DEFAULT_STATE, 'crust');
    const crust = state.layers.find((l) => l.id === 'crust');
    expect(crust?.visible).toBe(false);
  });

  it('leaves other layers unchanged', () => {
    const state = toggleLayer(DEFAULT_STATE, 'crust');
    const surface = state.layers.find((l) => l.id === 'surface');
    expect(surface?.visible).toBe(true);
  });
});

describe('setLayerOpacity', () => {
  it('sets opacity', () => {
    const state = setLayerOpacity(DEFAULT_STATE, 'crust', 0.5);
    const crust = state.layers.find((l) => l.id === 'crust');
    expect(crust?.opacity).toBe(0.5);
  });

  it('clamps to [0, 1]', () => {
    const state = setLayerOpacity(DEFAULT_STATE, 'crust', 1.5);
    const crust = state.layers.find((l) => l.id === 'crust');
    expect(crust?.opacity).toBe(1);
  });
});

describe('setLayerOffline', () => {
  it('marks layer offline', () => {
    const state = setLayerOffline(DEFAULT_STATE, 'surface', true);
    expect(isLayerOffline(state, 'surface')).toBe(true);
  });

  it('clears offline status', () => {
    let state = setLayerOffline(DEFAULT_STATE, 'surface', true);
    state = setLayerOffline(state, 'surface', false);
    expect(isLayerOffline(state, 'surface')).toBe(false);
  });
});

describe('probeCapabilities', () => {
  it('returns at least gyro in jsdom', async () => {
    const modes = await probeCapabilities();
    expect(modes).toContain('gyro');
  });
});
