import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M, enuBasis } from '@transparent-earth/core';
import { createLookController } from '../input/look';
import { StereoRig } from './stereo';
import { LabelLayer, MAX_VISIBLE_LABELS, estimateLabelSize, labelText, rankLabels, type PlaceLabel } from './labels';

const WIDTH = 400;
const HEIGHT = 800;

/** A camera at Austin aimed at (lon, lat), as the look controller would place it. */
function cameraAimedAt(lon: number, lat: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 1e9);
  const austin = enuBasis({ lat: 30.27, lon: -97.74, alt: 0 }).u;
  camera.position.set(austin.x, austin.y, austin.z).multiplyScalar(EARTH_RADIUS_M + 1.5);
  const target = enuBasis({ lat, lon, alt: 0 }).u;
  camera.up.set(austin.x, austin.y, austin.z);
  camera.lookAt(new THREE.Vector3(target.x, target.y, target.z).multiplyScalar(EARTH_RADIUS_M));
  return camera;
}

function label(name: string, lon: number, lat: number, priority: number, kind: PlaceLabel['kind'] = 'state'): PlaceLabel {
  return { kind, name, lon, lat, priority };
}

describe('LabelLayer', () => {
  it('hides whole kinds while they are switched off', () => {
    const parent = document.createElement('div');
    const layer = new LabelLayer(parent, [
      { labels: [label('California', -119.5, 37.0, 1), label('Lassen Peak', -121.5, 40.5, 1, 'volcano')] },
    ]);
    const camera = cameraAimedAt(-120.5, 38.5);
    layer.setKindsVisible(['volcano'], false);
    layer.update(camera, WIDTH, HEIGHT);
    expect(layer.visibleNames()).toEqual(['California']);
    layer.setKindsVisible(['volcano'], true);
    layer.update(camera, WIDTH, HEIGHT);
    expect(layer.visibleNames()).toEqual(['California', 'Lassen Peak']);
    layer.dispose();
  });

  it('shows a place the camera points at and hides one behind it', () => {
    const parent = document.createElement('div');
    const layer = new LabelLayer(parent, [
      { labels: [label('California', -119.5, 37.0, 1), label('Western Australia', 121.6, -25.8, 2)] },
    ]);
    // Western Australia is almost straight down from Austin: behind a camera aimed west at California.
    layer.update(cameraAimedAt(-119.5, 37.0), WIDTH, HEIGHT);

    expect(layer.visibleNames()).toEqual(['California']);
    layer.dispose();
  });

  it('keeps the higher-priority label where two collide', () => {
    const parent = document.createElement('div');
    const layer = new LabelLayer(parent, [
      { labels: [label('California', -119.5, 37.0, 1), label('Fresno', -119.6, 37.0, 5, 'city')] },
    ]);
    layer.update(cameraAimedAt(-119.5, 37.0), WIDTH, HEIGHT);

    expect(layer.visibleNames()).toEqual(['California']);
    layer.dispose();
  });

  it('caps how many labels it shows in a frame', () => {
    const parent = document.createElement('div');
    // A grid around the aim point, spaced far apart on screen.
    const labels: PlaceLabel[] = [];
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) labels.push(label(`p${i}-${j}`, -125 + i, 32 + j * 0.6, i * 12 + j));
    const layer = new LabelLayer(parent, [{ labels }]);
    const camera = cameraAimedAt(-119.5, 37.0);
    camera.fov = 2; // magnify, so the grid spreads out across the viewport
    camera.updateProjectionMatrix();
    layer.update(camera, WIDTH * 10, HEIGHT * 10);

    expect(layer.visibleNames().length).toBeLessThanOrEqual(MAX_VISIBLE_LABELS);
    expect(layer.visibleNames().length).toBeGreaterThan(0);
    layer.dispose();
  });

  it('positions a shown label at its projected screen point', () => {
    const parent = document.createElement('div');
    const layer = new LabelLayer(parent, [{ labels: [label('California', -119.5, 37.0, 1)] }]);
    layer.update(cameraAimedAt(-119.5, 37.0), WIDTH, HEIGHT);

    const element = parent.querySelector('.place-label') as HTMLElement;
    expect(element.style.display).toBe('');
    expect(element.style.transform).toBe('translate(200.0px, 400.0px) translate(-50%, -50%)');
    layer.dispose();
  });

  it('ranks every source together: a volcano from one file loses to a state from another', () => {
    const parent = document.createElement('div');
    const layer = new LabelLayer(parent, [
      { labels: [label('Lassen Peak', -119.5, 37.0, 1, 'volcano')] },
      { labels: [label('California', -119.5, 37.0, 9)] },
    ]);
    layer.update(cameraAimedAt(-119.5, 37.0), WIDTH, HEIGHT);

    expect(layer.visibleNames()).toEqual(['California']);
    layer.dispose();
  });

  it('places a deep structure at its depth, not on the surface', () => {
    const parent = document.createElement('div');
    // Straight down from Austin is through the core; a label 1500 km under
    // Austin itself sits dead centre of that view, while one on the surface
    // there would be behind the camera.
    const deep: PlaceLabel = { ...label('Farallon slab', -97.74, 30.27, 1, 'deep'), depthKm: 1500 };
    const layer = new LabelLayer(parent, [{ labels: [deep] }]);
    // The look controller's default view: straight down from Austin.
    const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 1e9);
    createLookController().updateCamera(camera, { lat: 30.27, lon: -97.74 }, null, 0);
    layer.update(camera, WIDTH, HEIGHT);

    expect(layer.visibleNames()).toEqual(['Farallon slab']);
    const element = parent.querySelector('.place-label') as HTMLElement;
    expect(element.textContent).toBe('Farallon slab · 1500 km');
    expect(element.style.transform).toBe('translate(200.0px, 400.0px) translate(-50%, -50%)');
    layer.dispose();
  });

  it('in stereo, shows each name to both eyes with the disparity of its depth', () => {
    const parent = document.createElement('div');
    const layer = new LabelLayer(parent, [{ labels: [label('California', -119.5, 37.0, 1)] }]);
    layer.setStereo(true);
    const rig = new StereoRig();
    const eyeWidth = WIDTH / 2;
    rig.update(cameraAimedAt(-119.5, 37.0), eyeWidth, HEIGHT);
    layer.update(rig.left, eyeWidth, HEIGHT, rig.right);

    const x = (selector: string): number => {
      const element = parent.querySelector(`${selector} .place-label`) as HTMLElement;
      expect(element.style.display).toBe('');
      return Number(/translate\(([-\d.]+)px/.exec(element.style.transform)?.[1]);
    };
    // ~2000 km away, nearer than where the eyes converge: the left eye sees
    // it right of centre and the right eye left of it, so it floats forward.
    expect(x('.place-labels--left-eye')).toBeGreaterThan(eyeWidth / 2);
    expect(x('.place-labels--right-eye')).toBeLessThan(eyeWidth / 2);

    layer.setStereo(false);
    expect((parent.querySelector('.place-labels--right-eye') as HTMLElement).style.display).toBe('none');
    expect(parent.querySelector('.place-labels--left-eye')).toBeNull();
    layer.dispose();
    expect(parent.children.length).toBe(0);
  });
});

