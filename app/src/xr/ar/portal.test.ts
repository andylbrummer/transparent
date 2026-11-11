import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ARPortal, StencilMask } from './portal';

describe('StencilMask', () => {
  it('limits every other material to the portal, and puts each back', () => {
    const scene = new THREE.Scene();
    const shared = new THREE.MeshBasicMaterial();
    const lines = new THREE.LineBasicMaterial({ depthTest: false });
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), shared), new THREE.Mesh(new THREE.BufferGeometry(), shared));
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry(), lines));
    const portal = new ARPortal();
    scene.add(portal.origin);

    const mask = new StencilMask();
    mask.apply(scene, portal.ownObjects);
    expect(mask.size).toBe(2);
    for (const m of [shared, lines]) {
      expect(m.stencilWrite).toBe(true);
      expect(m.stencilFunc).toBe(THREE.EqualStencilFunc);
      expect(m.stencilRef).toBe(1);
      expect(m.stencilZPass).toBe(THREE.KeepStencilOp);
    }

    // A layer that loads later is masked on the next pass; the first ones are not saved twice.
    const late = new THREE.PointsMaterial();
    scene.add(new THREE.Points(new THREE.BufferGeometry(), late));
    mask.apply(scene, portal.ownObjects);
    expect(mask.size).toBe(3);
    expect(late.stencilWrite).toBe(true);

    mask.restore();
    for (const m of [shared, lines, late]) {
      expect(m.stencilWrite).toBe(false);
      expect(m.stencilFunc).toBe(THREE.AlwaysStencilFunc);
    }
    expect(mask.size).toBe(0);
  });

  it('leaves the portal objects alone: the mask disc writes the stencil the rest test', () => {
    const portal = new ARPortal();
    const mask = new StencilMask();
    mask.apply(portal.origin, portal.ownObjects);
    expect(mask.size).toBe(0);
    const disc = portal.origin.getObjectByName('ar-portal-mask') as THREE.Mesh;
    const material = disc.material as THREE.Material;
    expect(material.stencilFunc).toBe(THREE.AlwaysStencilFunc);
    expect(material.stencilZPass).toBe(THREE.ReplaceStencilOp);
    expect(material.colorWrite).toBe(false);
    expect(disc.renderOrder).toBeLessThan(-1e6);
  });
});

describe('ARPortal', () => {
  it('shows the reticle while scanning and the window once placed', () => {
    const portal = new ARPortal();
    const named = (name: string) => portal.origin.getObjectByName(name) as THREE.Object3D;
    portal.showReticle(new THREE.Vector3(0, 0, -1));
    expect(named('ar-reticle').visible).toBe(true);
    portal.showReticle(null);
    expect(named('ar-reticle').visible).toBe(false);

    const m = new THREE.Matrix4().makeTranslation(1, 2, 3);
    portal.place(new THREE.Vector3(0.2, 0, -1), m);
    expect(portal.isPlaced()).toBe(true);
    expect(portal.origin.matrix.equals(m)).toBe(true);
    expect(named('ar-portal-mask').visible).toBe(true);
    expect(named('ar-portal-mask').position.z).toBe(-1);
    portal.showReticle(new THREE.Vector3());
    expect(named('ar-reticle').visible).toBe(false);

    portal.reset();
    expect(portal.isPlaced()).toBe(false);
    expect(portal.origin.matrix.equals(new THREE.Matrix4())).toBe(true);
    expect(named('ar-portal-mask').visible).toBe(false);
  });

  it('hangs the AR camera off the origin, so three.js poses it in the Earth frame', () => {
    const portal = new ARPortal();
    expect(portal.camera.parent).toBe(portal.origin);
    expect(portal.origin.matrixAutoUpdate).toBe(false);
  });
});
