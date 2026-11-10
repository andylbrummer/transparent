import { describe, it, expect, vi } from 'vitest';
import { LayerManager, type SharedLayerContext } from './manager';
import { collectDefinitions } from './registry';
import type { FrameState, LayerDefinition, LayerInstance } from './types';

const shared = {} as SharedLayerContext;
const frame = {} as FrameState;

function fakeInstance(): LayerInstance & { visible: boolean | null; updates: number; disposed: boolean } {
  return {
    visible: null,
    updates: 0,
    disposed: false,
    setVisible(visible) {
      this.visible = visible;
    },
    update() {
      this.updates++;
    },
    setResolution: vi.fn(),
    dispose() {
      this.disposed = true;
    },
  };
}

function definition(id: string, load: LayerDefinition['load'], extra: Partial<LayerDefinition> = {}): LayerDefinition {
  return { id, label: id, section: 'Sky', credits: [], load, ...extra };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('LayerManager', () => {
  it('loads a layer only when it is first switched on', async () => {
    const instance = fakeInstance();
    const load = vi.fn(async () => instance);
    const manager = new LayerManager([definition('stars', load)], shared, () => {});
    expect(load).not.toHaveBeenCalled();
    manager.setVisible('stars', true);
    manager.setVisible('stars', true);
    await settle();
    expect(load).toHaveBeenCalledOnce();
    expect(instance.visible).toBe(true);
  });

  it('honours a switch-off that arrives while the layer is still loading', async () => {
    const instance = fakeInstance();
    let finish!: (value: LayerInstance) => void;
    const manager = new LayerManager(
      [definition('clouds', () => new Promise<LayerInstance>((resolve) => (finish = resolve)))],
      shared,
      () => {}
    );
    manager.setVisible('clouds', true);
    manager.setVisible('clouds', false);
    finish(instance);
    await settle();
    expect(instance.visible).toBe(false);
    manager.update(frame);
    expect(instance.updates).toBe(0);
  });

  it('updates only what is loaded and showing, and passes the resolution on', async () => {
    const a = fakeInstance();
    const b = fakeInstance();
    const manager = new LayerManager(
      [definition('a', async () => a), definition('b', async () => b)],
      shared,
      () => {}
    );
    manager.setResolution(400, 800);
    manager.setVisible('a', true);
    await settle();
    manager.update(frame);
    expect(a.updates).toBe(1);
    expect(b.updates).toBe(0);
    expect(a.setResolution).toHaveBeenCalledWith(400, 800);
  });

  it('shows loading, then clears it - unless the layer set a status of its own', async () => {
    const statuses: [string, string | null, string][] = [];
    const manager = new LayerManager(
      [
        definition('plain', async () => fakeInstance()),
        definition('live', async (context) => {
          context.setStatus('live 12:30Z', 'live');
          return fakeInstance();
        }),
      ],
      shared,
      (id, text, tone) => statuses.push([id, text, tone])
    );
    manager.setVisible('plain', true);
    manager.setVisible('live', true);
    await settle();
    expect(statuses.filter(([id]) => id === 'plain')).toEqual([
      ['plain', 'loading…', 'info'],
      ['plain', null, 'info'],
    ]);
    expect(statuses.filter(([id]) => id === 'live').at(-1)).toEqual(['live', 'live 12:30Z', 'live']);
  });

  it('fails visibly and retries on the next switch-on', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const statuses: (string | null)[] = [];
    const instance = fakeInstance();
    const load = vi.fn<LayerDefinition['load']>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(instance);
    const manager = new LayerManager([definition('wind', load)], shared, (_id, text) => statuses.push(text));
    manager.setVisible('wind', true);
    await settle();
    expect(statuses.at(-1)).toBe('unavailable');
    manager.setVisible('wind', false);
    manager.setVisible('wind', true);
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(instance.visible).toBe(true);
    error.mockRestore();
  });

  it('disposes what it loaded, including a load that finishes after disposal', async () => {
    const early = fakeInstance();
    const late = fakeInstance();
    let finish!: (value: LayerInstance) => void;
    const manager = new LayerManager(
      [definition('early', async () => early), definition('late', () => new Promise<LayerInstance>((r) => (finish = r)))],
      shared,
      () => {}
    );
    manager.setVisible('early', true);
    manager.setVisible('late', true);
    await settle();
    manager.dispose();
    finish(late);
    await settle();
    expect(early.disposed).toBe(true);
    expect(late.disposed).toBe(true);
  });
});

describe('collectDefinitions', () => {
  const load = async (): Promise<LayerInstance> => fakeInstance();

  it('flattens modules and sorts by section, order, then label', () => {
    const sorted = collectDefinitions({
      './a/layer.ts': { default: [definition('zeta', load, { order: 5 }), definition('rain', load, { section: 'Weather' })] },
      './b/layer.ts': { default: definition('alpha', load, { order: 5 }) },
      './c/layer.ts': { default: definition('first', load, { order: 1 }) },
    });
    expect(sorted.map((d) => d.id)).toEqual(['rain', 'first', 'alpha', 'zeta']);
  });

  it('rejects two layers with one id', () => {
    expect(() =>
      collectDefinitions({
        './a/layer.ts': { default: definition('stars', load) },
        './b/layer.ts': { default: definition('stars', load) },
      })
    ).toThrow(/duplicate layer id "stars"/);
  });
});
