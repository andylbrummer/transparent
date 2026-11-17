import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createLookController } from '../input/look';
import { LayerManager, type SharedLayerContext } from '../layers/manager';
import type { LayerDefinition, LayerInstance } from '../layers/types';
import type { SurfacePosition } from '../sensors';
import { LAYERS_STORAGE_KEY, LayersPanel, loadLayerVisibility, switchesWithLazyLayers, type LayerSwitch } from '../ui/layers-panel';
import { defaultPreset, presetVisibility, type LayerPreset } from '../ui/presets';
import type { Located, Target, ViewControl } from './actions';
import { indexLabels, targetDirection, type LabelIndex } from './targets';
import { createViewControl } from './view-control';

describe('createViewControl', () => {
  const lazy = (id: string, extra: Partial<LayerDefinition> = {}): LayerDefinition => ({
    id,
    label: id,
    section: 'Sky maps',
    credits: [],
    load: async () => ({ setVisible() {}, dispose() {} }),
    ...extra,
  });
  const definitions = [
    lazy('cmb', { exclusiveGroup: 'sky-map' }),
    lazy('x-ray', { exclusiveGroup: 'sky-map' }),
    lazy('clouds', { section: 'Weather', defaultOn: true }),
    lazy('aurora'),
  ];
  const sky: LayerPreset = { id: 'sky', label: 'Sky', description: 'x-ray sky', on: ['x-ray'] };
  const night: LayerPreset = { id: 'night', label: 'Night', description: 'x-ray and aurora', on: ['x-ray', 'aurora'] };

  const austin: SurfacePosition = { lat: 30.27, lon: -97.74 };
  const when = new Date('2026-11-09T06:00:00Z');

  /**
   * A view control over a real layers panel and layer manager, wired as
   * main.ts wires them, recording what flips and what is saved. `loads`
   * replaces a layer's load, to time it or fail it. The camera is placed
   * by a real look controller at Austin, looking straight down as the app
   * starts; `view` holds the position and labels the control reads.
   */
  function setup(saved: string | null = null, loads: Record<string, LayerDefinition['load']> = {}) {
    const parent = document.createElement('div');
    const switches = switchesWithLazyLayers(definitions);
    const changes: [string, boolean][] = [];
    const stored = new Map<string, string>();
    const presets = [defaultPreset(switches), sky, night];
    const lazyLayers = new LayerManager(
      definitions.map((d) => ({ ...d, load: loads[d.id] ?? d.load })),
      {} as SharedLayerContext,
      () => {},
      () => {}
    );
    const layersPanel = new LayersPanel(
      parent,
      loadLayerVisibility(saved, switches),
      (layer: LayerSwitch, visible: boolean) => {
        changes.push([layer.id, visible]);
        if ('lazy' in layer.target) void lazyLayers.setVisible(layer.target.lazy, visible);
      },
      { setItem: (key, value) => stored.set(key, value) },
      { switches, presets }
    );
    const camera = new THREE.PerspectiveCamera();
    const look = createLookController();
    look.updateCamera(camera, austin, null, 0);
    const view: { position: SurfacePosition | null; labels: LabelIndex | null } = { position: austin, labels: null };
    const viewControl = createViewControl({
      presets,
      switches,
      layersPanel,
      lazyLayers,
      camera,
      getPosition: () => view.position,
      now: () => when,
      getLabels: () => view.labels,
    });
    const input = (id: string): HTMLInputElement => parent.querySelector<HTMLInputElement>(`input[data-layer="${id}"]`)!;
    return { viewControl, switches, changes, stored, input, camera, look, view };
  }

  const instance = (): LayerInstance => ({ setVisible() {}, dispose() {} });

  /** A load that finishes or fails only when the test says so. */
  function heldLoad() {
    let finish!: () => void;
    let fail!: (error: Error) => void;
    const load = vi.fn<LayerDefinition['load']>(
      () =>
        new Promise<LayerInstance>((resolve, reject) => {
          finish = () => resolve(instance());
          fail = reject;
        })
    );
    return { load, finish: () => finish(), fail: (error: Error) => fail(error) };
  }

  /** Lets every pending callback run, so a promise still pending after it is waiting on something. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  /** Whether a promise has settled, read after `settle()`. */
  function settledFlag(promise: Promise<unknown>): { settled: boolean } {
    const flag = { settled: false };
    void promise.then(() => (flag.settled = true));
    return flag;
  }

  it('sets every switch as a preset has it, and saves it', async () => {
    const { viewControl, switches, stored, input } = setup();
    expect(await viewControl.perform({ do: 'preset', id: 'sky' })).toEqual({ ok: true });
    for (const s of switches) expect(input(s.id).checked).toBe(s.id === 'x-ray');
    expect(JSON.parse(stored.get(LAYERS_STORAGE_KEY)!)).toEqual(presetVisibility(sky, switches));
  });

  it('flips named switches as taps would: off first, the exclusive group following, saved', async () => {
    const { viewControl, changes, stored, input } = setup(JSON.stringify({ cmb: true }));
    expect(await viewControl.perform({ do: 'layers', on: ['x-ray'], off: ['clouds'] })).toEqual({ ok: true });
    expect(input('clouds').checked).toBe(false);
    expect(input('x-ray').checked).toBe(true);
    expect(input('cmb').checked).toBe(false);
    const order = changes.map(String);
    expect(order.indexOf('clouds,false')).toBeLessThan(order.indexOf('x-ray,true'));
    expect(JSON.parse(stored.get(LAYERS_STORAGE_KEY)!)).toMatchObject({ clouds: false, 'x-ray': true, cmb: false });
  });

  it('has flipped the switches by the time perform returns, before its promise settles', () => {
    const { viewControl, input } = setup();
    const outcome = viewControl.perform({ do: 'layers', on: ['x-ray'] });
    expect(input('x-ray').checked).toBe(true);
    return expect(outcome).resolves.toEqual({ ok: true });
  });

  it('says a preset is unknown, and touches nothing', async () => {
    const { viewControl, changes, stored } = setup();
    expect(await viewControl.perform({ do: 'preset', id: 'no-such' })).toEqual({
      ok: false,
      code: 'unknown-preset',
      message: 'no preset no-such',
    });
    expect(changes).toEqual([]);
    expect(stored.has(LAYERS_STORAGE_KEY)).toBe(false);
  });

  it('names every unknown switch, and flips none of the known ones', async () => {
    const { viewControl, changes } = setup();
    expect(await viewControl.perform({ do: 'layers', on: ['x-ray', 'nope'], off: ['gone'] })).toEqual({
      ok: false,
      code: 'unknown-layer',
      message: 'no layer switch gone, nope',
    });
    expect(changes).toEqual([]);
  });

  it('refuses a switch turned both on and off', async () => {
    const { viewControl, changes } = setup();
    expect(await viewControl.perform({ do: 'layers', on: ['x-ray'], off: ['x-ray'] })).toEqual({
      ok: false,
      code: 'bad-value',
      message: 'layers turns x-ray both on and off',
    });
    expect(changes).toEqual([]);
  });

  it('refuses layers that names no switch', async () => {
    const { viewControl } = setup();
    expect(await viewControl.perform({ do: 'layers' })).toEqual({ ok: false, code: 'bad-value', message: 'layers names no switch' });
  });

  it('is done with a switch-on only once its layer has loaded', async () => {
    const xRay = heldLoad();
    const { viewControl, input } = setup(null, { 'x-ray': xRay.load });
    const outcome = viewControl.perform({ do: 'layers', on: ['x-ray'] });
    const flag = settledFlag(outcome);
    await settle();
    expect(flag.settled).toBe(false);
    expect(input('x-ray').checked).toBe(true);
    xRay.finish();
    expect(await outcome).toEqual({ ok: true });
  });

  it('is done with a preset only once every lazy layer it turns on has loaded', async () => {
    const xRay = heldLoad();
    const aurora = heldLoad();
    const { viewControl } = setup(null, { 'x-ray': xRay.load, aurora: aurora.load });
    const outcome = viewControl.perform({ do: 'preset', id: 'night' });
    const flag = settledFlag(outcome);
    xRay.finish();
    await settle();
    expect(flag.settled).toBe(false);
    aurora.finish();
    expect(await outcome).toEqual({ ok: true });
  });

  it('does not wait on a layer already loaded, nor on a switch-off', async () => {
    const xRay = vi.fn(async () => instance());
    const clouds = vi.fn(async () => instance());
    const { viewControl } = setup(null, { 'x-ray': xRay, clouds });
    await viewControl.perform({ do: 'layers', on: ['x-ray'] });
    expect(await viewControl.perform({ do: 'layers', on: ['x-ray'] })).toEqual({ ok: true });
    expect(xRay).toHaveBeenCalledOnce();
    expect(await viewControl.perform({ do: 'layers', off: ['clouds'] })).toEqual({ ok: true });
    expect(clouds).not.toHaveBeenCalled();
  });

  it('does not wait on a switch that is not a lazy layer', async () => {
    // The manager does not know quakes: preloading it would throw.
    const { viewControl } = setup();
    expect(await viewControl.perform({ do: 'layers', on: ['quakes'] })).toEqual({ ok: true });
  });

  it('says which layer failed to load, and leaves its switch on', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi.fn<LayerDefinition['load']>().mockRejectedValueOnce(new Error('offline'));
    const { viewControl, input } = setup(null, { 'x-ray': load });
    expect(await viewControl.perform({ do: 'layers', on: ['x-ray'] })).toEqual({
      ok: false,
      code: 'layer-unavailable',
      message: 'layer failed to load: x-ray',
    });
    expect(input('x-ray').checked).toBe(true);
    error.mockRestore();
  });

  it('names every layer that failed to load, in the order the action turned them on', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const offline = async (): Promise<LayerInstance> => {
      throw new Error('offline');
    };
    const { viewControl } = setup(null, { 'x-ray': offline, aurora: offline });
    expect(await viewControl.perform({ do: 'layers', on: ['x-ray', 'aurora'] })).toEqual({
      ok: false,
      code: 'layer-unavailable',
      message: 'layer failed to load: x-ray, aurora',
    });
    error.mockRestore();
  });

  it('tries a failed layer again when an action asks for it again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = vi.fn<LayerDefinition['load']>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(instance());
    const { viewControl } = setup(null, { 'x-ray': load });
    expect(await viewControl.perform({ do: 'layers', on: ['x-ray'] })).toMatchObject({ ok: false, code: 'layer-unavailable' });
    expect(await viewControl.perform({ do: 'layers', on: ['x-ray'] })).toEqual({ ok: true });
    expect(load).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  describe('locate', () => {
    const down = { kind: 'horizon', azDeg: 0, altDeg: -90 } as const;
    const northOnHorizon = { kind: 'horizon', azDeg: 0, altDeg: 0 } as const;

    /** Where `target` is, failing the test if it does not resolve. */
    function located(viewControl: ViewControl, target: Target): Located {
      const result = viewControl.locate(target);
      if (!result.ok) throw new Error(result.message);
      return result;
    }

    it('finds what is straight down at the view centre, as the app starts', () => {
      const { viewControl } = setup();
      const below = located(viewControl, down);
      expect(below.offCentreDeg).toBeLessThan(1e-6);
      expect(below.altDeg).toBeCloseTo(-90, 9);
      expect(below.azDeg).toBe(0);
      const expected = targetDirection(down, austin, when, new Map());
      if (!expected.ok) throw new Error(expected.message);
      expect(below.direction.toArray()).toEqual(expected.direction.toArray());
    });

    it('finds north on the horizon a quarter turn from the view centre', () => {
      const { viewControl } = setup();
      const north = located(viewControl, northOnHorizon);
      expect(north.offCentreDeg).toBeCloseTo(90, 6);
      expect(north.azDeg).toBeCloseTo(0, 9);
      expect(north.altDeg).toBeCloseTo(0, 9);
    });

    it('measures from the camera as it is now', () => {
      const { viewControl, camera, look } = setup();
      look.setAim(0, 0);
      look.updateCamera(camera, austin, null, 0);
      expect(located(viewControl, northOnHorizon).offCentreDeg).toBeLessThan(1e-6);
    });

    it('does not resolve anything before there is a position', () => {
      const { viewControl, view } = setup();
      view.position = null;
      expect(viewControl.locate(down)).toEqual({ ok: false, code: 'target-unresolved', message: 'no position yet' });
    });

    it('says the label files have not loaded rather than that a name is unknown, and still finds the Sun', () => {
      const { viewControl } = setup();
      expect(viewControl.locate({ kind: 'label', name: 'Tuzo' })).toEqual({
        ok: false,
        code: 'target-unresolved',
        message: 'the label files have not loaded',
      });
      expect(viewControl.locate({ kind: 'body', body: 'sun' }).ok).toBe(true);
    });

    it('looks a label up once the label files have loaded', () => {
      const { viewControl, view } = setup();
      view.labels = indexLabels([{ labels: [{ kind: 'deep', name: 'Tuzo', lat: -15, lon: 15, depthKm: 2600, priority: 1 }] }]);
      expect(viewControl.locate({ kind: 'label', name: 'Atlantis' })).toEqual({
        ok: false,
        code: 'target-unresolved',
        message: 'no label named Atlantis',
      });
      expect(viewControl.locate({ kind: 'label', name: 'Tuzo' }).ok).toBe(true);
    });
  });
});
