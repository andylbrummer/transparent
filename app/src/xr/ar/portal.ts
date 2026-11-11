/**
 * The window in the floor: what is drawn in the room, and the mask that
 * keeps the Earth inside it.
 *
 * Everything hangs off `origin`, a group whose matrix takes XR coordinates
 * to the Earth frame (see frame.ts) - the AR camera too, so three.js gives
 * the camera an Earth-frame pose and the layers draw unchanged.
 *
 * The mask: the portal disc is drawn first, invisibly, writing 1 into the
 * stencil buffer; every other material is set to draw only where the
 * stencil is 1. A depth occluder would not do: many interior layers draw
 * with depthTest off, so that they show through the Earth, and would
 * spill onto the room's floor.
 */

import * as THREE from 'three';

/** Half a metre: a window a person can stand at the edge of. */
export const PORTAL_RADIUS_M = 0.5;

const PORTAL_STENCIL = 1;

interface SavedStencil {
  readonly stencilWrite: boolean;
  readonly stencilFunc: THREE.StencilFunc;
  readonly stencilRef: number;
  readonly stencilFuncMask: number;
  readonly stencilWriteMask: number;
  readonly stencilFail: THREE.StencilOp;
  readonly stencilZFail: THREE.StencilOp;
  readonly stencilZPass: THREE.StencilOp;
}

/** Sets materials to draw only inside the portal, and puts them back. */
export class StencilMask {
  private readonly saved = new Map<THREE.Material, SavedStencil>();

  /** Mask every material under `root` not already masked, except those of `skip`'s objects. Cheap when nothing is new. */
  apply(root: THREE.Object3D, skip: ReadonlySet<THREE.Object3D>): void {
    root.traverse((object) => {
      if (skip.has(object)) return;
      const material = (object as THREE.Mesh).material;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        if (this.saved.has(m)) continue;
        this.saved.set(m, {
          stencilWrite: m.stencilWrite,
          stencilFunc: m.stencilFunc,
          stencilRef: m.stencilRef,
          stencilFuncMask: m.stencilFuncMask,
          stencilWriteMask: m.stencilWriteMask,
          stencilFail: m.stencilFail,
          stencilZFail: m.stencilZFail,
          stencilZPass: m.stencilZPass,
        });
        // In three.js stencilWrite is what turns the stencil test on; nothing is written (Keep).
        m.stencilWrite = true;
        m.stencilFunc = THREE.EqualStencilFunc;
        m.stencilRef = PORTAL_STENCIL;
        m.stencilFuncMask = 0xff;
        m.stencilWriteMask = 0x00;
        m.stencilFail = THREE.KeepStencilOp;
        m.stencilZFail = THREE.KeepStencilOp;
        m.stencilZPass = THREE.KeepStencilOp;
      }
    });
  }

  /** Every masked material as it was. */
  restore(): void {
    for (const [m, s] of this.saved) Object.assign(m, s);
    this.saved.clear();
  }

  get size(): number {
    return this.saved.size;
  }
}

function flatRing(inner: number, outer: number, segments = 64): THREE.RingGeometry {
  const geometry = new THREE.RingGeometry(inner, outer, segments);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export class ARPortal {
  /** XR space; its matrix is set to Earth-from-XR once the portal is placed. */
  readonly origin = new THREE.Group();
  /** The camera three.js poses from the XR viewer, under `origin`. */
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1e9);
  /** The portal's own objects: drawn in the room, never masked. */
  readonly ownObjects: ReadonlySet<THREE.Object3D>;
  private readonly reticle: THREE.Mesh;
  private readonly mask: THREE.Mesh;
  private readonly rim: THREE.Mesh;
  private placed = false;

  constructor() {
    this.origin.name = 'ar-origin';
    this.origin.matrixAutoUpdate = false;
    this.camera.name = 'ar-camera';

    this.reticle = new THREE.Mesh(
      flatRing(PORTAL_RADIUS_M * 0.85, PORTAL_RADIUS_M),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false })
    );
    this.reticle.name = 'ar-reticle';
    this.reticle.renderOrder = 1e9;

    const discGeometry = new THREE.CircleGeometry(PORTAL_RADIUS_M, 64);
    discGeometry.rotateX(-Math.PI / 2);
    this.mask = new THREE.Mesh(
      discGeometry,
      new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        stencilWrite: true,
        stencilRef: PORTAL_STENCIL,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilZPass: THREE.ReplaceStencilOp,
      })
    );
    this.mask.name = 'ar-portal-mask';
    // Opaque and first of all: the stencil must be written before anything tests it.
    this.mask.renderOrder = -1e9;

    this.rim = new THREE.Mesh(
      flatRing(PORTAL_RADIUS_M, PORTAL_RADIUS_M + 0.025),
      new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false })
    );
    this.rim.name = 'ar-portal-rim';
    this.rim.renderOrder = 1e9;

    for (const object of [this.reticle, this.mask, this.rim]) {
      object.visible = false;
      object.frustumCulled = false;
      this.origin.add(object);
    }
    this.origin.add(this.camera);
    this.ownObjects = new Set([this.reticle, this.mask, this.rim, this.camera]);
  }

  isPlaced(): boolean {
    return this.placed;
  }

  /** Where hit-testing finds the floor this frame (XR coordinates), or null. */
  showReticle(position: THREE.Vector3 | null): void {
    this.reticle.visible = position !== null && !this.placed;
    if (position) this.reticle.position.copy(position);
  }

  /** Open the window at `position` (XR), with `earthFromXr` (frame.ts) placing the room on the Earth. */
  place(position: THREE.Vector3, earthFromXr: THREE.Matrix4): void {
    this.placed = true;
    this.origin.matrix.copy(earthFromXr);
    this.origin.matrixWorldNeedsUpdate = true;
    this.mask.position.copy(position);
    this.rim.position.copy(position);
    this.mask.visible = true;
    this.rim.visible = true;
    this.reticle.visible = false;
  }

  /** Back to scanning, the room unplaced. */
  reset(): void {
    this.placed = false;
    this.origin.matrix.identity();
    this.origin.matrixWorldNeedsUpdate = true;
    this.mask.visible = false;
    this.rim.visible = false;
    this.reticle.visible = false;
  }

  dispose(): void {
    this.origin.removeFromParent();
    for (const mesh of [this.reticle, this.mask, this.rim]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
