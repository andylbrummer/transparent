import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M, enuBasis } from '@transparent-earth/core';
import { createLookController } from '../input/look';
import { StereoRig } from './stereo';
import {
  LabelLayer,
  MAX_SKY_LABELS_THROUGH_EARTH,
  MAX_VISIBLE_LABELS,
  SKY_ZOOMED_FOV_DEG,
  estimateLabelSize,
  labelText,
  rankLabels,
  type PlaceLabel,
} from './labels';

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

describe('LabelLayer groups', () => {
  /** ECEF point on the surface at (lon, lat). */
  function surface(lon: number, lat: number): THREE.Vector3 {
    const u = enuBasis({ lat, lon, alt: 0 }).u;
    return new THREE.Vector3(u.x, u.y, u.z).multiplyScalar(EARTH_RADIUS_M);
  }
  const style = { fontPx: 10, color: '#fff' };

  it('ranks a group among the kinds and hides and removes it by its handle', () => {
    const parent = document.createElement('div');
    const layer = new LabelLayer(parent, [{ labels: [label('Fresno', -119.6, 37.0, 5, 'city')] }]);
    const camera = cameraAimedAt(-119.5, 37.0);
    // Rank 0.5 beats a city (rank 8) at the same spot.
    const group = layer.addGroup({
      rank: 0.5,
      style,
      frame: 'earth',
      labels: [{ text: 'ISS', priority: 0, position: surface(-119.5, 37.0) }],
    });
    layer.update(camera, WIDTH, HEIGHT);
    expect(layer.visibleNames()).toEqual(['ISS']);

    group.setVisible(false);
    layer.update(camera, WIDTH, HEIGHT);
    expect(layer.visibleNames()).toEqual(['Fresno']);

    group.setVisible(true);
    group.remove();
    layer.update(camera, WIDTH, HEIGHT);
    expect(layer.visibleNames()).toEqual(['Fresno']);
    expect(parent.querySelectorAll('.place-label')).toHaveLength(1);
    layer.dispose();
  });

  it('follows a label whose position the layer moves', () => {
    const parent = document.createElement('div');
    const layer = new LabelLayer(parent, []);
    const position = surface(121.6, -25.8);
    layer.addGroup({ rank: 1, style, frame: 'earth', labels: [{ text: 'Mover', priority: 0, position }] });
    const camera = cameraAimedAt(-119.5, 37.0);
    layer.update(camera, WIDTH, HEIGHT);
    expect(layer.visibleNames()).toEqual([]);
    position.copy(surface(-119.5, 37.0));
    layer.update(camera, WIDTH, HEIGHT);
    expect(layer.visibleNames()).toEqual(['Mover']);
    layer.dispose();
  });

  it('places a sky label along its direction turned by the sky rotation', () => {
    const parent = document.createElement('div');
    const layer = new LabelLayer(parent, []);
    // The ICRS pole, and a sky turned so that the pole lies where the camera looks.
    layer.addGroup({
      rank: 1,
      style,
      frame: 'sky',
      labels: [{ text: 'Pole', priority: 0, position: new THREE.Vector3(0, 0, 1) }],
    });
    const camera = cameraAimedAt(-119.5, 37.0);
    const lookDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const identity = new THREE.Matrix4();
    layer.update(camera, WIDTH, HEIGHT, undefined, identity);
    expect(layer.visibleNames()).toEqual([]);
    const turned = new THREE.Matrix4().makeRotationFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), lookDirection)
    );
    layer.update(camera, WIDTH, HEIGHT, undefined, turned);
    expect(layer.visibleNames()).toEqual(['Pole']);
    layer.dispose();
  });

  it('gives a group added in stereo its right-eye twins', () => {
    const parent = document.createElement('div');
    const layer = new LabelLayer(parent, []);
    layer.setStereo(true);
    layer.addGroup({ rank: 1, style, frame: 'earth', labels: [{ text: 'Twin', priority: 0, position: surface(0, 0) }] });
    expect(parent.querySelectorAll('.place-labels--right-eye .place-label')).toHaveLength(1);
    layer.dispose();
  });

  it('keeps a separate allowance for sky names when the ground fills its own', () => {
    const parent = document.createElement('div');
    const layer = new LabelLayer(parent, []);
    // A grid of ground points wide enough apart not to collide, all in view.
    const ground = [];
    for (let i = 0; i < 24; i++) {
      for (let j = 0; j < 24; j++) {
        ground.push({ text: 'g', priority: i * 24 + j, position: surface(-131 + i, 26 + j) });
      }
    }
    layer.addGroup({ rank: 1, style, frame: 'earth', labels: ground });
    const camera = cameraAimedAt(-119.5, 37.0);
    const lookDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    layer.addGroup({ rank: 9, style, frame: 'sky', labels: [{ text: 'Sun', priority: 0, position: lookDirection.clone() }] });
    layer.update(camera, 4000, 4000, undefined, new THREE.Matrix4());
    const names = layer.visibleNames();
    expect(names.filter((n) => n === 'g')).toHaveLength(MAX_VISIBLE_LABELS);
    expect(names).toContain('Sun');
    layer.dispose();
  });

  it('hangs a second name over the marker when the place under it is taken', () => {
    const parent = document.createElement('div');
    const layer = new LabelLayer(parent, []);
    const camera = cameraAimedAt(-119.5, 37.0);
    const at = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    // Above the horizon: turn the test's camera up at a point of the sky.
    const zenith = camera.position.clone().normalize();
    camera.lookAt(camera.position.clone().add(zenith));
    camera.updateMatrixWorld();
    at.copy(zenith);
    const marked = { ...style, offsetYPx: 11 };
    layer.addGroup({ rank: 6.3, style: marked, frame: 'sky', labels: [{ text: 'M87', priority: 0, position: at.clone() }] });
    layer.addGroup({ rank: 6.4, style: marked, frame: 'sky', labels: [{ text: 'M87* black hole', priority: 0, position: at.clone() }] });
    // A third has nowhere left; and a name with no marker offset is never moved.
    layer.addGroup({ rank: 6.5, style: marked, frame: 'sky', labels: [{ text: 'Virgo A', priority: 0, position: at.clone() }] });
    layer.addGroup({ rank: 6.6, style, frame: 'sky', labels: [{ text: 'VIRGO', priority: 0, position: at.clone() }] });
    layer.update(camera, WIDTH, HEIGHT, undefined, new THREE.Matrix4());
    expect(layer.visibleNames()).toEqual(['M87', 'M87* black hole']);
    const y = (text: string): number => {
      const element = [...parent.querySelectorAll<HTMLElement>('.place-label')].find((e) => e.textContent === text)!;
      return Number(/, ([-\d.]+)px\)/.exec(element.style.transform)![1]);
    };
    expect(y('M87') - y('M87* black hole')).toBeCloseTo(22, 0);
    layer.dispose();
  });

  describe('below the horizon', () => {
    /** Unit directions fanned round `axis`, far enough apart on a big viewport not to collide. */
    function fan(axis: THREE.Vector3, count: number): THREE.Vector3[] {
      const side = new THREE.Vector3(0, 0, 1).cross(axis).normalize();
      const other = axis.clone().cross(side);
      return Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * 2 * Math.PI;
        return axis
          .clone()
          .addScaledVector(side, 0.25 * Math.cos(angle))
          .addScaledVector(other, 0.25 * Math.sin(angle))
          .normalize();
      });
    }
    // A camera looking straight down through the planet: all the sky it sees is below the horizon.
    function downView() {
      const parent = document.createElement('div');
      const layer = new LabelLayer(parent, []);
      const camera = cameraAimedAt(-119.5, 37.0);
      camera.up.set(0, 0, 1);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      const down = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      return { parent, layer, camera, down };
    }
    const sky = new THREE.Matrix4();

    it('names only a few sky objects through the Earth in a wide view, the best ranked first', () => {
      const { layer, camera, down } = downView();
      const stars = fan(down, 12).map((position, i) => ({ text: `star ${i}`, priority: i, position }));
      layer.addGroup({ rank: 6.4, style, frame: 'sky', labels: stars });
      layer.addGroup({ rank: 6.3, style, frame: 'sky', labels: [{ text: 'Sun', priority: 0, position: down.clone() }] });
      layer.update(camera, 4000, 4000, undefined, sky);
      const names = layer.visibleNames();
      expect(names).toHaveLength(MAX_SKY_LABELS_THROUGH_EARTH);
      expect(names[0]).toBe('Sun');
      layer.dispose();
    });

    it('names them all once the view is zoomed in', () => {
      const { layer, camera, down } = downView();
      camera.fov = SKY_ZOOMED_FOV_DEG - 10;
      camera.updateProjectionMatrix();
      // Fanned more tightly, to stay inside the narrower view.
      const stars = fan(down, 12).map((position, i) => ({ text: `star ${i}`, priority: i, position: position.lerp(down, 0.7).normalize() }));
      layer.addGroup({ rank: 6.4, style, frame: 'sky', labels: stars });
      layer.update(camera, 4000, 4000, undefined, sky);
      expect(layer.visibleNames()).toHaveLength(12);
      layer.dispose();
    });

    it('holds a zoomed-only group back in a wide view, but not above the horizon', () => {
      const { layer, camera, down } = downView();
      layer.addGroup({ rank: 6.4, style, frame: 'sky', belowHorizon: 'zoomed', labels: [{ text: 'Mimosa', priority: 0, position: down.clone() }] });
      layer.update(camera, WIDTH, HEIGHT, undefined, sky);
      expect(layer.visibleNames()).toEqual([]);
      // Turn the sky over: the same star is now overhead, and the camera looks up at it.
      const flipped = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1).cross(down).normalize(), Math.PI);
      const up = down.clone().negate();
      camera.lookAt(camera.position.clone().add(up));
      camera.updateMatrixWorld();
      layer.update(camera, WIDTH, HEIGHT, undefined, flipped);
      expect(layer.visibleNames()).toEqual(['Mimosa']);
      layer.dispose();
    });

    it('draws a name through the Earth faint, and at full strength again above the horizon', () => {
      const { parent, layer, camera, down } = downView();
      layer.addGroup({ rank: 6.3, style, frame: 'sky', labels: [{ text: 'Sun', priority: 0, position: down.clone() }] });
      layer.update(camera, WIDTH, HEIGHT, undefined, sky);
      const element = parent.querySelector<HTMLElement>('.place-label')!;
      expect(Number(element.style.opacity)).toBeLessThan(1);
      const flipped = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1).cross(down).normalize(), Math.PI);
      camera.lookAt(camera.position.clone().sub(down));
      camera.updateMatrixWorld();
      layer.update(camera, WIDTH, HEIGHT, undefined, flipped);
      expect(layer.visibleNames()).toEqual(['Sun']);
      expect(element.style.opacity).toBe('');
      layer.dispose();
    });

    it('names nothing below the horizon when the sky is not drawn through the Earth - except things in space', () => {
      const { layer, camera, down } = downView();
      layer.addGroup({ rank: 6.3, style, frame: 'sky', labels: [{ text: 'Sun', priority: 0, position: down.clone() }] });
      // A satellite beyond the far side of the planet, straight down.
      const beyond = camera.position.clone().addScaledVector(down, 3 * EARTH_RADIUS_M);
      layer.addGroup({ rank: 6.31, style: { ...style, offsetYPx: 30 }, frame: 'space', labels: [{ text: 'ISS', priority: 0, position: beyond }] });
      layer.setSkyThroughEarth(false);
      layer.update(camera, WIDTH, HEIGHT, undefined, sky);
      expect(layer.visibleNames()).toEqual(['ISS']);
      layer.setSkyThroughEarth(true);
      layer.update(camera, WIDTH, HEIGHT, undefined, sky);
      expect(layer.visibleNames()).toEqual(['Sun', 'ISS']);
      layer.dispose();
    });

    it('gives each eye its own view of a name in space, and the same view of one on the sky', () => {
      const parent = document.createElement('div');
      const layer = new LabelLayer(parent, []);
      layer.setStereo(true);
      const camera = cameraAimedAt(-119.5, 37.0);
      camera.up.set(0, 0, 1);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      const down = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const right = camera.clone();
      // A hyperstereo baseline: the right eye 40 km along the camera's x.
      right.position.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), 40_000);
      right.updateMatrixWorld();
      const near = camera.position.clone().addScaledVector(down, 1_000_000);
      layer.addGroup({ rank: 6.3, style, frame: 'space', labels: [{ text: 'ISS', priority: 0, position: near }] });
      layer.addGroup({ rank: 6.4, style: { ...style, offsetYPx: 40 }, frame: 'sky', labels: [{ text: 'Vega', priority: 0, position: down.clone() }] });
      layer.update(camera, WIDTH, HEIGHT, right, sky);
      const x = (selector: string, text: string): number => {
        const element = [...parent.querySelectorAll<HTMLElement>(selector)].find((e) => e.textContent === text)!;
        return Number(/translate\(([-\d.]+)px/.exec(element.style.transform)![1]);
      };
      const left = '.place-labels--left-eye .place-label';
      const rightEye = '.place-labels--right-eye .place-label';
      expect(Math.abs(x(left, 'Vega') - x(rightEye, 'Vega'))).toBeLessThan(0.2);
      // 40 km at 1000 km is 2.3°: tens of pixels.
      expect(x(left, 'ISS') - x(rightEye, 'ISS')).toBeGreaterThan(10);
      layer.dispose();
    });
  });
});
