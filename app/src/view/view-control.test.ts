import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createLookController, DEFAULT_LOOK_STATE } from '../input/look';
import { LayerManager, type SharedLayerContext } from '../layers/manager';
import type { LayerDefinition, LayerInstance } from '../layers/types';
import type { DeviceAttitude, SurfacePosition } from '../sensors';
import { LAYERS_STORAGE_KEY, LayersPanel, loadLayerVisibility, switchesWithLazyLayers, type LayerSwitch } from '../ui/layers-panel';
import { defaultPreset, presetVisibility, type LayerPreset } from '../ui/presets';
import type { Located, Target, ViewControl } from './actions';
import { EASE_MIN_MS } from './aim-ease';
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
   * starts; `view` holds what the control reads of the app: the position,
   * the labels, the pose (none, so a drag aims the view) and whether less
   * motion is asked for.
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
      labels: LabelIndex | null;
      attitude: DeviceAttitude | null;
      reducedMotion: boolean;
    } = { position: austin, labels: null, attitude: null, reducedMotion: false };
    const viewControl = createViewControl({
      presets,
      switches,
      layersPanel,
      lazyLayers,
      camera,
      getPosition: () => view.position,
      now: () => when,
      getLabels: () => view.labels,
      look,
      getAttitude: () => view.attitude,
      prefersReducedMotion: () => view.reducedMotion,
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
});
