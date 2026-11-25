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
    const manager = new LayerManager([definition('stars', load)], shared, () => {}, () => {});
    expect(load).not.toHaveBeenCalled();
    manager.setVisible('stars', true);
    manager.setVisible('stars', true);
    await settle();
    expect(load).toHaveBeenCalledOnce();
    expect(instance.visible).toBe(true);
  });

  it('throws for a layer it was not built with, on or off', () => {
    const load = vi.fn(async () => fakeInstance());
    const statuses: (string | null)[] = [];
    const manager = new LayerManager([definition('stars', load)], shared, (_id, text) => statuses.push(text), () => {});
    expect(() => manager.setVisible('no-such-layer', true)).toThrow('no lazy layer no-such-layer');
    expect(() => manager.setVisible('no-such-layer', false)).toThrow('no lazy layer no-such-layer');
    expect(load).not.toHaveBeenCalled();
    expect(statuses).toEqual([]);
  });

  it('honours a switch-off that arrives while the layer is still loading', async () => {
    const instance = fakeInstance();
    let finish!: (value: LayerInstance) => void;
    const manager = new LayerManager(
      [definition('clouds', () => new Promise<LayerInstance>((resolve) => (finish = resolve)))],
      shared,
      () => {},
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
      () => {},
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
      (id, text, tone) => statuses.push([id, text, tone]),
      () => {}
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
    const failed: string[] = [];
    const manager = new LayerManager(
      [definition('wind', load)],
      shared,
      (_id, text) => statuses.push(text),
      (id) => failed.push(id)
    );
    manager.setVisible('wind', true);
    await settle();
    expect(statuses.at(-1)).toBe('unavailable');
    expect(failed).toEqual(['wind']);
    manager.setVisible('wind', false);
    manager.setVisible('wind', true);
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(instance.visible).toBe(true);
    error.mockRestore();
  });

  /** A layer whose load finishes only when the test says so. */
  function heldLoad() {
    let finish!: (value: LayerInstance) => void;
    let fail!: (error: Error) => void;
    const load = vi.fn<LayerDefinition['load']>(
      () =>
        new Promise<LayerInstance>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        })
    );
    return { load, finish: (value: LayerInstance) => finish(value), fail: (error: Error) => fail(error) };
  }

  /** Whether a promise has settled yet, read after the test lets pending callbacks run. */
  function settledFlag(promise: Promise<void>): { settled: boolean } {
    const flag = { settled: false };
    promise.then(
      () => (flag.settled = true),
      () => (flag.settled = true)
    );
    return flag;
  }

  it('resolves a switch-on once the layer has loaded and shows it', async () => {
    const instance = fakeInstance();
    const held = heldLoad();
    const manager = new LayerManager([definition('clouds', held.load)], shared, () => {}, () => {});
    const shown = manager.setVisible('clouds', true);
    const flag = settledFlag(shown);
    await settle();
    expect(flag.settled).toBe(false);
    held.finish(instance);
    await shown;
    expect(instance.visible).toBe(true);
  });

  it('shares one load among everyone waiting on it', async () => {
    const instance = fakeInstance();
    const held = heldLoad();
    const manager = new LayerManager([definition('clouds', held.load)], shared, () => {}, () => {});
    const waits = [manager.setVisible('clouds', true), manager.setVisible('clouds', true), manager.preload('clouds')];
    held.finish(instance);
    await Promise.all(waits);
    expect(held.load).toHaveBeenCalledOnce();
  });

  it('does not wait on the load to switch off, and hides the layer when it lands', async () => {
    const instance = fakeInstance();
    const held = heldLoad();
    const manager = new LayerManager([definition('clouds', held.load)], shared, () => {}, () => {});
    void manager.setVisible('clouds', true);
    const flag = settledFlag(manager.setVisible('clouds', false));
    await settle();
    expect(flag.settled).toBe(true);
    held.finish(instance);
    await settle();
    expect(instance.visible).toBe(false);
  });

  it('resolves at once for a layer already loaded', async () => {
    const load = vi.fn(async () => fakeInstance());
    const manager = new LayerManager([definition('stars', load)], shared, () => {}, () => {});
    await manager.setVisible('stars', true);
    await manager.setVisible('stars', true);
    await manager.preload('stars');
    expect(load).toHaveBeenCalledOnce();
  });

  it('rejects a switch-on whose load fails, naming the layer, and retries on the next', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const statuses: (string | null)[] = [];
    const offline = new Error('offline');
    const load = vi.fn<LayerDefinition['load']>().mockRejectedValueOnce(offline).mockResolvedValueOnce(fakeInstance());
    const failed: string[] = [];
    const manager = new LayerManager(
      [definition('wind', load)],
      shared,
      (_id, text) => statuses.push(text),
      (id) => failed.push(id)
    );
    const shown = manager.setVisible('wind', true);
    await expect(shown).rejects.toThrow('layer "wind" failed to load');
    await expect(shown).rejects.toHaveProperty('cause', offline);
    expect(statuses.at(-1)).toBe('unavailable');
    expect(failed).toEqual(['wind']);
    await manager.setVisible('wind', true);
    expect(load).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('preloads a layer without showing it, and shows it on the next switch-on', async () => {
    const instance = fakeInstance();
    const load = vi.fn(async () => instance);
    const manager = new LayerManager([definition('stars', load)], shared, () => {}, () => {});
    await manager.preload('stars');
    expect(instance.visible).toBe(false);
    manager.update(frame);
    expect(instance.updates).toBe(0);
    await manager.setVisible('stars', true);
    expect(instance.visible).toBe(true);
    expect(load).toHaveBeenCalledOnce();
  });

  it('does not hide a layer switched on while a preload joins its load', async () => {
    const instance = fakeInstance();
    const held = heldLoad();
    const manager = new LayerManager([definition('clouds', held.load)], shared, () => {}, () => {});
    const shown = manager.setVisible('clouds', true);
    const preloaded = manager.preload('clouds');
    held.finish(instance);
    await Promise.all([shown, preloaded]);
    expect(instance.visible).toBe(true);
  });

  it('rejects everyone waiting on a failed load, and reports the failure once', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const statuses: (string | null)[] = [];
    const offline = new Error('offline');
    const held = heldLoad();
    const failed: string[] = [];
    const manager = new LayerManager(
      [definition('wind', held.load)],
      shared,
      (_id, text) => statuses.push(text),
      (id) => failed.push(id)
    );
    const preloaded = manager.preload('wind');
    const shown = manager.setVisible('wind', true);
    held.fail(offline);
    await expect(preloaded).rejects.toThrow('layer "wind" failed to load');
    await expect(preloaded).rejects.toHaveProperty('cause', offline);
    await expect(shown).rejects.toThrow('layer "wind" failed to load');
    expect(statuses.filter((text) => text === 'unavailable')).toHaveLength(1);
    expect(failed).toEqual(['wind']);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('throws at once when asked to preload a layer it was not built with', () => {
    const manager = new LayerManager([definition('stars', async () => fakeInstance())], shared, () => {}, () => {});
    expect(() => manager.preload('no-such-layer')).toThrow('no lazy layer no-such-layer');
  });

  it('disposes what it loaded, including a load that finishes after disposal', async () => {
    const early = fakeInstance();
    const late = fakeInstance();
    let finish!: (value: LayerInstance) => void;
    const manager = new LayerManager(
      [definition('early', async () => early), definition('late', () => new Promise<LayerInstance>((r) => (finish = r)))],
      shared,
      () => {},
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

  describe('setParams', () => {
    const params = { speed: { type: 'number', description: 'how fast' }, playing: { type: 'boolean', description: 'whether it plays' } } as const;
    /** A layer that records what it is given, and whether it was showing then. */
    function paramLayer() {
      const given: { values: Record<string, unknown>; visible: boolean | null }[] = [];
      const instance = {
        ...fakeInstance(),
        setParams(values: Record<string, unknown>) {
          given.push({ values, visible: this.visible });
        },
      };
      return { instance, given };
    }

    it('gives a loaded layer its settings at once', async () => {
      const { instance, given } = paramLayer();
      const manager = new LayerManager([definition('waves', async () => instance, { params })], shared, () => {}, () => {});
      await manager.setVisible('waves', true);
      manager.setParams('waves', { speed: 120 });
      expect(given).toEqual([{ values: { speed: 120 }, visible: true }]);
    });

    it('holds settings for a layer still loading, the last of each, and gives them before it first shows', async () => {
      const { instance, given } = paramLayer();
      let finish!: (value: LayerInstance) => void;
      const load = () => new Promise<LayerInstance>((r) => (finish = r));
      const manager = new LayerManager([definition('waves', load, { params })], shared, () => {}, () => {});
      manager.setParams('waves', { speed: 60, playing: true });
      const shown = manager.setVisible('waves', true);
      manager.setParams('waves', { speed: 120 });
      finish(instance);
      await shown;
      expect(given).toEqual([{ values: { speed: 120, playing: true }, visible: null }]);
      expect(instance.visible).toBe(true);
    });

    it('fails the load of a layer that refuses the settings it was given, and keeps nothing of it', async () => {
      const instance = {
        ...fakeInstance(),
        setParams() {
          throw new Error('no such earthquake');
        },
      };
      const status: (string | null)[] = [];
      const manager = new LayerManager([definition('waves', async () => instance, { params })], shared, (_, text) => status.push(text), () => {});
      manager.setParams('waves', { speed: 120 });
      await expect(manager.setVisible('waves', true)).rejects.toThrow('layer "waves" failed to load');
      expect(instance.disposed).toBe(true);
      expect(status.at(-1)).toBe('unavailable');
    });

    it('throws for a layer that takes no settings, or one it was not built with', () => {
      const manager = new LayerManager([definition('stars', async () => fakeInstance())], shared, () => {}, () => {});
      expect(() => manager.setParams('stars', { speed: 1 })).toThrow('lazy layer stars takes no settings');
      expect(() => manager.setParams('no-such-layer', { speed: 1 })).toThrow('no lazy layer no-such-layer');
    });
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
