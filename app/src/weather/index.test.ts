import { describe, it, expect } from 'vitest';
import {
  createCloudLayer,
  createPrecipLayer,
  setLayerVisibility,
  setLayerAltitude,
  buildOfflineChips,
  buildAttribution,
  buildPrecipLoop,
  tickPrecipAnimation,
  togglePrecipAnimation,
  currentPrecipTime,
  addLayer,
  removeLayer,
  toggleExaggeration,
  getOfflineChips,
  getAttribution,
  DEFAULT_WEATHER_MANAGER,
  DEFAULT_PRECIP_ANIMATION,
  type WeatherLayer,
} from './index';
import {
  GIBS_CLOUD_PROVIDER,
  RAINVIEWER_PROVIDER,
  createTileStreamerState,
  tileFetchFailure,
} from '@transparent-earth/core/tiles';

describe('createCloudLayer', () => {
  it('creates a visible cloud layer with GIBS attribution', () => {
    const layer = createCloudLayer(GIBS_CLOUD_PROVIDER, 10);
    expect(layer.name).toBe('clouds');
    expect(layer.visible).toBe(true);
    expect(layer.altitudeKm).toBe(10);
    expect(layer.provider.name).toBe('gibs-clouds');
    expect(layer.attribution.text).toContain('NASA');
  });
});

describe('createPrecipLayer', () => {
  it('creates a visible precip layer with RainViewer attribution', () => {
    const layer = createPrecipLayer(RAINVIEWER_PROVIDER, 5);
    expect(layer.name).toBe('precipitation');
    expect(layer.visible).toBe(true);
    expect(layer.altitudeKm).toBe(5);
    expect(layer.provider.name).toBe('rainviewer-precip');
    expect(layer.attribution.text).toContain('RainViewer');
  });
});

describe('setLayerVisibility', () => {
  it('toggles visibility', () => {
    const layer = createCloudLayer(GIBS_CLOUD_PROVIDER);
    const hidden = setLayerVisibility(layer, false);
    expect(hidden.visible).toBe(false);
  });
});

describe('setLayerAltitude', () => {
  it('changes altitude', () => {
    const layer = createCloudLayer(GIBS_CLOUD_PROVIDER, 10);
    const raised = setLayerAltitude(layer, 90);
    expect(raised.altitudeKm).toBe(90);
  });
});

describe('buildOfflineChips', () => {
  it('returns empty when all online', () => {
    const layer = createCloudLayer(GIBS_CLOUD_PROVIDER);
    const chips = buildOfflineChips([layer]);
    expect(chips.length).toBe(0);
  });

  it('returns chips for offline layers', () => {
    let layer = createCloudLayer(GIBS_CLOUD_PROVIDER);
    layer = {
      ...layer,
      state: tileFetchFailure(layer.state, { z: 1, x: 0, y: 0 }, 'err'),
    };
    // Force terminal by setting maxAttempts=1 on the state
    const forcedState = createTileStreamerState(GIBS_CLOUD_PROVIDER, 128, {
      maxAttempts: 1,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
    });
    const forcedLayer: WeatherLayer = {
      ...layer,
      state: tileFetchFailure(forcedState, { z: 1, x: 0, y: 0 }, 'err'),
    };
    const chips = buildOfflineChips([forcedLayer]);
    expect(chips.length).toBe(1);
    expect(chips[0].label).toBe('clouds');
    expect(chips[0].status).toBe('offline');
  });
});

describe('buildAttribution', () => {
  it('returns attribution for visible layers', () => {
    const cloud = createCloudLayer(GIBS_CLOUD_PROVIDER);
    const precip = createPrecipLayer(RAINVIEWER_PROVIDER);
    const hidden = setLayerVisibility(cloud, false);
    const attrs = buildAttribution([hidden, precip]);
    expect(attrs.length).toBe(1);
    expect(attrs[0]).toContain('RainViewer');
  });
});

describe('buildPrecipLoop', () => {
  it('builds 12 frames for 2 hours', () => {
    const now = 1718400000;
    const frames = buildPrecipLoop(now);
    expect(frames.length).toBe(12);
    expect(frames[0].timestamp).toBe(now - 11 * 600);
    expect(frames[11].timestamp).toBe(now);
  });

  it('has 10-minute step intervals', () => {
    const now = 0;
    const frames = buildPrecipLoop(now);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].timestamp - frames[i - 1].timestamp).toBe(600);
    }
  });
});

