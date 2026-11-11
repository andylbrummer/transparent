/**
 * An immersive-ar session from button to exit: the floor found by hit
 * testing, the portal placed with a tap, and every frame the camera the
 * layers draw with set from the device's pose.
 *
 * The layers are not told about AR. They draw for `camera` as always; in
 * AR that camera is a copy of the XR viewer's pose in the Earth frame,
 * projection included, so they need no second code path.
 */

import * as THREE from 'three';
import type { SurfacePosition } from '../../sensors';
import type { ARControls } from '../../ui/ar-controls';
import { AR_SESSION_INIT, createARController, type ARController } from './index';
import { earthFromXr } from './frame';
import { ARPortal, StencilMask } from './portal';

const RAD2DEG = 180 / Math.PI;

/** What the runner needs of the renderer: its XR manager, and the clear colour it puts back. */
export type ARRenderer = Pick<THREE.WebGLRenderer, 'xr' | 'getClearColor' | 'getClearAlpha' | 'setClearColor'>;

export interface ARRunnerOptions {
  renderer: ARRenderer;
  scene: THREE.Scene;
  controls: ARControls;
  getPosition(): SurfacePosition | null;
  /** Compass heading of XR -Z, degrees, from the device's orientation in XR space; null when north is unknown. */
  headingOfXrForward(xrQuaternion: THREE.Quaternion, position: SurfacePosition): number | null;
  /** Told when AR starts and ends. */
  onChange(active: boolean): void;
  /** Stands in for navigator.xr in tests. */
  requestSession?: (init: XRSessionInit) => Promise<XRSession>;
}

export class ARRunner {
  private readonly portal = new ARPortal();
  private readonly mask = new StencilMask();
  private readonly hit = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly savedClear = new THREE.Color();
  private savedClearAlpha = 1;
  private savedBackground: THREE.Scene['background'] = null;
  private controller: ARController | null = null;
  private session: XRSession | null = null;
  private hitSource: XRHitTestSource | null = null;
  private hasHit = false;
  private northKnown = true;

  constructor(private readonly options: ARRunnerOptions) {
    options.scene.add(this.portal.origin);
  }

  isActive(): boolean {
    return this.session !== null;
  }

  isPlaced(): boolean {
    return this.portal.isPlaced();
  }

  /** The camera to hand renderer.render while AR runs. */
  get renderCamera(): THREE.PerspectiveCamera {
    return this.portal.camera;
  }

  /** Ask for the session: call from the button's click, which the browser requires. */
  async start(): Promise<void> {
    if (this.session || this.controller) return;
    const { controls } = this.options;
    const init: XRSessionInit = {
      ...AR_SESSION_INIT,
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: controls.overlay },
    };
    // The controller keeps its session to itself; this is where it lands.
    const opened: { session: XRSession | null } = { session: null };
    const controller = createARController(async () => {
      const request = this.options.requestSession ?? ((i: XRSessionInit) => navigator.xr!.requestSession('immersive-ar', i));
      opened.session = await request(init);
      return opened.session;
    });
    this.controller = controller;
    try {
      await controller.start();
    } catch (error) {
      this.controller = null;
      throw error;
    }
    const phase = controller.getState().phase;
    if (phase !== 'scanning' || !opened.session) {
      this.controller = null;
      controls.setRefusal(phase === 'permission_denied' ? 'AR needs the camera' : 'AR is not available here');
      return;
    }
    await this.begin(opened.session);
  }

  /** Leave AR; the session's end event puts everything back. */
  async stop(): Promise<void> {
    await this.controller?.stop();
  }

  private async begin(session: XRSession): Promise<void> {
    const { renderer, scene, controls } = this.options;
    this.session = session;
    session.addEventListener('end', this.onEnd);
    session.addEventListener('select', this.onSelect);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    await renderer.xr.setSession(session);
    const viewer = await session.requestReferenceSpace('viewer');
    this.hitSource = (await session.requestHitTestSource?.({ space: viewer })) ?? null;

    // The camera feed is the background: clear to nothing.
    this.savedBackground = scene.background;
    scene.background = null;
    renderer.getClearColor(this.savedClear);
    this.savedClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);

    this.portal.reset();
    controls.setActive(true);
    this.options.onChange(true);
  }

  private readonly onSelect = (): void => {
    const position = this.options.getPosition();
    if (!this.controller || this.portal.isPlaced() || !this.hasHit || !position) return;
    // The phone's orientation in XR space: three.js sets the camera's local pose from the viewer's.
    const heading = this.options.headingOfXrForward(this.portal.camera.quaternion, position);
    this.northKnown = heading !== null;
    this.portal.place(this.hit, earthFromXr(this.hit, heading ?? 0, position.lat, position.lon));
    this.controller.onTap(this.hit);
  };

  private readonly onEnd = (): void => {
    const { renderer, scene, controls } = this.options;
    const session = this.session;
    session?.removeEventListener('end', this.onEnd);
    session?.removeEventListener('select', this.onSelect);
    this.hitSource?.cancel();
    this.hitSource = null;
    this.session = null;
    this.controller = null;
    this.hasHit = false;
    this.mask.restore();
    this.portal.reset();
    scene.background = this.savedBackground;
    renderer.setClearColor(this.savedClear, this.savedClearAlpha);
    renderer.xr.enabled = false;
    controls.setActive(false);
    this.options.onChange(false);
  };

  /**
   * Per frame, before the layers update: find the floor, keep new layers
   * masked to the portal, and point `camera` where the device is.
   */
  update(frame: XRFrame | undefined, camera: THREE.PerspectiveCamera): void {
    const { renderer, scene, controls } = this.options;
    if (!this.session || !this.controller) return;
    const space = renderer.xr.getReferenceSpace();
    if (frame && space && this.hitSource && !this.portal.isPlaced()) {
      const pose = frame.getHitTestResults(this.hitSource)[0]?.getPose(space);
      this.hasHit = pose !== undefined;
      if (pose) this.hit.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
      this.controller.onFloorHit(this.hasHit ? this.hit : null);
      this.portal.showReticle(this.hasHit ? this.hit : null);
    }
    // Layers load at any time: each new material is masked the frame it appears.
    if (this.portal.isPlaced()) this.mask.apply(scene, this.portal.ownObjects);

    this.portal.origin.updateMatrixWorld(true);
    renderer.xr.updateCamera(this.portal.camera);
    const viewer = renderer.xr.getCamera();
    viewer.matrixWorld.decompose(camera.position, camera.quaternion, this.scale);
    camera.projectionMatrix.copy(viewer.projectionMatrix);
    camera.projectionMatrixInverse.copy(viewer.projectionMatrixInverse);
    const p = camera.projectionMatrix.elements;
    // For the layers that size things by field of view; never updateProjectionMatrix() while in AR.
    camera.fov = 2 * Math.atan(1 / p[5]) * RAD2DEG;
    camera.aspect = p[5] / p[0];
    camera.updateMatrixWorld(true);

    controls.setStatus(this.statusText());
  }

  private statusText(): string {
    const phase = this.controller?.getState().phase;
    if (phase === 'placed') {
      return this.northKnown ? 'Looking down through the Earth' : 'Looking down through the Earth · north unknown, no compass';
    }
    if (phase === 'placing') return 'Tap to open a window in the floor';
    return 'Point the phone at the floor and move it slowly';
  }

  dispose(): void {
    void this.stop();
    this.portal.dispose();
  }
}