describe('rankLabels', () => {
  it('orders by kind, then priority, keeping source order for ties', () => {
    const ranked = rankLabels([
      label('Fuji', 0, 0, 2, 'volcano'),
      label('Etna', 0, 0, 1, 'volcano'),
      label('Pacific plate', 0, 0, 5, 'plate'),
      label('Hawaii', 0, 0, 1, 'hotspot'),
      label('Iceland', 0, 0, 1, 'hotspot'),
    ]);
    expect(ranked.map((l) => l.name)).toEqual(['Pacific plate', 'Hawaii', 'Iceland', 'Etna', 'Fuji']);
  });
});

describe('estimateLabelSize', () => {
  it('sizes letter-spaced country names wider than states of the same length', () => {
    const country = estimateLabelSize(label('Mexico', 0, 0, 1, 'country'));
    const state = estimateLabelSize(label('Mexico', 0, 0, 1, 'state'));
    expect(country.width).toBeGreaterThan(state.width);
  });
});

describe('labelText', () => {
  it('gives great quakes their hypocentre depth', () => {
    expect(labelText({ kind: 'quake', name: 'M9.1 Japan 2011', lon: 142.4, lat: 38.3, priority: 0.9, depthKm: 29 })).toBe(
      'M9.1 Japan 2011 · 29 km'
    );
  });
});
