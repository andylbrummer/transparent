import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { StereoRig } from '../render/stereo';
import { ClipScenePanelMesh } from './clip-scene-panel';

/** A <video> whose readyState the test sets: jsdom's never leaves HAVE_NOTHING. */
function video(): HTMLVideoElement & { ready: number } {
  const element = document.createElement('video') as HTMLVideoElement & { ready: number };
  element.ready = HTMLMediaElement.HAVE_NOTHING;
  Object.defineProperty(element, 'readyState', { get: () => element.ready });
  return element;
}

function setup() {
  const scene = new THREE.Scene();
  const panel = new ClipScenePanelMesh(scene);
  const mesh = scene.getObjectByName('clip-panel') as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 6371000, 0);
  return { panel, mesh, camera };
}

describe('the clip panel in the scene, with a film', () => {
  it("draws the element's frames once it has one, at the film's shape, along where it opened", () => {
    const t = setup();
    const film = video();
    t.panel.showVideo(film, 16 / 9, new THREE.Vector3(1, 0, 0));
    t.panel.update(t.camera);
    // No frame yet: a black square would stand where the film is about to be.
    expect(t.mesh.visible).toBe(false);
    film.ready = HTMLMediaElement.HAVE_CURRENT_DATA;
    t.panel.update(t.camera);
    expect(t.mesh.visible).toBe(true);
    const map = t.mesh.material.map as THREE.VideoTexture;
    expect(map.isVideoTexture && map.image === film).toBe(true);
    expect(map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(t.mesh.scale.x / t.mesh.scale.y).toBeCloseTo(16 / 9);
  });

  it('lands in the same place in both eyes, CLIP_PANEL_DEG wide, however far apart the eyes are set', () => {
    const t = setup();
    const film = video();
    film.ready = HTMLMediaElement.HAVE_CURRENT_DATA;
    // Looking along the panel's direction: east, from a point on the equator.
    t.camera.position.set(6371000, 0, 0);
    t.camera.up.set(1, 0, 0);
    t.camera.lookAt(6371000, 0, -1);
    t.camera.updateMatrixWorld();
    t.panel.showVideo(film, 16 / 9, new THREE.Vector3(0, 0, -1));
    t.panel.update(t.camera);
    t.mesh.updateMatrixWorld();
    const rig = new StereoRig();
    rig.update(t.camera, 400, 400, 200);
    const corner = new THREE.Vector3(0.5, 0, 0).applyMatrix4(t.mesh.matrixWorld);
    const centre = t.mesh.position.clone();
    const [left, right] = [rig.left, rig.right].map((eye) => [centre.clone().project(eye).x, corner.clone().project(eye).x]);
    // Both eyes see the middle of the panel at their convergence spot (spacing 200 of 400 px: x = ±0.5 NDC, mirrored)...
    expect(left[0]).toBeCloseTo(0.5, 2);
    expect(right[0]).toBeCloseTo(-0.5, 2);
    // ...and the panel the same width in each, in view.
    expect(left[1] - left[0]).toBeCloseTo(right[1] - right[0], 3);
    expect(Math.abs(left[1] - left[0])).toBeGreaterThan(0.2);
    // Upright and not mirrored for a viewer whose head is up: the picture's right to the right, its top up.
    expect(left[1]).toBeGreaterThan(left[0]);
    const top = new THREE.Vector3(0, 0.5, 0).applyMatrix4(t.mesh.matrixWorld).project(rig.left);
    expect(top.y).toBeGreaterThan(centre.clone().project(rig.left).y + 0.1);
  });

  it('keeps one texture for the one element across shows, and lets it go only when disposed', () => {
    const t = setup();
    const film = video();
    film.ready = HTMLMediaElement.HAVE_ENOUGH_DATA;
    t.panel.showVideo(film, 16 / 9, new THREE.Vector3(1, 0, 0));
    const first = t.mesh.material.map!;
    let disposed = 0;
    first.addEventListener('dispose', () => void disposed++);
    t.panel.hide();
    expect(t.mesh.visible).toBe(false);
    expect(t.mesh.material.map).toBeNull();
    t.panel.showVideo(film, 4 / 3, new THREE.Vector3(0, 0, 1));
    t.panel.update(t.camera);
    expect(t.mesh.material.map).toBe(first);
    expect(t.mesh.visible).toBe(true);
    expect(disposed).toBe(0);
    t.panel.dispose();
    expect(disposed).toBe(1);
  });

  it('stays down when hidden before the first frame comes', () => {
    const t = setup();
    const film = video();
    t.panel.showVideo(film, 16 / 9, new THREE.Vector3(1, 0, 0));
    t.panel.hide();
    film.ready = HTMLMediaElement.HAVE_CURRENT_DATA;
    t.panel.update(t.camera);
    expect(t.mesh.visible).toBe(false);
  });
});
