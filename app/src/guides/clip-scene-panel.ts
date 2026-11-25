/**
 * A clip's image or film in Cardboard (spec/guides.md §8.4): a flat panel in the scene, CLIP_PANEL_DEG wide, along the
 * direction its marker had when the clip opened. It is held there in the local frame, beside the viewer, so it stays
 * put as the head turns, as the spyglass's window does, and a time-lapse does not carry it off with the sky.
 *
 * Both eyes draw it, being in the scene: one image, no per-eye copy. The eyes are CARDBOARD_BASELINE_M apart
 * (render/stereo.ts), not a few centimetres, so a panel near the head would stand kilometres to the side of each
 * eye, out of both views. It hangs at CARDBOARD_CONVERGENCE_M instead, where the two eyes' views coincide: it lands
 * in the same place in both and sits at the screen, as the names do. Nothing depth-tests, so being under the
 * ground there does not hide it.
 *
 * A film is the page's own <video>, drawn as a texture: one decode, and its sound and the browser's state are the
 * element's. The texture is made once, for the one element, and kept; three.js marks it for upload on each frame the
 * video presents.
 */

import * as THREE from 'three';
import { RENDER_ORDER } from '../render/order';
import { CARDBOARD_CONVERGENCE_M } from '../render/stereo';
import type { ClipScenePanel } from './clip-player';

export const CLIP_PANEL_DEG = 40;
const PANEL_DISTANCE_M = CARDBOARD_CONVERGENCE_M;
const PANEL_WIDTH_M = 2 * PANEL_DISTANCE_M * Math.tan(THREE.MathUtils.degToRad(CLIP_PANEL_DEG / 2));

export class ClipScenePanelMesh implements ClipScenePanel {
  private readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly direction = new THREE.Vector3();
  private readonly loader = new THREE.TextureLoader();
  /** Every show is numbered: an image that arrives after a hide or another show is dropped. */
  private shows = 0;
  private videoTexture: THREE.VideoTexture | null = null;
  /** The film being shown, until its first frame is there: before it, the panel would be a black square. */
  private waitingFor: HTMLVideoElement | null = null;

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

  showVideo(video: HTMLVideoElement, aspect: number, direction: THREE.Vector3): void {
    this.shows++;
    this.direction.copy(direction);
    if (this.videoTexture?.image !== video) {
      this.videoTexture?.dispose();
      this.videoTexture = new THREE.VideoTexture(video);
      this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    }
    this.setTexture(this.videoTexture);
    this.mesh.scale.set(PANEL_WIDTH_M, PANEL_WIDTH_M / aspect, 1);
    this.waitingFor = video;
  }

  hide(): void {
    this.shows++;
    this.waitingFor = null;
    this.mesh.visible = false;
    this.setTexture(null);
  }

  /** Once a frame: hung from where the viewer stands now, facing them, its top toward their zenith. */
  update(camera: THREE.Camera): void {
    if (this.waitingFor !== null && this.waitingFor.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.waitingFor = null;
      this.mesh.visible = true;
    }
    if (!this.mesh.visible) return;
    this.mesh.position.copy(camera.position).addScaledVector(this.direction, PANEL_DISTANCE_M);
    this.mesh.up.copy(camera.position).normalize();
    this.mesh.lookAt(camera.position);
  }

  dispose(): void {
    this.hide();
    this.videoTexture?.dispose();
    this.videoTexture = null;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  private setTexture(texture: THREE.Texture | null): void {
    // The film's texture is kept for the next film: only an image's is let go.
    const old = this.mesh.material.map;
    if (old !== null && old !== this.videoTexture) old.dispose();
    this.mesh.material.map = texture;
    this.mesh.material.needsUpdate = true;
  }
}
