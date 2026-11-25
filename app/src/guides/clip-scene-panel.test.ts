import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
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
    expect(t.mesh.position.x - t.camera.position.x).toBeCloseTo(100);
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
