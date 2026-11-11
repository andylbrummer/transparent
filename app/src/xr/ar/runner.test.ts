import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { ARControls } from '../../ui/ar-controls';
import { ARRunner, type ARRenderer } from './runner';

const POSITION = { lat: 30.27, lon: -97.74 };

class FakeSession extends EventTarget {
  hitSource = { cancel: vi.fn() };
  requestReferenceSpace = vi.fn(async () => ({}) as XRReferenceSpace);
  requestHitTestSource = vi.fn(async () => this.hitSource as unknown as XRHitTestSource);
  end = vi.fn(async () => void this.dispatchEvent(new Event('end')));
}

/** Enough of WebXRManager: the viewer stands 1.4 m over the XR origin, facing -Z. */
function fakeRenderer(): ARRenderer & { viewerCamera: THREE.PerspectiveCamera } {
  const viewerCamera = new THREE.PerspectiveCamera(70, 0.5, 0.1, 1e9);
  let clearAlpha = 1;
  const clear = new THREE.Color(0x050510);
  const xr = {
    enabled: false,
    setReferenceSpaceType: vi.fn(),
    setSession: vi.fn(async () => undefined),
    getReferenceSpace: () => ({}) as XRReferenceSpace,
    getCamera: () => viewerCamera,
    updateCamera(camera: THREE.PerspectiveCamera) {
      // As three.js does: the viewer's world pose is the parent's matrix times the device pose.
      const pose = new THREE.Matrix4().makeTranslation(0, 1.4, 0);
      viewerCamera.matrixWorld.multiplyMatrices(camera.parent!.matrixWorld, pose);
      camera.matrix.copy(pose);
      camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
    },
  };
  return {
    xr: xr as unknown as THREE.WebXRManager,
    viewerCamera,
    getClearColor: (target: THREE.Color) => target.copy(clear),
    getClearAlpha: () => clearAlpha,
    setClearColor: (color: THREE.ColorRepresentation, alpha?: number) => {
      clear.set(color);
      if (alpha !== undefined) clearAlpha = alpha;
    },
  } as unknown as ARRenderer & { viewerCamera: THREE.PerspectiveCamera };
}

function frameWithHit(at: THREE.Vector3 | null): XRFrame {
  const results = at ? [{ getPose: () => ({ transform: { position: at } }) }] : [];
  return { getHitTestResults: () => results } as unknown as XRFrame;
}

function setUp(heading: number | null = 90) {
  vi.stubGlobal('navigator', { xr: { isSessionSupported: async () => true } });
  const session = new FakeSession();
  const renderer = fakeRenderer();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050510);
  const layer = new THREE.MeshBasicMaterial();
  scene.add(new THREE.Mesh(new THREE.BufferGeometry(), layer));
  const controls = new ARControls(document.createElement('div'), vi.fn(), vi.fn());
  const onChange = vi.fn();
  const runner = new ARRunner({
    renderer,
    scene,
    controls,
    getPosition: () => POSITION,
    headingOfXrForward: () => heading,
    onChange,
    requestSession: async () => session as unknown as XRSession,
  });
  return { session, renderer, scene, layer, controls, onChange, runner };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('ARRunner', () => {
  it('opens a floor-anchored session over a clear background', async () => {
    const { runner, renderer, scene, onChange } = setUp();
    await runner.start();
    expect(runner.isActive()).toBe(true);
    expect(renderer.xr.enabled).toBe(true);
    expect(renderer.xr.setReferenceSpaceType).toHaveBeenCalledWith('local-floor');
    expect(scene.background).toBeNull();
    expect(renderer.getClearAlpha()).toBe(0);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(document.querySelector('.ar-status')).not.toBeNull();
  });

  it('places the portal on a tap at the floor, and masks the layers to it', async () => {
    const { runner, session, layer } = setUp();
    await runner.start();
    const camera = new THREE.PerspectiveCamera();
    const floor = new THREE.Vector3(0.3, 0, -1.2);

    // A tap before the floor is found does nothing.
    runner.update(frameWithHit(null), camera);
    session.dispatchEvent(new Event('select'));
    expect(runner.isPlaced()).toBe(false);

    runner.update(frameWithHit(floor), camera);
    expect(document.querySelector('.ar-status')!.textContent).toContain('Tap');
    session.dispatchEvent(new Event('select'));
    expect(runner.isPlaced()).toBe(true);

    runner.update(frameWithHit(floor), camera);
    expect(layer.stencilWrite).toBe(true);
    // The camera the layers see stands 1.4 m over the ground, in the Earth frame.
    expect(camera.position.length() - EARTH_RADIUS_M).toBeCloseTo(1.4, 3);
    expect(camera.fov).toBeCloseTo(70, 9);
    expect(camera.aspect).toBeCloseTo(0.5, 9);
  });

  it('says so when north is unknown', async () => {
    const { runner, session } = setUp(null);
    await runner.start();
    const camera = new THREE.PerspectiveCamera();
    runner.update(frameWithHit(new THREE.Vector3(0, 0, -1)), camera);
    session.dispatchEvent(new Event('select'));
    runner.update(frameWithHit(null), camera);
    expect(document.querySelector('.ar-status')!.textContent).toContain('north unknown');
  });

  it('puts everything back when the session ends', async () => {
    const { runner, session, renderer, scene, layer, onChange } = setUp();
    await runner.start();
    const camera = new THREE.PerspectiveCamera();
    runner.update(frameWithHit(new THREE.Vector3(0, 0, -1)), camera);
    session.dispatchEvent(new Event('select'));
    runner.update(frameWithHit(null), camera);

    await runner.stop();
    expect(session.end).toHaveBeenCalled();
    expect(runner.isActive()).toBe(false);
    expect(runner.isPlaced()).toBe(false);
    expect(layer.stencilWrite).toBe(false);
    expect((scene.background as THREE.Color).getHex()).toBe(0x050510);
    expect(renderer.getClearAlpha()).toBe(1);
    expect(renderer.xr.enabled).toBe(false);
    expect(session.hitSource.cancel).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('reports a refused camera on the button', async () => {
    vi.stubGlobal('navigator', { xr: { isSessionSupported: async () => true } });
    const parent = document.createElement('div');
    const controls = new ARControls(parent, vi.fn(), vi.fn());
    const runner = new ARRunner({
      renderer: fakeRenderer(),
      scene: new THREE.Scene(),
      controls,
      getPosition: () => POSITION,
      headingOfXrForward: () => 0,
      onChange: vi.fn(),
      requestSession: async () => {
        throw new DOMException('denied', 'NotAllowedError');
      },
    });
    await runner.start();
    expect(runner.isActive()).toBe(false);
    expect(parent.querySelector('#ar-toggle')!.textContent).toBe('AR needs the camera');
  });
});
