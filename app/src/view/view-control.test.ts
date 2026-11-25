import { beforeAll, describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { raDecToUnit } from '@transparent-earth/core';
import { createLookController, DEFAULT_LOOK_STATE, MAX_FOV_DEG, MIN_FOV_DEG } from '../input/look';
import { LayerManager, type SharedLayerContext } from '../layers/manager';
import { SKY_RADIUS_M, type LayerDefinition, type LayerInstance } from '../layers/types';
import { LabelLayer, type LabelGroupSpec } from '../render/labels';
import type { DeviceAttitude, SurfacePosition } from '../sensors';
import { LAYERS_STORAGE_KEY, LayersPanel, loadLayerVisibility, switchesWithLazyLayers, type LayerSwitch } from '../ui/layers-panel';
import { defaultPreset, presetVisibility, type LayerPreset } from '../ui/presets';
import type { FoldedView, Located, Target, ViewAction, ViewControl } from './actions';
import { foldAction } from './fold';
import { EASE_MIN_MS } from './aim-ease';
import { indexLabels, loadBodyPositions, targetDirection, targetKey, targetName, type LabelIndex } from './targets';
import { ARRIVE_DEG, ARRIVE_MS, MAX_FADE_S, POSE_MIN_FOV_DEG, createViewControl } from './view-control';
import { CAPTURE_DEG, framingDeg, type SpyglassTarget } from '../ui/spyglass';

// Loaded up front, as by an earlier body target; body-positions.test.ts covers a view control before they are in.
beforeAll(() => loadBodyPositions());

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
    lazy('waves', {
      section: 'Inside the Earth',
      params: {
        quake: { type: 'string', description: 'which earthquake', values: ['tohoku2011', 'sumatra2004'] },
        playing: { type: 'boolean', description: 'whether it plays' },
      },
    }),
    lazy('mist', { section: 'Weather', fades: true, load: async () => ({ setVisible() {}, setOpacity() {}, dispose() {} }) }),
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
   * starts; `view` holds what the control reads of the app: the position,
   * the clock, the labels, the pose (none, so a drag aims the view) and
   * whether less motion is asked for. Marks go onto a real label layer,
   * and `markSpecs` records each group it was given.
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
    const view: {
      position: SurfacePosition | null;
      date: Date;
      labels: LabelIndex | null;
      attitude: DeviceAttitude | null;
      reducedMotion: boolean;
      stereo: boolean;
    } = { position: austin, date: when, labels: null, attitude: null, reducedMotion: false, stereo: false };
    const spyglassOpened: SpyglassTarget[] = [];
    const labelParent = document.createElement('div');
    const labelLayer = new LabelLayer(labelParent, []);
    const markSpecs: LabelGroupSpec[] = [];
    // Every opacity written to a shell, in order.
    const shellOpacities: [string, number][] = [];
    const viewControl = createViewControl({
      presets,
      switches,
      layersPanel,
      lazyLayers,
      shells: { setShellOpacity: (name, opacity) => shellOpacities.push([name, opacity]) },
      camera,
      getPosition: () => view.position,
      now: () => view.date,
      getLabels: () => view.labels,
      loadedLabels: labelLayer,
      look,
      getAttitude: () => view.attitude,
      prefersReducedMotion: () => view.reducedMotion,
      addLabels: (spec) => {
        markSpecs.push(spec);
        return labelLayer.addGroup(spec);
      },
      spyglass: { inStereo: () => view.stereo, openOn: (target) => spyglassOpened.push(target) },
    });
    const input = (id: string): HTMLInputElement => parent.querySelector<HTMLInputElement>(`input[data-layer="${id}"]`)!;
    return { viewControl, switches, changes, stored, input, camera, look, view, labelParent, labelLayer, markSpecs, spyglassOpened, shellOpacities };
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

  describe('fades', () => {
    /** The opacity last written to the outer core's shell, the top of which is shell-core. */
    const coreOpacity = (written: [string, number][]): number | undefined => written.filter(([name]) => name === 'outer core').at(-1)?.[1];

    it('fades a shell out over fadeS, switching it off only at the end, then back to full strength', async () => {
      const { viewControl, input, shellOpacities } = setup();
      await viewControl.perform({ do: 'layers', on: ['shell-core'] });
      let outcome: unknown = null;
      void viewControl.perform({ do: 'layers', off: ['shell-core'], fadeS: 2 }).then((o) => (outcome = o));
      expect(coreOpacity(shellOpacities)).toBe(1);
      viewControl.update(1000);
      expect(coreOpacity(shellOpacities)).toBeCloseTo(0.5, 9);
      expect(input('shell-core').checked).toBe(true);
      viewControl.update(1000);
      expect(input('shell-core').checked).toBe(false);
      expect(shellOpacities.slice(-2)).toEqual([
        ['outer core', 0],
        ['outer core', 1],
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(outcome).toEqual({ ok: true });
    });

    it('switches a shell on at nothing and fades it up', async () => {
      const { viewControl, input, shellOpacities } = setup();
      await viewControl.perform({ do: 'layers', off: ['shell-core'] });
      const fading = viewControl.perform({ do: 'layers', on: ['shell-core'], fadeS: 1 });
      expect(input('shell-core').checked).toBe(true);
      expect(coreOpacity(shellOpacities)).toBe(0);
      // A shell needs no load, so the very next frame fades it.
      viewControl.update(250);
      expect(coreOpacity(shellOpacities)).toBeCloseTo(0.15625, 9);
      viewControl.update(750);
      expect(coreOpacity(shellOpacities)).toBe(1);
      expect(await fading).toEqual({ ok: true });
    });

    it('holds a lazy layer\'s fade until it has loaded, at nothing meanwhile', async () => {
      const given: number[] = [];
      let finish!: () => void;
      const mist = (): Promise<LayerInstance> =>
        new Promise((resolve) => (finish = () => resolve({ setVisible() {}, setOpacity: (opacity: number) => given.push(opacity), dispose() {} })));
      const { viewControl } = setup(null, { mist });
      const fading = viewControl.perform({ do: 'layers', on: ['mist'], fadeS: 1 });
      viewControl.update(800);
      finish();
      await new Promise((resolve) => setTimeout(resolve, 0));
      // The time spent loading is not spent fading: it starts from nothing now.
      expect(given).toEqual([0]);
      viewControl.update(500);
      expect(given.at(-1)).toBeCloseTo(0.5, 9);
      viewControl.update(500);
      expect(await fading).toEqual({ ok: true });
      expect(given.at(-1)).toBe(1);
    });

    it('turns a fade back from where it has got to, and lets the action it took over go on', async () => {
      const { viewControl, input, shellOpacities } = setup();
      await viewControl.perform({ do: 'layers', on: ['shell-core'] });
      const out = viewControl.perform({ do: 'layers', off: ['shell-core'], fadeS: 2 });
      viewControl.update(1000);
      const back = viewControl.perform({ do: 'layers', on: ['shell-core'], fadeS: 2 });
      expect(await out).toEqual({ ok: true });
      expect(coreOpacity(shellOpacities)).toBeCloseTo(0.5, 9);
      await Promise.resolve();
      viewControl.update(2000);
      expect(coreOpacity(shellOpacities)).toBe(1);
      expect(input('shell-core').checked).toBe(true);
      expect(await back).toEqual({ ok: true });
    });

    it('leaves a switch already as asked alone', async () => {
      const { viewControl, shellOpacities } = setup();
      await viewControl.perform({ do: 'layers', on: ['shell-core'] });
      const before = shellOpacities.length;
      expect(await viewControl.perform({ do: 'layers', on: ['shell-core'], fadeS: 1 })).toEqual({ ok: true });
      expect(shellOpacities.length).toBe(before);
    });

    it.each<[string, ViewAction, string]>([
      ['a switch that cannot fade', { do: 'layers', on: ['shell-core', 'aurora'], fadeS: 1 }, 'aurora cannot fade'],
      ['no time at all', { do: 'layers', on: ['shell-core'], fadeS: 0 }, 'fadeS 0 is outside 0 to 10'],
      ['too long a fade', { do: 'layers', on: ['shell-core'], fadeS: MAX_FADE_S + 1 }, `fadeS ${MAX_FADE_S + 1} is outside 0 to 10`],
    ])('refuses %s, flipping nothing', async (_, action, message) => {
      const { viewControl, changes, shellOpacities } = setup();
      expect(await viewControl.perform(action)).toEqual({ ok: false, code: 'bad-value', message });
      expect(changes).toEqual([]);
      expect(shellOpacities).toEqual([]);
    });

    it.each<[string, (viewControl: ViewControl & { update(ms: number): void }) => Promise<unknown>]>([
      ['the switch flipped at once', (viewControl) => viewControl.perform({ do: 'layers', on: ['shell-core'] })],
      ['a preset', (viewControl) => viewControl.perform({ do: 'preset', id: 'sky' })],
    ])('stops a fade at full strength for %s', async (_, next) => {
      const { viewControl, shellOpacities } = setup();
      await viewControl.perform({ do: 'layers', on: ['shell-core'] });
      const out = viewControl.perform({ do: 'layers', off: ['shell-core'], fadeS: 2 });
      viewControl.update(500);
      await next(viewControl);
      expect(await out).toEqual({ ok: true });
      expect(coreOpacity(shellOpacities)).toBe(1);
      const written = shellOpacities.length;
      viewControl.update(2000);
      expect(shellOpacities.length).toBe(written);
    });
  });

  describe("a layer's settings", () => {
    /** A layer that records the settings it is given, and whether it was showing when it was given them. */
    function wavesLoad() {
      const given: { values: Record<string, unknown>; visible: boolean }[] = [];
      let visible = false;
      const load = vi.fn<LayerDefinition['load']>(async () => ({
        setVisible: (next: boolean) => {
          visible = next;
        },
        setParams: (values: Record<string, unknown>) => {
          if (values.quake === 'sumatra2004') throw new Error('waves: no sumatra2004 in the data');
          given.push({ values, visible });
        },
        dispose() {},
      }));
      return { load, given };
    }

    it('gives a layer the settings of the action that turns it on, before it first shows', async () => {
      const waves = wavesLoad();
      const { viewControl } = setup(null, { waves: waves.load });
      expect(await viewControl.perform({ do: 'layers', on: ['waves'], params: { waves: { quake: 'tohoku2011', playing: true } } })).toEqual({ ok: true });
      expect(waves.given).toEqual([{ values: { quake: 'tohoku2011', playing: true }, visible: false }]);
      // Loaded and showing: the next settings arrive at once.
      expect(await viewControl.perform({ do: 'layers', on: ['waves'], params: { waves: { playing: false } } })).toEqual({ ok: true });
      expect(waves.given.at(-1)).toEqual({ values: { playing: false }, visible: true });
    });

    it.each<[string, ViewAction, string, string]>([
      ['a setting the layer lacks', { do: 'layers', on: ['waves'], params: { waves: { colour: 'red' } } }, 'bad-value', 'waves has no setting colour: it has quake, playing'],
      ['a value it does not take', { do: 'layers', on: ['waves'], params: { waves: { quake: 'atlantis' } } }, 'bad-value', 'waves quake is one of tohoku2011, sumatra2004'],
      ['a layer not turned on', { do: 'layers', on: ['aurora'], params: { waves: { playing: true } } }, 'bad-value', 'settings for waves, which this action does not turn on'],
      ['a layer that takes none', { do: 'layers', on: ['aurora'], params: { aurora: { playing: true } } }, 'bad-value', 'aurora takes no settings'],
      ['an unknown switch', { do: 'layers', on: ['aurora'], params: { nope: { playing: true } } }, 'unknown-layer', 'no layer switch nope'],
    ])('refuses settings for %s, and flips nothing', async (_, action, code, message) => {
      const waves = wavesLoad();
      const { viewControl, changes } = setup(null, { waves: waves.load });
      expect(await viewControl.perform(action)).toEqual({ ok: false, code, message });
      expect(changes).toEqual([]);
      expect(waves.load).not.toHaveBeenCalled();
    });

    it('says so when the layer itself refuses a value its data lack', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const waves = wavesLoad();
      const { viewControl } = setup(null, { waves: waves.load });
      await viewControl.perform({ do: 'layers', on: ['waves'] });
      expect(await viewControl.perform({ do: 'layers', on: ['waves'], params: { waves: { quake: 'sumatra2004' } } })).toEqual({
        ok: false,
        code: 'bad-value',
        message: 'waves: no sumatra2004 in the data',
      });
      error.mockRestore();
    });

    it("restores the settings of the layers it turns on, and leaves an off layer's alone", async () => {
      const waves = wavesLoad();
      const { viewControl } = setup(null, { waves: waves.load });
      const view = (only: string[]): FoldedView => ({
        layers: { only },
        look: { target: { kind: 'horizon', azDeg: 0, altDeg: -90 }, fovDeg: DEFAULT_LOOK_STATE.fovDeg },
        marks: [],
        params: { waves: { quake: 'tohoku2011', playing: true } },
      });
      expect(await viewControl.restore(view(['waves']))).toEqual({ ok: true });
      expect(waves.given).toEqual([{ values: { quake: 'tohoku2011', playing: true }, visible: false }]);
      expect(await viewControl.restore(view(['aurora']))).toEqual({ ok: true });
      expect(waves.given).toHaveLength(1);
    });
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

    it("finds a name a loaded layer added, and not a guide's own mark of the same name", async () => {
      const { viewControl, view, labelLayer } = setup();
      view.labels = indexLabels([]);
      const vega: Target = { kind: 'label', name: 'Vega' };
      expect(viewControl.locate(vega)).toEqual({ ok: false, code: 'target-unresolved', message: 'no label named Vega' });
      expect(await viewControl.perform({ do: 'mark', target: { kind: 'horizon', azDeg: 0, altDeg: 90 }, text: 'Vega' })).toEqual({ ok: true });
      expect(viewControl.locate(vega).ok).toBe(false);
      // Vega's place, ICRS, as a star layer gives it.
      const position = new THREE.Vector3(...raDecToUnit(279.23, 38.78));
      labelLayer.addGroup({ rank: 1, style: { fontPx: 10, color: '#fff' }, frame: 'sky', labels: [{ text: 'Vega', priority: 0, position }] });
      const found = located(viewControl, vega);
      const sky = located(viewControl, { kind: 'sky', raDeg: 279.23, decDeg: 38.78 });
      expect(found.direction.angleTo(sky.direction)).toBeLessThan(1e-12);
      expect(found.altDeg).toBeCloseTo(sky.altDeg, 9);
    });
  });

  describe('look and fov', () => {
    const east = { kind: 'horizon', azDeg: 90, altDeg: 0 } as const;
    const north = { kind: 'horizon', azDeg: 0, altDeg: 0 } as const;
    const pose: DeviceAttitude = { alpha: 0, beta: 90, gamma: 0 };

    /** One frame as main.ts runs it: the ease steps, then the camera is aimed. */
    function frame({ viewControl, look, camera, view }: ReturnType<typeof setup>, ms: number): void {
      viewControl.update(ms);
      look.updateCamera(camera, austin, view.attitude, 0);
    }

    /** The view's centre, as the camera has it. */
    const centre = (camera: THREE.Camera): THREE.Vector3 => camera.getWorldDirection(new THREE.Vector3());

    /** Where `target` is drawn. */
    function direction(target: Target): THREE.Vector3 {
      const found = targetDirection(target, austin, when, new Map());
      if (!found.ok) throw new Error(found.message);
      return found.direction;
    }

    it('eases the view to a target, and resolves when it gets there', async () => {
      const t = setup();
      const outcome = t.viewControl.perform({ do: 'look', target: east });
      const done = settledFlag(outcome);
      const before = centre(t.camera).angleTo(direction(east));
      frame(t, EASE_MIN_MS / 2);
      await settle();
      expect(done.settled).toBe(false);
      const midway = centre(t.camera).angleTo(direction(east));
      expect(midway).toBeLessThan(before);
      expect(midway).toBeGreaterThan(0);
      frame(t, EASE_MIN_MS);
      expect(centre(t.camera).angleTo(direction(east))).toBeLessThan(1e-6);
      expect(await outcome).toEqual({ ok: true });
    });

    it('narrows the field of view on the way, evenly in scale', async () => {
      const t = setup();
      const outcome = t.viewControl.perform({ do: 'look', target: east, fovDeg: 15 });
      frame(t, EASE_MIN_MS / 2);
      expect(Math.abs(t.look.getState().fovDeg - 30)).toBeLessThan(1e-6);
      frame(t, EASE_MIN_MS);
      expect(t.look.getState().fovDeg).toBe(15);
      expect(await outcome).toEqual({ ok: true });
    });

    it('keeps the field of view when look names none', async () => {
      const t = setup();
      const outcome = t.viewControl.perform({ do: 'look', target: east });
      frame(t, EASE_MIN_MS / 2);
      expect(t.look.getState().fovDeg).toBe(DEFAULT_LOOK_STATE.fovDeg);
      frame(t, EASE_MIN_MS);
      expect(await outcome).toEqual({ ok: true });
      expect(t.look.getState().fovDeg).toBe(DEFAULT_LOOK_STATE.fovDeg);
    });

    it('eases the field of view alone, leaving the aim, in the shortest ease', async () => {
      const t = setup();
      const before = centre(t.camera);
      const outcome = t.viewControl.perform({ do: 'fov', fovDeg: 40 });
      const done = settledFlag(outcome);
      frame(t, EASE_MIN_MS - 1);
      await settle();
      expect(done.settled).toBe(false);
      expect(t.look.getState().fovDeg).toBeLessThan(DEFAULT_LOOK_STATE.fovDeg);
      expect(t.look.getState().fovDeg).toBeGreaterThan(40);
      frame(t, 1);
      expect(await outcome).toEqual({ ok: true });
      expect(t.look.getState().fovDeg).toBe(40);
      // The yaw comes back from degrees as -0, so the aim is compared where it is drawn.
      expect(centre(t.camera).angleTo(before)).toBeLessThan(1e-9);
    });

    it('resolves at once when there is nothing to change', async () => {
      const t = setup();
      const state = t.look.getState();
      expect(await t.viewControl.perform({ do: 'fov', fovDeg: DEFAULT_LOOK_STATE.fovDeg })).toEqual({ ok: true });
      expect(t.look.getState().fovDeg).toBe(state.fovDeg);
    });

    it('jumps rather than eases when less motion is asked for', async () => {
      const t = setup();
      t.view.reducedMotion = true;
      expect(await t.viewControl.perform({ do: 'look', target: east, fovDeg: 15 })).toEqual({ ok: true });
      t.look.updateCamera(t.camera, austin, null, 0);
      expect(centre(t.camera).angleTo(direction(east))).toBeLessThan(1e-6);
      expect(t.look.getState().fovDeg).toBe(15);
      expect(await t.viewControl.perform({ do: 'fov', fovDeg: 40 })).toEqual({ ok: true });
      expect(t.look.getState().fovDeg).toBe(40);
    });

    it('in a pose, leaves the aim to the user and waits for their gaze, but sets the field of view', async () => {
      const t = setup();
      t.view.attitude = pose;
      const state = t.look.getState();
      expect(await t.viewControl.perform({ do: 'look', target: east, fovDeg: 15 })).toStrictEqual({ ok: true, awaitingGaze: true });
      expect(t.look.getState()).toBe(state);
      expect(await t.viewControl.perform({ do: 'fov', fovDeg: 40 })).toEqual({ ok: true });
      expect(t.look.getState().fovDeg).toBe(40);
    });

    it('stops for a drag and leaves the view where the user put it', async () => {
      const t = setup();
      const outcome = t.viewControl.perform({ do: 'look', target: east });
      frame(t, EASE_MIN_MS / 2);
      t.look.onPointerDown(1, 100, 100);
      t.look.onPointerMove(1, 150, 120, 800);
      const dragged = t.look.getState();
      frame(t, 16);
      expect(await outcome).toEqual({ ok: true, awaitingGaze: true });
      expect(t.viewControl.awaitedGaze()?.target).toBe(east);
      frame(t, EASE_MIN_MS);
      expect(t.look.getState()).toBe(dragged);
    });

    it('stops a field-of-view ease for a zoom key', async () => {
      const t = setup();
      const outcome = t.viewControl.perform({ do: 'fov', fovDeg: 40 });
      frame(t, EASE_MIN_MS / 2);
      t.look.onKeyDown('+');
      const zoomed = t.look.getState();
      frame(t, 16);
      expect(await outcome).toEqual({ ok: true });
      frame(t, EASE_MIN_MS);
      expect(t.look.getState()).toBe(zoomed);
    });

    it('stops when the compass comes on, and waits for the gaze', async () => {
      const t = setup();
      const outcome = t.viewControl.perform({ do: 'look', target: east });
      frame(t, EASE_MIN_MS / 2);
      const midway = t.look.getState();
      t.view.attitude = pose;
      frame(t, 16);
      expect(await outcome).toEqual({ ok: true, awaitingGaze: true });
      expect(t.look.getState()).toBe(midway);
    });

    it('hands over to a new look from where the first has got to', async () => {
      const t = setup();
      const first = t.viewControl.perform({ do: 'look', target: east });
      frame(t, EASE_MIN_MS / 2);
      const midway = centre(t.camera);
      const second = t.viewControl.perform({ do: 'look', target: north });
      expect(await first).toEqual({ ok: true });
      frame(t, 0);
      expect(centre(t.camera).angleTo(midway)).toBeLessThan(1e-9);
      frame(t, EASE_MIN_MS * 2);
      expect(centre(t.camera).angleTo(direction(north))).toBeLessThan(1e-6);
      expect(await second).toEqual({ ok: true });
    });

    it('refuses a field of view the camera cannot take, or a narrow one with no target, and touches nothing', async () => {
      const t = setup();
      const state = t.look.getState();
      for (const fovDeg of [NaN, 0, 200]) {
        expect(await t.viewControl.perform({ do: 'look', target: east, fovDeg })).toEqual({
          ok: false,
          code: 'bad-value',
          message: `fovDeg ${fovDeg} is outside 0.003 to 100`,
        });
        expect(await t.viewControl.perform({ do: 'fov', fovDeg })).toEqual({
          ok: false,
          code: 'bad-value',
          message: `fovDeg ${fovDeg} is outside 0.003 to 100`,
        });
      }
      expect(await t.viewControl.perform({ do: 'fov', fovDeg: 20 })).toEqual({
        ok: false,
        code: 'bad-value',
        message: 'a field of view under 30 needs a target: use look',
      });
      frame(t, EASE_MIN_MS);
      expect(t.look.getState()).toBe(state);
    });

    it('says when a target cannot be found, and does not move', async () => {
      const t = setup();
      const state = t.look.getState();
      t.view.labels = indexLabels([]);
      expect(await t.viewControl.perform({ do: 'look', target: { kind: 'label', name: 'Atlantis' } })).toEqual({
        ok: false,
        code: 'target-unresolved',
        message: 'no label named Atlantis',
      });
      t.view.position = null;
      expect(await t.viewControl.perform({ do: 'look', target: east })).toEqual({
        ok: false,
        code: 'target-unresolved',
        message: 'no position yet',
      });
      frame(t, EASE_MIN_MS);
      expect(t.look.getState()).toBe(state);
    });

    it('turns the short way across north', async () => {
      const t = setup();
      t.look.setAim(THREE.MathUtils.degToRad(-350), 0);
      const outcome = t.viewControl.perform({ do: 'look', target: { kind: 'horizon', azDeg: 10, altDeg: 0 } });
      const yaws = [t.look.getState().yawRad];
      for (let i = 0; i < 20; i++) {
        frame(t, 100);
        yaws.push(t.look.getState().yawRad);
      }
      expect(await outcome).toEqual({ ok: true });
      for (let i = 1; i < yaws.length; i++) expect(yaws[i]).toBeLessThanOrEqual(yaws[i - 1]);
      expect(THREE.MathUtils.radToDeg(yaws[0] - yaws[yaws.length - 1])).toBeCloseTo(20, 9);
    });

    it('keeps easing while a preset applies', async () => {
      const t = setup();
      const outcome = t.viewControl.perform({ do: 'look', target: east });
      frame(t, EASE_MIN_MS / 2);
      expect(await t.viewControl.perform({ do: 'preset', id: 'sky' })).toEqual({ ok: true });
      frame(t, EASE_MIN_MS);
      expect(await outcome).toEqual({ ok: true });
      expect(centre(t.camera).angleTo(direction(east))).toBeLessThan(1e-6);
    });
  });

  describe('mark', () => {
    const down = { kind: 'horizon', azDeg: 0, altDeg: -90 } as const;
    const north = { kind: 'horizon', azDeg: 0, altDeg: 0 } as const;
    const orion = { kind: 'sky', raDeg: 83.8, decDeg: -5.4 } as const;
    const HOUR_MS = 3_600_000;

    /** The names the label layer shows in a frame from the camera as it is. */
    function shownNames({ labelLayer, camera }: ReturnType<typeof setup>): string[] {
      labelLayer.update(camera, 800, 600);
      return labelLayer.visibleNames();
    }

    /** The texts of the marks in the view, shown or not. */
    const markTexts = ({ labelParent }: ReturnType<typeof setup>): (string | null)[] =>
      [...labelParent.querySelectorAll('.place-label--ring')].map((e) => e.textContent);

    /** Where the label layer draws the mark it was given `n`th, as a direction from the camera. */
    function markDirection({ markSpecs, camera }: ReturnType<typeof setup>, n = 0): THREE.Vector3 {
      return markSpecs[n].labels[0].position.clone().sub(camera.position).normalize();
    }

    /**
     * The angle between two directions, as their chord: angleTo's acos cannot
     * tell apart directions closer than about 1.5e-8 rad.
     */
    const apart = (a: THREE.Vector3, b: THREE.Vector3): number => a.clone().normalize().distanceTo(b.clone().normalize());

    function locatedDirection(viewControl: ViewControl, target: Target): THREE.Vector3 {
      const result = viewControl.locate(target);
      if (!result.ok) throw new Error(result.message);
      return result.direction;
    }

    it('puts a ring and its text on a target, before every other name', async () => {
      const t = setup();
      expect(await t.viewControl.perform({ do: 'mark', target: down, text: 'Moho · 24 km' })).toEqual({ ok: true });
      expect(shownNames(t)).toEqual(['Moho · 24 km']);
      expect(markTexts(t)).toEqual(['Moho · 24 km']);
      expect(t.markSpecs).toMatchObject([{ rank: -1, frame: 'earth' }]);
    });

    it('draws a mark along its target’s direction, as far off as the sky', async () => {
      const t = setup();
      await t.viewControl.perform({ do: 'mark', target: orion, text: 'Orion Nebula' });
      const offset = t.markSpecs[0].labels[0].position.clone().sub(t.camera.position);
      expect(offset.length() / SKY_RADIUS_M).toBeCloseTo(1, 9);
      expect(apart(offset, locatedDirection(t.viewControl, orion))).toBeLessThan(1e-9);
    });

    it('replaces the text of a mark on the same target', async () => {
      const t = setup();
      await t.viewControl.perform({ do: 'mark', target: down, text: 'Moho' });
      await t.viewControl.perform({ do: 'mark', target: down, text: 'Moho · 24 km' });
      expect(shownNames(t)).toEqual(['Moho · 24 km']);
      expect(markTexts(t)).toEqual(['Moho · 24 km']);
    });

    it('removes a mark however its target is written, and is fine with one that is not there', async () => {
      const t = setup();
      await t.viewControl.perform({ do: 'mark', target: down, text: 'Moho' });
      expect(await t.viewControl.perform({ do: 'mark', target: { altDeg: -90, azDeg: 0, kind: 'horizon' }, text: null })).toEqual({ ok: true });
      expect(shownNames(t)).toEqual([]);
      expect(markTexts(t)).toEqual([]);
      expect(await t.viewControl.perform({ do: 'mark', target: down, text: null })).toEqual({ ok: true });
      expect(t.markSpecs).toHaveLength(1);
    });

    it('keeps one mark when another is removed', async () => {
      const t = setup();
      await t.viewControl.perform({ do: 'mark', target: down, text: 'Below' });
      await t.viewControl.perform({ do: 'mark', target: north, text: 'North' });
      await t.viewControl.perform({ do: 'mark', target: down, text: null });
      expect(markTexts(t)).toEqual(['North']);
    });

    // There is no ease under way here: the marks move every frame regardless.
    it('follows the sky as it turns, moving the same point the label layer reads', async () => {
      const t = setup();
      await t.viewControl.perform({ do: 'mark', target: orion, text: 'Orion Nebula' });
      const position = t.markSpecs[0].labels[0].position;
      const before = markDirection(t);
      t.view.date = new Date(when.getTime() + HOUR_MS);
      t.viewControl.update(16);
      expect(t.markSpecs[0].labels[0].position).toBe(position);
      // An hour of the Earth's turn, 15°, a little less on a circle off the equator.
      expect(THREE.MathUtils.radToDeg(markDirection(t).angleTo(before))).toBeCloseTo(15, 0);
      expect(apart(markDirection(t), locatedDirection(t.viewControl, orion))).toBeLessThan(1e-9);
    });

    it('places nothing for a target it cannot find', async () => {
      const t = setup();
      t.view.labels = indexLabels([]);
      expect(await t.viewControl.perform({ do: 'mark', target: { kind: 'label', name: 'Atlantis' }, text: 'Atlantis' })).toEqual({
        ok: false,
        code: 'target-unresolved',
        message: 'no label named Atlantis',
      });
      t.view.position = null;
      expect(await t.viewControl.perform({ do: 'mark', target: down, text: 'Moho' })).toEqual({
        ok: false,
        code: 'target-unresolved',
        message: 'no position yet',
      });
      expect(markTexts(t)).toEqual([]);
      expect(t.markSpecs).toEqual([]);
    });

    it('leaves a mark where it was while its target is lost, and puts it back once found', async () => {
      const t = setup();
      await t.viewControl.perform({ do: 'mark', target: orion, text: 'Orion Nebula' });
      const held = t.markSpecs[0].labels[0].position.clone();
      t.view.position = null;
      t.view.date = new Date(when.getTime() + HOUR_MS);
      t.viewControl.update(16);
      expect(t.markSpecs[0].labels[0].position.toArray()).toEqual(held.toArray());
      t.view.position = austin;
      t.viewControl.update(16);
      expect(apart(markDirection(t), locatedDirection(t.viewControl, orion))).toBeLessThan(1e-9);
    });

    it('refuses empty text', async () => {
      const t = setup();
      expect(await t.viewControl.perform({ do: 'mark', target: down, text: '' })).toEqual({
        ok: false,
        code: 'bad-value',
        message: 'mark text is empty',
      });
      expect(t.markSpecs).toEqual([]);
    });

    it('neither stops an ease nor is moved off by a look', async () => {
      const t = setup();
      const looking = t.viewControl.perform({ do: 'look', target: north });
      t.viewControl.update(EASE_MIN_MS / 2);
      expect(await t.viewControl.perform({ do: 'mark', target: down, text: 'Moho' })).toEqual({ ok: true });
      t.viewControl.update(EASE_MIN_MS);
      expect(await looking).toEqual({ ok: true });
      const lookingAgain = t.viewControl.perform({ do: 'look', target: orion });
      t.viewControl.update(EASE_MIN_MS * 10);
      expect(await lookingAgain).toEqual({ ok: true });
      expect(markTexts(t)).toEqual(['Moho']);
    });
  });

  describe('waiting for the gaze', () => {
    const east = { kind: 'horizon', azDeg: 90, altDeg: 0 } as const;
    const north = { kind: 'horizon', azDeg: 0, altDeg: 0 } as const;
    const pose: DeviceAttitude = { alpha: 0, beta: 0, gamma: 0 };

    /** A view control in a pose: the device aims the view, so a look waits on the user. */
    function posed() {
      const t = setup();
      t.view.attitude = pose;
      return t;
    }

    function locatedDirection(viewControl: ViewControl, target: Target): THREE.Vector3 {
      const result = viewControl.locate(target);
      if (!result.ok) throw new Error(result.message);
      return result.direction;
    }

    /** Turn the camera, as the user turning the phone would, to `offDeg` off `target`. */
    function turnTo({ viewControl, camera }: ReturnType<typeof setup>, target: Target, offDeg = 0): void {
      const direction = locatedDirection(viewControl, target);
      const across = direction.clone().cross(camera.position).normalize();
      camera.lookAt(camera.position.clone().add(direction.applyAxisAngle(across, THREE.MathUtils.degToRad(offDeg))));
      camera.updateMatrixWorld();
    }

    it('in a pose, answers at once and keeps what it waits for', async () => {
      const t = posed();
      const target = { kind: 'body', body: 'mars' } as const;
      expect(await t.viewControl.perform({ do: 'look', target })).toEqual({ ok: true, awaitingGaze: true });
      const awaited = t.viewControl.awaitedGaze()!;
      expect(awaited.target).toBe(target);
      expect(awaited.name).toBe(targetName(target));
      expect(awaited.direction.toArray()).toEqual(locatedDirection(t.viewControl, target).toArray());
      expect(awaited.arriving).toBe(0);
    });

    it('arrives once the target has stayed at the centre long enough', async () => {
      const t = posed();
      await t.viewControl.perform({ do: 'look', target: east });
      turnTo(t, east);
      t.viewControl.update(ARRIVE_MS / 2);
      expect(t.viewControl.awaitedGaze()?.arriving).toBe(0.5);
      t.viewControl.update(ARRIVE_MS / 2);
      expect(t.viewControl.awaitedGaze()).toBeNull();
    });

    it('starts the stay again when the view leaves the target before it is done', async () => {
      const t = posed();
      await t.viewControl.perform({ do: 'look', target: east });
      turnTo(t, east);
      t.viewControl.update(500);
      turnTo(t, north);
      t.viewControl.update(16);
      turnTo(t, east);
      t.viewControl.update(500);
      expect(t.viewControl.awaitedGaze()?.arriving).toBeCloseTo(500 / ARRIVE_MS, 9);
    });

    it(`counts the view as on the target within ${ARRIVE_DEG}° of it`, async () => {
      const t = posed();
      await t.viewControl.perform({ do: 'look', target: east });
      turnTo(t, east, ARRIVE_DEG + 0.1);
      t.viewControl.update(ARRIVE_MS);
      expect(t.viewControl.awaitedGaze()?.arriving).toBe(0);
      turnTo(t, east, ARRIVE_DEG - 0.1);
      t.viewControl.update(ARRIVE_MS);
      expect(t.viewControl.awaitedGaze()).toBeNull();
    });

    it('applies the field of view on arrival, no narrower than a hand holds still', async () => {
      const t = posed();
      await t.viewControl.perform({ do: 'look', target: east, fovDeg: 40 });
      turnTo(t, east);
      t.viewControl.update(ARRIVE_MS / 2);
      expect(t.look.getState().fovDeg).toBe(DEFAULT_LOOK_STATE.fovDeg);
      t.viewControl.update(ARRIVE_MS / 2);
      expect(t.look.getState().fovDeg).toBe(40);
      await t.viewControl.perform({ do: 'look', target: east, fovDeg: 2 });
      t.viewControl.update(ARRIVE_MS);
      expect(t.look.getState().fovDeg).toBe(POSE_MIN_FOV_DEG);
    });

    describe('in Cardboard', () => {
      function inCardboard() {
        const t = posed();
        t.view.stereo = true;
        return t;
      }

      it(`opens the spyglass on a narrow look's target once it is within ${CAPTURE_DEG}°, framed at the look's width`, async () => {
        const t = inCardboard();
        await t.viewControl.perform({ do: 'look', target: east, fovDeg: 6 });
        turnTo(t, east, CAPTURE_DEG + 1);
        t.viewControl.update(ARRIVE_MS);
        // Arrived: the guide moves on, the view's own width is left alone, and the spyglass waits for the capture.
        expect(t.viewControl.awaitedGaze()).toBeNull();
        expect(t.look.getState().fovDeg).toBe(DEFAULT_LOOK_STATE.fovDeg);
        expect(t.spyglassOpened).toHaveLength(0);
        turnTo(t, east, CAPTURE_DEG - 0.5);
        t.viewControl.update(16);
        expect(t.spyglassOpened).toHaveLength(1);
        const [opened] = t.spyglassOpened;
        expect(framingDeg(opened)).toBeCloseTo(6, 9);
        expect(opened.key).toBe(targetKey(east));
        expect(opened.directionInto(new THREE.Vector3()).toArray()).toEqual(locatedDirection(t.viewControl, east).toArray());
        t.viewControl.update(16);
        expect(t.spyglassOpened).toHaveLength(1);
      });

      it('narrows nothing for a wide look, and opens no spyglass', async () => {
        const t = inCardboard();
        await t.viewControl.perform({ do: 'look', target: east, fovDeg: 40 });
        turnTo(t, east);
        t.viewControl.update(ARRIVE_MS);
        t.viewControl.update(16);
        expect(t.spyglassOpened).toHaveLength(0);
      });

      it('forgets the spyglass when the viewer is left before the target is captured, or a new look comes', async () => {
        const t = inCardboard();
        await t.viewControl.perform({ do: 'look', target: east, fovDeg: 6 });
        turnTo(t, east, 5);
        t.viewControl.update(ARRIVE_MS);
        t.view.stereo = false;
        t.viewControl.update(16);
        t.view.stereo = true;
        turnTo(t, east);
        t.viewControl.update(16);
        expect(t.spyglassOpened).toHaveLength(0);

        await t.viewControl.perform({ do: 'look', target: east, fovDeg: 6 });
        turnTo(t, east, 5);
        t.viewControl.update(ARRIVE_MS);
        await t.viewControl.perform({ do: 'look', target: north });
        turnTo(t, east);
        t.viewControl.update(16);
        expect(t.spyglassOpened).toHaveLength(0);
      });
    });

    it('waits on a look whose ease the user took over, and eases its field of view in when they arrive', async () => {
      const t = setup();
      const outcome = t.viewControl.perform({ do: 'look', target: east, fovDeg: 40 });
      t.viewControl.update(EASE_MIN_MS / 2);
      t.look.onPointerDown(1, 100, 100);
      t.look.onPointerMove(1, 150, 120, 800);
      t.viewControl.update(16);
      expect(await outcome).toEqual({ ok: true, awaitingGaze: true });
      const fovWhenStopped = t.look.getState().fovDeg;
      // The user drags the rest of the way.
      t.look.setAim(-Math.PI / 2, 0);
      t.look.updateCamera(t.camera, austin, null, 0);
      t.viewControl.update(ARRIVE_MS);
      expect(t.viewControl.awaitedGaze()).toBeNull();
      expect(t.look.getState().fovDeg).toBe(fovWhenStopped);
      t.viewControl.update(EASE_MIN_MS);
      expect(t.look.getState().fovDeg).toBe(40);
    });

    it('waits on the latest look in a pose, and on none once a look turns the view', async () => {
      const t = posed();
      await t.viewControl.perform({ do: 'look', target: east });
      turnTo(t, east);
      t.viewControl.update(ARRIVE_MS / 2);
      await t.viewControl.perform({ do: 'look', target: north });
      expect(t.viewControl.awaitedGaze()).toMatchObject({ target: north, arriving: 0 });
      t.view.attitude = null;
      void t.viewControl.perform({ do: 'look', target: east });
      expect(t.viewControl.awaitedGaze()).toBeNull();
    });

    it('keeps waiting through a look that is refused', async () => {
      const t = posed();
      t.view.labels = indexLabels([]);
      await t.viewControl.perform({ do: 'look', target: east });
      turnTo(t, east);
      t.viewControl.update(ARRIVE_MS / 2);
      expect((await t.viewControl.perform({ do: 'look', target: { kind: 'label', name: 'Atlantis' } })).ok).toBe(false);
      expect((await t.viewControl.perform({ do: 'look', target: north, fovDeg: 200 })).ok).toBe(false);
      expect(t.viewControl.awaitedGaze()).toMatchObject({ target: east, arriving: 0.5 });
    });

    it('stops waiting when told, without the field of view', async () => {
      const t = posed();
      await t.viewControl.perform({ do: 'look', target: east, fovDeg: 40 });
      t.viewControl.stopAwaitingGaze();
      expect(t.viewControl.awaitedGaze()).toBeNull();
      turnTo(t, east);
      t.viewControl.update(ARRIVE_MS);
      expect(t.look.getState().fovDeg).toBe(DEFAULT_LOOK_STATE.fovDeg);
      expect(() => t.viewControl.stopAwaitingGaze()).not.toThrow();
    });

    it('holds the stay while the target is lost, and arrives once it is found again', async () => {
      const t = posed();
      await t.viewControl.perform({ do: 'look', target: east });
      turnTo(t, east);
      t.viewControl.update(ARRIVE_MS / 2);
      t.view.position = null;
      for (let i = 0; i < 3; i++) t.viewControl.update(16);
      expect(t.viewControl.awaitedGaze()?.arriving).toBe(0.5);
      t.view.position = austin;
      t.viewControl.update(ARRIVE_MS / 2);
      expect(t.viewControl.awaitedGaze()).toBeNull();
    });

    it('follows a target across the sky, in the direction it handed out', async () => {
      const t = posed();
      const orion = { kind: 'sky', raDeg: 83.8, decDeg: -5.4, name: 'Orion Nebula' } as const;
      await t.viewControl.perform({ do: 'look', target: orion });
      const direction = t.viewControl.awaitedGaze()!.direction;
      const before = direction.clone();
      t.view.date = new Date(when.getTime() + 3_600_000);
      t.viewControl.update(16);
      expect(t.viewControl.awaitedGaze()!.direction).toBe(direction);
      expect(THREE.MathUtils.radToDeg(direction.angleTo(before))).toBeCloseTo(15, 0);
    });

    it('keeps waiting through a field of view or a mark', async () => {
      const t = posed();
      await t.viewControl.perform({ do: 'look', target: east });
      turnTo(t, east);
      t.viewControl.update(ARRIVE_MS / 2);
      expect(await t.viewControl.perform({ do: 'fov', fovDeg: 40 })).toEqual({ ok: true });
      expect(await t.viewControl.perform({ do: 'mark', target: east, text: 'East' })).toEqual({ ok: true });
      expect(t.viewControl.awaitedGaze()).toMatchObject({ target: east, arriving: 0.5 });
    });
  });

  describe('restore', () => {
    const down = { kind: 'horizon', azDeg: 0, altDeg: -90 } as const;
    const east = { kind: 'horizon', azDeg: 90, altDeg: 0 } as const;
    const north = { kind: 'horizon', azDeg: 0, altDeg: 0 } as const;
    const pose: DeviceAttitude = { alpha: 0, beta: 0, gamma: 0 };

    /** A whole view with these switches, looking straight down as the app starts, with no marks. */
    const scene = (layers: FoldedView['layers'], rest: Partial<Omit<FoldedView, 'layers'>> = {}): FoldedView => ({
      layers,
      look: { target: down, fovDeg: DEFAULT_LOOK_STATE.fovDeg },
      marks: [],
      ...rest,
    });

    /** The switches on, by id, in no particular order. */
    const onIds = ({ switches, input }: ReturnType<typeof setup>): string[] =>
      switches
        .filter((s) => input(s.id).checked)
        .map((s) => s.id)
        .sort();

    /** The texts of the marks in the view, in the order they went up. */
    const markTexts = ({ labelParent }: ReturnType<typeof setup>): (string | null)[] =>
      [...labelParent.querySelectorAll('.place-label--ring')].map((e) => e.textContent);

    const centre = (camera: THREE.Camera): THREE.Vector3 => camera.getWorldDirection(new THREE.Vector3());

    function located(viewControl: ViewControl, target: Target): Located {
      const result = viewControl.locate(target);
      if (!result.ok) throw new Error(result.message);
      return result;
    }

    it('starts from the preset, takes off what went off and puts on what went on', async () => {
      const t = setup();
      expect(await t.viewControl.restore(scene({ preset: 'night', on: ['clouds'], off: ['aurora'] }))).toEqual({ ok: true });
      expect(onIds(t)).toEqual(['clouds', 'x-ray']);
    });

    it('shows exactly the switches a listed scene names', async () => {
      const t = setup();
      await t.viewControl.restore(scene({ only: ['aurora', 'clouds'] }));
      expect(onIds(t)).toEqual(['aurora', 'clouds']);
    });

    it('lets the last of an exclusive group turned on win, as playing through does', async () => {
      const t = setup();
      await t.viewControl.restore(scene({ only: ['x-ray', 'cmb'] }));
      expect(onIds(t)).toEqual(['cmb']);
      await t.viewControl.restore(scene({ only: ['cmb', 'x-ray'] }));
      expect(onIds(t)).toEqual(['x-ray']);
      await t.viewControl.restore(scene({ preset: 'sky', on: ['cmb'], off: [] }));
      expect(onIds(t)).toEqual(['cmb']);
    });

    it('ends on the switches and marks that playing the same actions through ends on', async () => {
      const actions: ViewAction[] = [
        { do: 'preset', id: 'default' },
        { do: 'layers', on: ['x-ray'] },
        { do: 'layers', on: ['cmb'] },
        { do: 'layers', on: ['x-ray'] },
        { do: 'layers', off: ['clouds'] },
        { do: 'look', target: east, fovDeg: 40 },
        { do: 'mark', target: down, text: 'Moho' },
        { do: 'mark', target: north, text: 'North' },
        { do: 'mark', target: down, text: null },
      ];
      const played = setup();
      played.view.reducedMotion = true;
      for (const action of actions) await played.viewControl.perform(action);
      const restored = setup();
      expect(await restored.viewControl.restore(actions.reduce(foldAction, scene({ only: [] })))).toEqual({ ok: true });
      expect(onIds(restored)).toEqual(onIds(played));
      expect(onIds(restored)).toContain('x-ray');
      expect(markTexts(restored)).toEqual(markTexts(played));
      expect(markTexts(restored)).toEqual(['North']);
    });

    it('flips only the switches that differ, those going off first', async () => {
      const t = setup(JSON.stringify({ cmb: true }));
      await t.viewControl.restore(scene({ only: ['cmb', 'clouds', 'aurora'] }));
      expect(t.changes.map(([id]) => id)).not.toContain('cmb');
      expect(t.changes.map(([id]) => id)).not.toContain('clouds');
      expect(t.changes.at(-1)).toEqual(['aurora', true]);
      expect(t.changes.filter(([, visible]) => visible)).toEqual([['aurora', true]]);
    });

    it('is done only once the lazy layers it turns on have loaded', async () => {
      const cmb = heldLoad();
      const t = setup(null, { cmb: cmb.load });
      const outcome = t.viewControl.restore(scene({ only: ['cmb'] }));
      const flag = settledFlag(outcome);
      await settle();
      expect(flag.settled).toBe(false);
      expect(t.input('cmb').checked).toBe(true);
      cmb.finish();
      expect(await outcome).toEqual({ ok: true });
    });

    it('says which layer failed to load, and leaves its switch on', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const load = vi.fn<LayerDefinition['load']>().mockRejectedValueOnce(new Error('offline'));
      const t = setup(null, { cmb: load });
      expect(await t.viewControl.restore(scene({ only: ['cmb'] }))).toEqual({ ok: false, code: 'layer-unavailable', message: 'layer failed to load: cmb' });
      expect(t.input('cmb').checked).toBe(true);
      error.mockRestore();
    });

    it.each<[string, FoldedView, object]>([
      ['an unknown preset', scene({ preset: 'no-such', on: [], off: [] }), { code: 'unknown-preset', message: 'no preset no-such' }],
      ['unknown switches', scene({ preset: 'sky', on: ['nope'], off: ['gone', 'nope'] }), { code: 'unknown-layer', message: 'no layer switch gone, nope' }],
      ['an unknown switch in a list', scene({ only: ['cmb', 'nope'] }), { code: 'unknown-layer', message: 'no layer switch nope' }],
      [
        'a field of view the camera cannot take',
        scene({ only: ['cmb'] }, { look: { target: down, fovDeg: 500 } }),
        { code: 'bad-value', message: `fovDeg 500 is outside ${MIN_FOV_DEG} to ${MAX_FOV_DEG}` },
      ],
      [
        'a look at a label before the labels load',
        scene({ only: ['cmb'] }, { look: { target: { kind: 'label', name: 'Madagascar' }, fovDeg: 60 } }),
        { code: 'target-unresolved', message: 'the label files have not loaded' },
      ],
      ['a mark with no text', scene({ only: ['cmb'] }, { marks: [{ target: east, text: '' }] }), { code: 'bad-value', message: 'mark text is empty' }],
      [
        'a mark on a label before the labels load',
        scene({ only: ['cmb'] }, { marks: [{ target: east, text: 'East' }, { target: { kind: 'label', name: 'Madagascar' }, text: 'Here' }] }),
        { code: 'target-unresolved', message: 'the label files have not loaded' },
      ],
    ])('refuses %s, and changes nothing', async (_, view, refusal) => {
      const t = setup();
      await t.viewControl.perform({ do: 'mark', target: north, text: 'North' });
      const state = t.look.getState();
      expect(await t.viewControl.restore(view)).toEqual({ ok: false, ...refusal });
      expect(t.changes).toEqual([]);
      expect(t.stored.has(LAYERS_STORAGE_KEY)).toBe(false);
      expect(markTexts(t)).toEqual(['North']);
      expect(t.look.getState()).toBe(state);
    });

    it('cuts to the look where a drag aims the view, ending an ease under way', async () => {
      const t = setup();
      const easing = t.viewControl.perform({ do: 'look', target: north });
      t.viewControl.update(EASE_MIN_MS / 2);
      const outcome = t.viewControl.restore(scene({ only: [] }, { look: { target: east, fovDeg: 20 } }));
      // In place before restore's promise, or the ease's, is awaited.
      t.look.updateCamera(t.camera, austin, null, 0);
      expect(centre(t.camera).angleTo(located(t.viewControl, east).direction)).toBeLessThan(1e-6);
      expect(t.look.getState().fovDeg).toBe(20);
      expect(t.viewControl.awaitedGaze()).toBeNull();
      expect(await easing).toEqual({ ok: true });
      expect(await outcome).toEqual({ ok: true });
      // Nothing left to ease: a later frame leaves the view where the cut put it.
      t.viewControl.update(EASE_MIN_MS);
      t.look.updateCamera(t.camera, austin, null, 0);
      expect(centre(t.camera).angleTo(located(t.viewControl, east).direction)).toBeLessThan(1e-6);
    });

    it('turns nothing where the pose aims the view: the look waits on the user, and its width comes on arrival', async () => {
      const t = setup();
      t.view.attitude = pose;
      const state = t.look.getState();
      expect(await t.viewControl.restore(scene({ only: [] }, { look: { target: east, fovDeg: 2 } }))).toEqual({ ok: true, awaitingGaze: true });
      expect(t.viewControl.awaitedGaze()).toMatchObject({ target: east, arriving: 0 });
      expect(t.look.getState()).toBe(state);
      t.camera.lookAt(t.camera.position.clone().add(located(t.viewControl, east).direction));
      t.camera.updateMatrixWorld();
      t.viewControl.update(ARRIVE_MS);
      expect(t.viewControl.awaitedGaze()).toBeNull();
      expect(t.look.getState().fovDeg).toBe(POSE_MIN_FOV_DEG);
    });

    it('takes every mark down and puts the view’s up in order, one to a target', async () => {
      const t = setup();
      await t.viewControl.perform({ do: 'mark', target: down, text: 'Moho' });
      await t.viewControl.perform({ do: 'mark', target: east, text: 'East' });
      const sameNorth = { altDeg: 0, azDeg: 0, kind: 'horizon' } as const;
      await t.viewControl.restore(
        scene(
          { only: [] },
          {
            marks: [
              { target: north, text: 'North' },
              { target: east, text: 'East again' },
              { target: sameNorth, text: 'North again' },
            ],
          },
        ),
      );
      expect(markTexts(t)).toEqual(['East again', 'North again']);
    });

    describe('preload', () => {
      /** A setup whose every layer load is a spy, by id. */
      function spied() {
        const loads = Object.fromEntries(definitions.map((d) => [d.id, vi.fn(d.load)]));
        return { ...setup(null, loads), loads };
      }

      it('loads the lazy layers a view would turn on, and changes nothing: no switch, no save, no mark, no aim', async () => {
        const t = spied();
        await t.viewControl.perform({ do: 'mark', target: north, text: 'North' });
        const on = onIds(t);
        const state = t.look.getState();
        // A look and a mark that do not resolve yet: preload has nothing to do with them.
        const madagascar = { kind: 'label', name: 'Madagascar' } as const;
        const view = scene({ only: ['cmb', 'aurora'] }, { look: { target: madagascar, fovDeg: 60 }, marks: [{ target: madagascar, text: 'Here' }] });
        expect(await t.viewControl.preload(view)).toEqual({ ok: true });
        expect(t.loads.cmb).toHaveBeenCalledOnce();
        expect(t.loads.aurora).toHaveBeenCalledOnce();
        expect(t.loads['x-ray']).not.toHaveBeenCalled();
        expect(t.changes).toEqual([]);
        expect(t.stored.has(LAYERS_STORAGE_KEY)).toBe(false);
        expect(onIds(t)).toEqual(on);
        expect(markTexts(t)).toEqual(['North']);
        expect(t.look.getState()).toBe(state);
      });

      it.each<[string, FoldedView['layers']]>([
        ['a list', { only: ['x-ray', 'cmb'] }],
        ['a preset and what went on since', { preset: 'sky', on: ['cmb'], off: [] }],
      ])('loads only the last of an exclusive group turned on, as restore shows: %s', async (_, layers) => {
        const t = spied();
        expect(await t.viewControl.preload(scene(layers))).toEqual({ ok: true });
        expect(t.loads.cmb).toHaveBeenCalledOnce();
        expect(t.loads['x-ray']).not.toHaveBeenCalled();
      });

      it.each<[string, FoldedView['layers'], object]>([
        ['an unknown preset', { preset: 'no-such', on: ['cmb'], off: [] }, { code: 'unknown-preset', message: 'no preset no-such' }],
        ['an unknown switch', { only: ['cmb', 'nope'] }, { code: 'unknown-layer', message: 'no layer switch nope' }],
      ])('refuses %s as restore does, and loads nothing', async (_, layers, refusal) => {
        const t = spied();
        expect(await t.viewControl.preload(scene(layers))).toEqual({ ok: false, ...refusal });
        for (const load of Object.values(t.loads)) expect(load).not.toHaveBeenCalled();
      });

      it('says which layer failed to load', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const load = vi.fn<LayerDefinition['load']>().mockRejectedValueOnce(new Error('offline'));
        const t = setup(null, { cmb: load });
        expect(await t.viewControl.preload(scene({ only: ['cmb'] }))).toEqual({ ok: false, code: 'layer-unavailable', message: 'layer failed to load: cmb' });
        expect(t.input('cmb').checked).toBe(false);
        error.mockRestore();
      });

      it('leaves restore nothing to wait for', async () => {
        const cmb = heldLoad();
        const t = setup(null, { cmb: cmb.load });
        const preloading = t.viewControl.preload(scene({ only: ['cmb'] }));
        cmb.finish();
        expect(await preloading).toEqual({ ok: true });
        const flag = settledFlag(t.viewControl.restore(scene({ only: ['cmb'] })));
        await settle();
        expect(flag.settled).toBe(true);
        expect(cmb.load).toHaveBeenCalledOnce();
      });
    });
  });

  describe('borrow', () => {
    const east = { kind: 'horizon', azDeg: 90, altDeg: 0 } as const;
    const north = { kind: 'horizon', azDeg: 0, altDeg: 0 } as const;
    const pose: DeviceAttitude = { alpha: 0, beta: 0, gamma: 0 };

    /** The switches on, by id, in no particular order. */
    const onIds = ({ switches, input }: ReturnType<typeof setup>): string[] =>
      switches
        .filter((s) => input(s.id).checked)
        .map((s) => s.id)
        .sort();

    /** The texts of the marks in the view, in the order they went up. */
    const markTexts = ({ labelParent }: ReturnType<typeof setup>): (string | null)[] =>
      [...labelParent.querySelectorAll('.place-label--ring')].map((e) => e.textContent);

    /** What a guide does to the switches: a preset, a flip and a whole view. */
    async function playGuide({ viewControl }: ReturnType<typeof setup>): Promise<void> {
      expect(await viewControl.perform({ do: 'preset', id: 'night' })).toEqual({ ok: true });
      expect(await viewControl.perform({ do: 'layers', on: ['cmb'], off: ['clouds'] })).toEqual({ ok: true });
      const view: FoldedView = { layers: { only: ['aurora', 'clouds'] }, look: { target: east, fovDeg: 30 }, marks: [] };
      expect(await viewControl.restore(view)).toEqual({ ok: true });
    }

    it('saves no switch while borrowed, and puts the switches back at the end', async () => {
      const t = setup(JSON.stringify({ cmb: true }));
      const before = onIds(t);
      const borrow = t.viewControl.borrow();
      await playGuide(t);
      expect(onIds(t)).toEqual(['aurora', 'clouds']);
      expect(t.stored.has(LAYERS_STORAGE_KEY)).toBe(false);
      borrow.end();
      expect(onIds(t)).toEqual(before);
      expect(t.stored.has(LAYERS_STORAGE_KEY)).toBe(false);
    });

    it('leaves what was saved before the borrow as it was, to the letter', async () => {
      const t = setup();
      await t.viewControl.perform({ do: 'layers', on: ['aurora'] });
      const saved = t.stored.get(LAYERS_STORAGE_KEY);
      expect(saved).toBeDefined();
      const borrow = t.viewControl.borrow();
      await playGuide(t);
      borrow.end();
      expect(t.stored.get(LAYERS_STORAGE_KEY)).toBe(saved);
    });

    it('puts the field of view back and leaves the aim where it is', async () => {
      const t = setup();
      t.view.reducedMotion = true;
      await t.viewControl.perform({ do: 'fov', fovDeg: 50 });
      const borrow = t.viewControl.borrow();
      await t.viewControl.perform({ do: 'look', target: east, fovDeg: 20 });
      const turned = t.look.getState();
      expect(turned.fovDeg).toBe(20);
      borrow.end();
      expect(t.look.getState()).toEqual({ ...turned, fovDeg: 50 });
    });

    it('takes every mark down and ends an ease under way, which leaves the view there', async () => {
      const t = setup();
      const borrow = t.viewControl.borrow();
      await t.viewControl.perform({ do: 'mark', target: north, text: 'North' });
      await t.viewControl.perform({ do: 'mark', target: east, text: 'East' });
      const easing = t.viewControl.perform({ do: 'look', target: north });
      t.viewControl.update(EASE_MIN_MS / 2);
      borrow.end();
      expect(markTexts(t)).toEqual([]);
      expect(await easing).toEqual({ ok: true });
      const ended = t.look.getState();
      t.viewControl.update(EASE_MIN_MS);
      expect(t.look.getState()).toBe(ended);
      expect(t.viewControl.awaitedGaze()).toBeNull();
    });

    it('stops a look that waits on the user', async () => {
      const t = setup();
      t.view.attitude = pose;
      const borrow = t.viewControl.borrow();
      expect(await t.viewControl.perform({ do: 'look', target: east })).toEqual({ ok: true, awaitingGaze: true });
      borrow.end();
      expect(t.viewControl.awaitedGaze()).toBeNull();
    });

    it('lends the view once at a time, ends a borrow once, and lends it again after', () => {
      const t = setup();
      const borrow = t.viewControl.borrow();
      expect(() => t.viewControl.borrow()).toThrow(new Error('the view is already borrowed'));
      borrow.end();
      expect(() => borrow.end()).toThrow(new Error('the view borrow has already ended'));
      const again = t.viewControl.borrow();
      again.end();
    });
  });
});
