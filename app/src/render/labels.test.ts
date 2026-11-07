import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M, enuBasis } from '@transparent-earth/core';
import { LabelLayer, MAX_VISIBLE_LABELS, estimateLabelSize, type PlaceLabel } from './labels';

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
  it('shows a place the camera points at and hides one behind it', () => {
    const parent = document.createElement('div');
    const layer = new LabelLayer(parent, {
      labels: [label('California', -119.5, 37.0, 1), label('Western Australia', 121.6, -25.8, 2)],
    });
    // Western Australia is almost straight down from Austin: behind a camera aimed west at California.
    layer.update(cameraAimedAt(-119.5, 37.0), WIDTH, HEIGHT);

    expect(layer.visibleNames()).toEqual(['California']);
    layer.dispose();
  });

  it('keeps the higher-priority label where two collide', () => {
    const parent = document.createElement('div');
    const layer = new LabelLayer(parent, {
      labels: [label('California', -119.5, 37.0, 1), label('Fresno', -119.6, 37.0, 5, 'city')],
    });
    layer.update(cameraAimedAt(-119.5, 37.0), WIDTH, HEIGHT);

    expect(layer.visibleNames()).toEqual(['California']);
    layer.dispose();
  });

  it('caps how many labels it shows in a frame', () => {
    const parent = document.createElement('div');
    // A grid around the aim point, spaced far apart on screen.
    const labels: PlaceLabel[] = [];
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) labels.push(label(`p${i}-${j}`, -125 + i, 32 + j * 0.6, i * 12 + j));
    const layer = new LabelLayer(parent, { labels });
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
    const layer = new LabelLayer(parent, { labels: [label('California', -119.5, 37.0, 1)] });
    layer.update(cameraAimedAt(-119.5, 37.0), WIDTH, HEIGHT);

    const element = parent.querySelector('.place-label') as HTMLElement;
    expect(element.style.display).toBe('');
    expect(element.style.transform).toBe('translate(200.0px, 400.0px) translate(-50%, -50%)');
    layer.dispose();
  });
});

describe('estimateLabelSize', () => {
  it('sizes letter-spaced country names wider than states of the same length', () => {
    const country = estimateLabelSize(label('Mexico', 0, 0, 1, 'country'));
    const state = estimateLabelSize(label('Mexico', 0, 0, 1, 'state'));
    expect(country.width).toBeGreaterThan(state.width);
  });
});
