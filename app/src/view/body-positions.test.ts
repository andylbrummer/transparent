import { beforeEach, describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createLookController } from '../input/look';
import type { SurfacePosition } from '../sensors';
import type { FoldedView, Target } from './actions';

const austin: SurfacePosition = { lat: 30.27, lon: -97.74 };
const when = new Date('2026-11-09T06:00:00Z');
const sun: Target = { kind: 'body', body: 'sun' };
const mars: Target = { kind: 'body', body: 'mars' };
const north: Target = { kind: 'horizon', azDeg: 0, altDeg: 0 };
const notLoaded = { ok: false, code: 'target-unresolved', message: 'the Sun, Moon and planet positions have not loaded' };

// Fresh modules for every test, so each starts with the body positions not loaded, as the app does.
let targets: typeof import('./targets');
let viewControls: typeof import('./view-control');
beforeEach(async () => {
  vi.resetModules();
  targets = await import('./targets');
  viewControls = await import('./view-control');
});

/** A view control with no layers, at Austin, that turns at once. */
function viewControl() {
  const camera = new THREE.PerspectiveCamera();
  const look = createLookController();
  look.updateCamera(camera, austin, null, 0);
  return viewControls.createViewControl({
    presets: [],
    switches: [],
    layersPanel: { applyPreset: vi.fn(), setLayer: vi.fn(), showOnly: vi.fn(), borrow: vi.fn() },
    lazyLayers: { preload: vi.fn(async () => {}) },
    camera,
    getPosition: () => austin,
    now: () => when,
    getLabels: () => null,
    look,
    getAttitude: () => null,
    prefersReducedMotion: () => true,
    addLabels: vi.fn(),
  });
}

describe('before the body positions load', () => {
  it('a body does not resolve, and says why; other targets do', () => {
    expect(targets.needsBodyPositions(sun)).toBe(true);
    expect(targets.needsBodyPositions(north)).toBe(false);
    expect(targets.targetDirection(sun, austin, when, new Map())).toEqual(notLoaded);
    expect(viewControl().locate(sun)).toEqual(notLoaded);
    expect(targets.targetDirection(north, austin, when, new Map()).ok).toBe(true);
  });

  it('they load once, however often asked', async () => {
    const first = targets.loadBodyPositions();
    expect(targets.loadBodyPositions()).toBe(first);
    await first;
    expect(targets.needsBodyPositions(sun)).toBe(false);
    expect(targets.targetDirection(sun, austin, when, new Map()).ok).toBe(true);
  });
});

describe('the view control waits for them', () => {
  const view: FoldedView = { layers: { only: [] }, look: { target: mars, fovDeg: 60 }, marks: [] };

  it('in a look at a body', async () => {
    const control = viewControl();
    expect(await control.perform({ do: 'look', target: sun })).toEqual({ ok: true });
    expect(control.locate(sun).ok).toBe(true);
  });

  it('in putting back a view that looks at a body', async () => {
    const control = viewControl();
    expect(await control.restore(view)).toEqual({ ok: true });
    expect(control.locate(mars).ok).toBe(true);
  });

  it('in a preload of such a view, so the restore that follows has them', async () => {
    const control = viewControl();
    expect(await control.preload(view)).toEqual({ ok: true });
    expect(targets.needsBodyPositions(mars)).toBe(false);
  });

  it('not in a preload of a view with no body in it', async () => {
    const control = viewControl();
    expect(await control.preload({ ...view, look: { target: north, fovDeg: 60 } })).toEqual({ ok: true });
    expect(targets.needsBodyPositions(mars)).toBe(true);
  });
});
