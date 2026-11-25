/**
 * A clip's image in Cardboard (spec/guides.md §8.4): a flat panel in the scene, CLIP_PANEL_DEG wide, along the
 * direction its marker had when the clip opened. It is held there in the local frame, beside the viewer, so it stays
 * put as the head turns, as the spyglass's window does, and a time-lapse does not carry it off with the sky.
 *
 * Both eyes draw it, being in the scene: one image, no per-eye copy. It is near, PANEL_DISTANCE_M, but the eyes'
 * separation is a few centimetres, so it sits as good as at infinity, where the markers and the names are.
 */

import * as THREE from 'three';
import { RENDER_ORDER } from '../render/order';
import type { ClipScenePanel } from './clip-player';

export const CLIP_PANEL_DEG = 40;
const PANEL_DISTANCE_M = 100;
const PANEL_WIDTH_M = 2 * PANEL_DISTANCE_M * Math.tan(THREE.MathUtils.degToRad(CLIP_PANEL_DEG / 2));

export class ClipScenePanelMesh implements ClipScenePanel {
  private readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly direction = new THREE.Vector3();
  private readonly loader = new THREE.TextureLoader();
  /** Every show is numbered: an image that arrives after a hide or another show is dropped. */
  private shows = 0;

  constructor(parent: THREE.Object3D) {
    // Nothing in the scene depth-tests (render/order.ts): the order alone puts it over the view.
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.renderOrder = RENDER_ORDER.clipPanel;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'clip-panel';
    parent.add(this.mesh);
  }

  showImage(url: string, direction: THREE.Vector3): void {
    const thisShow = ++this.shows;
    this.direction.copy(direction);
    this.loader.load(url, (texture) => {
      if (thisShow !== this.shows) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      this.setTexture(texture);
      const image = texture.image as { width: number; height: number };
      this.mesh.scale.set(PANEL_WIDTH_M, (PANEL_WIDTH_M * image.height) / image.width, 1);
      this.mesh.visible = true;
    });
  }

  hide(): void {
    this.shows++;
    this.mesh.visible = false;
    this.setTexture(null);
  }

  /** Once a frame: hung from where the viewer stands now, facing them, its top toward their zenith. */
  update(camera: THREE.Camera): void {
    if (!this.mesh.visible) return;
    this.mesh.position.copy(camera.position).addScaledVector(this.direction, PANEL_DISTANCE_M);
    this.mesh.up.copy(camera.position).normalize();
    this.mesh.lookAt(camera.position);
  }

  dispose(): void {
    this.hide();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  private setTexture(texture: THREE.Texture | null): void {
    this.mesh.material.map?.dispose();
    this.mesh.material.map = texture;
    this.mesh.material.needsUpdate = true;
  }
}
