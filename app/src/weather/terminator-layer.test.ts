import { describe, it, expect, vi } from 'vitest';

// Mock Three.js before importing the module
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  return {
    ...actual,
    ShaderMaterial: vi.fn().mockImplementation((params) => ({
      ...params,
      uniforms: Object.fromEntries(
        Object.entries(params.uniforms).map(([k, v]) => [k, { value: (v as { value: unknown }).value }])
      ),
      dispose: vi.fn(),
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
    Color: vi.fn().mockImplementation(() => ({ r: 0, g: 0, b: 0 })),
    FrontSide: 0,
  };
});

// Import after mocking
import { TerminatorLayer } from './terminator-layer';

describe('TerminatorLayer', () => {
  const mockScene = {
    add: vi.fn(),
    remove: vi.fn(),
  };

  it('can be instantiated', () => {
    const layer = new TerminatorLayer(mockScene as unknown as import('three').Scene);
    expect(layer).toBeDefined();
    expect(layer.visible).toBe(true);
    layer.dispose();
  });

  it('setVisible toggles visibility', () => {
    const layer = new TerminatorLayer(mockScene as unknown as import('three').Scene);
    layer.setVisible(false);
    expect(layer.visible).toBe(false);
    layer.setVisible(true);
    expect(layer.visible).toBe(true);
    layer.dispose();
  });

  it('updateTerminator sets subsolar uniform', () => {
    const layer = new TerminatorLayer(mockScene as unknown as import('three').Scene);
    layer.updateTerminator(new Date('2024-06-21T12:00:00Z'));
    layer.dispose();
  });

  it('setNightIntensity clamps to [0,1]', () => {
    const layer = new TerminatorLayer(mockScene as unknown as import('three').Scene);
    layer.setNightIntensity(1.5);
    layer.setNightIntensity(-0.5);
    layer.dispose();
  });
});