describe('tickPrecipAnimation', () => {
  it('advances frame when interval elapsed', () => {
    const frames = buildPrecipLoop(0);
    const state = { ...DEFAULT_PRECIP_ANIMATION, frames, playing: true, currentIndex: 0, lastFrameTime: 0 };
    const next = tickPrecipAnimation(state, 600, 500);
    expect(next.currentIndex).toBe(1);
  });

  it('does not advance before interval elapsed', () => {
    const frames = buildPrecipLoop(0);
    const state = { ...DEFAULT_PRECIP_ANIMATION, frames, playing: true, currentIndex: 0, lastFrameTime: 0 };
    const next = tickPrecipAnimation(state, 400, 500);
    expect(next.currentIndex).toBe(0);
  });

  it('wraps around at end of loop', () => {
    const frames = buildPrecipLoop(0);
    const state = { ...DEFAULT_PRECIP_ANIMATION, frames, playing: true, currentIndex: 11, lastFrameTime: 0 };
    const next = tickPrecipAnimation(state, 600, 500);
    expect(next.currentIndex).toBe(0);
  });

  it('does not advance when paused', () => {
    const frames = buildPrecipLoop(0);
    const state = { ...DEFAULT_PRECIP_ANIMATION, frames, playing: false, currentIndex: 0, lastFrameTime: 0 };
    const next = tickPrecipAnimation(state, 1000, 500);
    expect(next.currentIndex).toBe(0);
  });
});

describe('togglePrecipAnimation', () => {
  it('starts playing when paused', () => {
    const state = togglePrecipAnimation(DEFAULT_PRECIP_ANIMATION);
    expect(state.playing).toBe(true);
  });

  it('stops playing when running', () => {
    const running = { ...DEFAULT_PRECIP_ANIMATION, playing: true };
    const state = togglePrecipAnimation(running);
    expect(state.playing).toBe(false);
  });
});

describe('currentPrecipTime', () => {
  it('returns null when no frames', () => {
    expect(currentPrecipTime(DEFAULT_PRECIP_ANIMATION)).toBeNull();
  });

  it('returns current frame tile time', () => {
    const frames = buildPrecipLoop(0);
    const state = { ...DEFAULT_PRECIP_ANIMATION, frames, currentIndex: 3 };
    expect(currentPrecipTime(state)).toBe(String(frames[3].timestamp));
  });
});

describe('WeatherManager', () => {
  it('adds and removes layers', () => {
    let manager = DEFAULT_WEATHER_MANAGER;
    const cloud = createCloudLayer(GIBS_CLOUD_PROVIDER);
    manager = addLayer(manager, cloud);
    expect(manager.layers.length).toBe(1);

    manager = removeLayer(manager, 'clouds');
    expect(manager.layers.length).toBe(0);
  });

  it('toggles exaggeration on all layers', () => {
    let manager = DEFAULT_WEATHER_MANAGER;
    manager = addLayer(manager, createCloudLayer(GIBS_CLOUD_PROVIDER, 10));
    manager = addLayer(manager, createPrecipLayer(RAINVIEWER_PROVIDER, 5));

    manager = toggleExaggeration(manager);
    expect(manager.exaggeration).toBe(true);
    expect(manager.layers[0].altitudeKm).toBe(90); // 10 + 80
    expect(manager.layers[1].altitudeKm).toBe(85); // 5 + 80

    manager = toggleExaggeration(manager);
    expect(manager.exaggeration).toBe(false);
    expect(manager.layers[0].altitudeKm).toBe(10);
    expect(manager.layers[1].altitudeKm).toBe(5);
  });

  it('getOfflineChips returns empty when online', () => {
    let manager = DEFAULT_WEATHER_MANAGER;
    manager = addLayer(manager, createCloudLayer(GIBS_CLOUD_PROVIDER));
    expect(getOfflineChips(manager).length).toBe(0);
  });

  it('getAttribution returns all visible layer attributions', () => {
    let manager = DEFAULT_WEATHER_MANAGER;
    manager = addLayer(manager, createCloudLayer(GIBS_CLOUD_PROVIDER));
    manager = addLayer(manager, createPrecipLayer(RAINVIEWER_PROVIDER));
    const attrs = getAttribution(manager);
    expect(attrs.length).toBe(2);
    expect(attrs[0]).toContain('NASA');
    expect(attrs[1]).toContain('RainViewer');
  });
});
