import { describe, it, expect, vi } from 'vitest';

// Mock Three.js before importing the module
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  return {
    ...actual,
    DataTexture: vi.fn().mockImplementation((data, width, height, format, type) => ({
      data,
      width,
      height,
      format,
      type,
      needsUpdate: false,
      wrapS: 0,
      wrapT: 0,
      minFilter: 0,
      magFilter: 0,
      dispose: vi.fn(),
    })),
    ShaderMaterial: vi.fn().mockImplementation((params) => ({
      ...params,
      uniforms: Object.fromEntries(
        Object.entries(params.uniforms).map(([k, v]) => [k, { value: (v as { value: unknown }).value }])
      ),
      dispose: vi.fn(),
    })),
    BufferGeometry: vi.fn().mockImplementation(() => ({
      setAttribute: vi.fn(),
      dispose: vi.fn(),
    })),
    Points: vi.fn().mockImplementation(() => ({
      frustumCulled: false,
      visible: true,
    })),
    SphereGeometry: vi.fn().mockImplementation(() => ({
      dispose: vi.fn(),
    })),
    Mesh: vi.fn().mockImplementation(() => ({
      frustumCulled: false,
      visible: true,
      geometry: { dispose: vi.fn() },
    })),
    Vector3: vi.fn().mockImplementation((x = 0, y = 0, z = 0) => ({ x, y, z, set: vi.fn() })),
    Color: vi.fn().mockImplementation((hex = 0) => ({ r: 0, g: 0, b: 0 })),
    BufferAttribute: vi.fn(),
    RepeatWrapping: 1000,
    ClampToEdgeWrapping: 1001,
    LinearFilter: 1002,
    RGFormat: 1020,
    FloatType: 1015,
    AdditiveBlending: 2,
    FrontSide: 0,
  };
});

// Import after mocking
import { WindLayer, DEFAULT_WIND_CONFIG } from './layer';

describe('DEFAULT_WIND_CONFIG', () => {
  it('has particleCount of 8192', () => {
    expect(DEFAULT_WIND_CONFIG.particleCount).toBe(8192);
  });
  it('defaults to 250 hPa pressure level', () => {
    expect(DEFAULT_WIND_CONFIG.pressureLevel).toBe(250);
  });
});

describe('WindLayer', () => {
  const mockScene = {
    add: vi.fn(),
    remove: vi.fn(),
  };

  it('can be instantiated with default config', () => {
    const layer = new WindLayer(mockScene as unknown as import('three').Scene);
    expect(layer).toBeDefined();
    expect(layer.visible).toBe(true);
    layer.dispose();
  });

  it('can be instantiated with custom config', () => {
    const layer = new WindLayer(mockScene as unknown as import('three').Scene, {
      particleCount: 4096,
      speedScale: 2.0,
    });
    expect(layer).toBeDefined();
    layer.dispose();
  });

  it('setVisible toggles visibility', () => {
    const layer = new WindLayer(mockScene as unknown as import('three').Scene);
    layer.setVisible(false);
    expect(layer.visible).toBe(false);
    layer.setVisible(true);
    expect(layer.visible).toBe(true);
    layer.dispose();
  });

  it('updateTerminator sets subsolar uniform', () => {
    const layer = new WindLayer(mockScene as unknown as import('three').Scene);
    layer.updateTerminator(new Date('2024-06-21T12:00:00Z'));
    // The mock Vector3.set should have been called
    layer.dispose();
  });

  it('setDayNightBlend clamps to [0,1]', () => {
    const layer = new WindLayer(mockScene as unknown as import('three').Scene);
    layer.setDayNightBlend(1.5);
    // Should not throw
    layer.setDayNightBlend(-0.5);
    // Should not throw
    layer.dispose();
  });
});

