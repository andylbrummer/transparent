import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import type { AwaitedGaze, Target } from './actions';
import { EDGE_INSET_PX, GazePointer, RING_CLEAR_PX, STEREO_ARROW_DEG, placePointer, placeStereoPointer, type ClearArea, type PointerPlacement } from './gaze-pointer';
import { StereoRig } from '../render/stereo';
import { ARRIVE_DEG } from './view-control';

const WIDTH = 400;
const HEIGHT = 800;
/** Beneath a 46 px compass bar, with no safe-area insets. */
const CLEAR: ClearArea = { left: 0, top: 46, width: 400, height: 754 };
const DEG = Math.PI / 180;

/** A portrait phone's camera at the origin, looking down -z with +y up, so a direction in the world is one in the camera. */
function phoneCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 1e9);
}

/** The direction `rightDeg` to the right of straight ahead and `upDeg` above it. */
function toward(rightDeg: number, upDeg = 0): THREE.Vector3 {
  const r = rightDeg * DEG;
  const u = upDeg * DEG;
  return new THREE.Vector3(Math.cos(u) * Math.sin(r), Math.sin(u), -Math.cos(u) * Math.cos(r));
}

function arrow(placement: PointerPlacement): Extract<PointerPlacement, { kind: 'arrow' }> {
  if (placement.kind !== 'arrow') throw new Error(`a ${placement.kind}, not an arrow`);
  return placement;
}

describe('placePointer', () => {
  it('rings a target straight ahead at the middle of the view', () => {
    expect(placePointer(phoneCamera(), toward(0), WIDTH, HEIGHT, CLEAR)).toEqual({
      kind: 'ring',
      xPx: WIDTH / 2,
      yPx: HEIGHT / 2 - CLEAR.top,
    });
  });

  it('points up at a target on screen but under the compass bar', () => {
    // Drawn at y = 50 px: inside the viewport, under the 46 px bar's ring margin.
    const upDeg = Math.atan((1 - (2 * 50) / HEIGHT) * Math.tan(30 * DEG)) / DEG;
    const placed = arrow(placePointer(phoneCamera(), toward(0, upDeg), WIDTH, HEIGHT, CLEAR));
    expect(50).toBeLessThan(CLEAR.top + RING_CLEAR_PX);
    expect(placed).toMatchObject({ edge: 'top', way: 'up' });
    expect(placed.offCentreDeg).toBeCloseTo(upDeg, 9);
  });

  it('points right at the right edge, halfway down, for a target well to the right', () => {
    const placed = arrow(placePointer(phoneCamera(), toward(74), WIDTH, HEIGHT, CLEAR));
    expect(placed).toMatchObject({ edge: 'right', way: 'right' });
    expect(placed.turnRad).toBeCloseTo(Math.PI / 2, 9);
    expect(placed.xPx).toBeCloseTo(CLEAR.width - EDGE_INSET_PX, 9);
    expect(placed.yPx).toBeCloseTo(CLEAR.height / 2, 9);
    expect(placed.offCentreDeg).toBeCloseTo(74, 9);
  });

  it('points left for a target behind and to the left', () => {
    const placed = arrow(placePointer(phoneCamera(), toward(-150), WIDTH, HEIGHT, CLEAR));
    expect(placed).toMatchObject({ edge: 'left', way: 'left' });
    expect(placed.offCentreDeg).toBeCloseTo(150, 9);
  });

  it('points right, somewhere finite, for a target straight behind', () => {
    const placed = arrow(placePointer(phoneCamera(), toward(180), WIDTH, HEIGHT, CLEAR));
    expect(placed.way).toBe('right');
    expect(placed.offCentreDeg).toBeCloseTo(180, 9);
    expect(Number.isFinite(placed.xPx) && Number.isFinite(placed.yPx)).toBe(true);
  });

  it('says up for a target up and to the right that meets the side edge of a tall screen', () => {
    expect(placePointer(phoneCamera(), toward(30, 40), WIDTH, HEIGHT, CLEAR)).toMatchObject({ kind: 'arrow', edge: 'right', way: 'up' });
  });

  it('turns with the camera: rolled a quarter turn, what was to the right is below', () => {
    const camera = phoneCamera();
    // Counter-clockwise as the user sees it: the camera's right now points up the world.
    camera.rotateZ(Math.PI / 2);
    expect(placePointer(camera, toward(74), WIDTH, HEIGHT, CLEAR)).toMatchObject({ kind: 'arrow', way: 'down' });
  });

  it('keeps every arrow inside the clear area and every ring inside its margin', () => {
    const camera = phoneCamera();
    let rings = 0;
    for (let rightDeg = 0; rightDeg < 360; rightDeg += 15) {
      for (const upDeg of [-80, -45, -10, 0, 10, 45, 80]) {
        const placed = placePointer(camera, toward(rightDeg, upDeg), WIDTH, HEIGHT, CLEAR);
        const margin = placed.kind === 'ring' ? RING_CLEAR_PX : 0;
        if (placed.kind === 'ring') rings++;
        expect(placed.xPx).toBeGreaterThanOrEqual(margin);
        expect(placed.xPx).toBeLessThanOrEqual(CLEAR.width - margin);
        expect(placed.yPx).toBeGreaterThanOrEqual(margin);
        expect(placed.yPx).toBeLessThanOrEqual(CLEAR.height - margin);
      }
    }
    expect(rings).toBeGreaterThan(0);
  });
});

describe('placeStereoPointer', () => {
  const EYE_W = 422;
  const EYE_H = 390;
  /** A Cardboard rig on a head at the origin looking down -z, its convergence spots 300 px apart. */
  function rig(): StereoRig {
    const head = new THREE.PerspectiveCamera(60, (2 * EYE_W) / EYE_H, 0.1, 1e9);
    head.updateMatrixWorld();
    const stereo = new StereoRig();
    stereo.update(head, EYE_W, EYE_H, 300);
    return stereo;
  }

  it('rings a target near the centre, at the same height in both eyes', () => {
    const { left, right } = rig();
    const l = placeStereoPointer(left, toward(5, 3), EYE_W, EYE_H);
    const r = placeStereoPointer(right, toward(5, 3), EYE_W, EYE_H);
    expect(l.kind).toBe('ring');
    expect(r.kind).toBe('ring');
    expect(l.yPx).toBeCloseTo(r.yPx, 3);
  });

  it(`puts the arrow ${STEREO_ARROW_DEG}° from the centre, not at the edge, for a target behind`, () => {
    const { left } = rig();
    const ahead = placeStereoPointer(left, toward(0), EYE_W, EYE_H);
    const placed = arrow(placeStereoPointer(left, toward(120), EYE_W, EYE_H));
    expect(placed.way).toBe('right');
    expect(placed.edge).toBe('right');
    expect(Math.round(placed.offCentreDeg)).toBe(120);
    expect(placed.xPx).toBeGreaterThan(ahead.xPx);
    expect(placed.xPx).toBeLessThan(EYE_W - EDGE_INSET_PX);
    expect(placed.yPx).toBeCloseTo(EYE_H / 2, 3);
  });

  it('places the arrow where both eyes fuse: as far from each eye’s convergence spot', () => {
    const { left, right } = rig();
    const spotL = placeStereoPointer(left, toward(0), EYE_W, EYE_H);
    const spotR = placeStereoPointer(right, toward(0), EYE_W, EYE_H);
    const l = arrow(placeStereoPointer(left, toward(0, -90), EYE_W, EYE_H));
    const r = arrow(placeStereoPointer(right, toward(0, -90), EYE_W, EYE_H));
    expect(l.way).toBe('down');
    expect(l.xPx - spotL.xPx).toBeCloseTo(r.xPx - spotR.xPx, 1);
    expect(l.yPx).toBeCloseTo(r.yPx, 3);
  });
});

describe('GazePointer', () => {
  const mars: Target = { kind: 'body', body: 'mars' };
  const jupiter: Target = { kind: 'body', body: 'jupiter' };

  function gaze(target: Target, name: string | null, direction: THREE.Vector3, arriving = 0): AwaitedGaze {
    return { target, name, direction, arriving };
  }

  /**
   * A pointer whose clear area is `CLEAR`, as the CSS would make its box:
   * jsdom lays nothing out. `said()` lists what its status was told, one
   * entry a write, read from its mutations as they stand.
   */
  function setup() {
    const parent = document.createElement('div');
    const pointer = new GazePointer(parent);
    const root = parent.querySelector<HTMLElement>('.gaze-pointer')!;
    const measure = vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: CLEAR.left, y: CLEAR.top, width: CLEAR.width, height: CLEAR.height }));
    const part = (name: string): HTMLElement => root.querySelector<HTMLElement>(`.gaze-pointer__${name}`)!;
    const status = part('status');
    const writes: string[] = [];
    const collect = (records: MutationRecord[]): void => {
      for (const record of records) writes.push(record.addedNodes[0]?.textContent ?? '');
    };
    const observer = new MutationObserver(collect);
    observer.observe(status, { childList: true });
    const said = (): string[] => {
      collect(observer.takeRecords());
      return writes;
    };
    const shown = (name: string): boolean => part(name).style.display !== 'none';
    return { parent, pointer, root, measure, part, status, said, shown, camera: phoneCamera() };
  }

  it('shows nothing and says nothing when no look waits', () => {
    const t = setup();
    t.pointer.update(null, t.camera, WIDTH, HEIGHT);
    expect([t.shown('arrow'), t.shown('ring'), t.shown('name')]).toEqual([false, false, false]);
    expect(t.status.textContent).toBe('');
  });

  it('shows an arrow with the name, how far and which way', () => {
    const t = setup();
    t.pointer.update(gaze(mars, 'Mars', toward(74)), t.camera, WIDTH, HEIGHT);
    expect(t.shown('arrow')).toBe(true);
    expect(t.part('arrow').textContent).toBe('Mars · 74° right▲');
    expect(t.part('text').textContent).toBe('Mars · 74° right');
    expect(t.part('arrow').dataset.edge).toBe('right');
    expect([t.shown('ring'), t.shown('name')]).toEqual([false, false]);
    t.pointer.update(gaze(mars, null, toward(74)), t.camera, WIDTH, HEIGHT);
    expect(t.part('text').textContent).toBe('74° right');
  });

  it('rings a target in sight, names it if it has a name, and closes the ring as the user arrives', () => {
    const t = setup();
    t.pointer.update(gaze(mars, 'Mars', toward(0), 0.5), t.camera, WIDTH, HEIGHT);
    expect([t.shown('ring'), t.shown('arrow'), t.shown('name')]).toEqual([true, false, true]);
    expect(t.part('name').textContent).toBe('Mars');
    expect(t.part('ring').style.transform).toContain('scale(0.75)');
    t.pointer.update(gaze(mars, null, toward(0)), t.camera, WIDTH, HEIGHT);
    expect(t.shown('name')).toBe(false);
  });

  it('leaves nothing of the arrow behind for a ring, nor of the ring once the look ends', () => {
    const t = setup();
    const direction = toward(74);
    t.pointer.update(gaze(mars, 'Mars', direction), t.camera, WIDTH, HEIGHT);
    t.camera.rotation.y = -74 * DEG;
    t.pointer.update(gaze(mars, 'Mars', direction), t.camera, WIDTH, HEIGHT);
    expect([t.shown('arrow'), t.shown('ring'), t.shown('name')]).toEqual([false, true, true]);
    t.pointer.update(null, t.camera, WIDTH, HEIGHT);
    expect([t.shown('arrow'), t.shown('ring'), t.shown('name')]).toEqual([false, false, false]);
  });

  it('measures the clear area once per viewport size', () => {
    const t = setup();
    const looking = gaze(mars, 'Mars', toward(74));
    for (let i = 0; i < 5; i++) t.pointer.update(looking, t.camera, WIDTH, HEIGHT);
    expect(t.measure).toHaveBeenCalledTimes(1);
    const before = t.part('arrow').style.transform;
    t.measure.mockReturnValue(DOMRect.fromRect({ x: 0, y: 46, width: 800, height: 354 }));
    t.camera.aspect = 800 / 400;
    t.camera.updateProjectionMatrix();
    t.pointer.update(looking, t.camera, 800, 400);
    expect(t.measure).toHaveBeenCalledTimes(2);
    expect(t.part('arrow').style.transform).not.toBe(before);
  });

  it('measures the clear area again when the page’s classes change, as a guide’s play bar taking the foot does', () => {
    const t = setup();
    const looking = gaze(mars, 'Mars', toward(74));
    t.pointer.update(looking, t.camera, WIDTH, HEIGHT);
    document.body.classList.add('guide-open');
    try {
      t.pointer.update(looking, t.camera, WIDTH, HEIGHT);
      t.pointer.update(looking, t.camera, WIDTH, HEIGHT);
      expect(t.measure).toHaveBeenCalledTimes(2);
    } finally {
      document.body.classList.remove('guide-open');
    }
    t.pointer.update(looking, t.camera, WIDTH, HEIGHT);
    expect(t.measure).toHaveBeenCalledTimes(3);
  });

  it('does nothing while hidden, and leaves with dispose', () => {
    const t = setup();
    t.pointer.setVisible(false);
    expect(t.root.style.display).toBe('none');
    t.pointer.update(gaze(mars, 'Mars', toward(74)), t.camera, WIDTH, HEIGHT);
    expect(t.measure).not.toHaveBeenCalled();
    expect(t.said()).toEqual([]);
    t.pointer.dispose();
    expect(t.root.parentElement).toBeNull();
  });

  describe('for a screen reader', () => {
    it('reads out only the status', () => {
      const t = setup();
      expect(t.status.getAttribute('role')).toBe('status');
      for (const name of ['arrow', 'ring', 'name']) expect(t.part(name).getAttribute('aria-hidden')).toBe('true');
    });

    it('says what to look for when the pointer goes up', () => {
      const cases: [string | null, THREE.Vector3, string][] = [
        ['Mars', toward(74), 'Look for Mars, 74° right'],
        [null, toward(74), 'Look 74° right'],
        ['Mars', toward(0), 'Look for Mars'],
        [null, toward(0), 'Look at the ring'],
      ];
      for (const [name, direction, text] of cases) {
        const t = setup();
        t.pointer.update(gaze(mars, name, direction), t.camera, WIDTH, HEIGHT);
        expect(t.status.textContent).toBe(text);
      }
    });

    it('does not read out the turn frame by frame', () => {
      const t = setup();
      const direction = toward(74);
      t.pointer.update(gaze(mars, 'Mars', direction), t.camera, WIDTH, HEIGHT);
      for (const [turnedDeg, arriving] of [
        [14, 0],
        [34, 0],
        [74, 0],
        [74, 0.5],
      ]) {
        t.camera.rotation.y = -turnedDeg * DEG;
        t.pointer.update(gaze(mars, 'Mars', direction, arriving), t.camera, WIDTH, HEIGHT);
      }
      expect(t.shown('ring')).toBe(true);
      expect(t.status.textContent).toBe('Look for Mars, 74° right');
      expect(t.said()).toHaveLength(1);
    });

    it('says a look once however often it is shown, even from another object for the same target', () => {
      const t = setup();
      const looking = gaze(mars, 'Mars', toward(74));
      for (let i = 0; i < 10; i++) t.pointer.update(looking, t.camera, WIDTH, HEIGHT);
      t.pointer.update(gaze({ kind: 'body', body: 'mars' }, 'Mars', toward(74)), t.camera, WIDTH, HEIGHT);
      expect(t.said()).toHaveLength(1);
    });

    it('says the target is found when the look ends with it at the centre, once', () => {
      for (const [name, text] of [
        ['Mars', 'Found Mars'],
        [null, 'Found it'],
      ] as const) {
        const t = setup();
        const direction = toward(74);
        t.pointer.update(gaze(mars, name, direction), t.camera, WIDTH, HEIGHT);
        t.camera.rotation.y = -(74 - ARRIVE_DEG / 2) * DEG;
        t.pointer.update(null, t.camera, WIDTH, HEIGHT);
        expect(t.status.textContent).toBe(text);
        for (let i = 0; i < 3; i++) t.pointer.update(null, t.camera, WIDTH, HEIGHT);
        expect(t.said()).toHaveLength(2);
      }
    });

    it('takes its instruction back, saying nothing, when the look is given up away from its target', () => {
      const t = setup();
      const direction = toward(74);
      t.pointer.update(gaze(mars, 'Mars', direction), t.camera, WIDTH, HEIGHT);
      t.camera.rotation.y = -34 * DEG;
      t.pointer.update(null, t.camera, WIDTH, HEIGHT);
      expect(t.status.textContent).toBe('');
      expect(t.said()).toEqual(['Look for Mars, 74° right', '']);
    });

    it('says only the new look when one replaces another', () => {
      const t = setup();
      t.pointer.update(gaze(mars, 'Mars', toward(74)), t.camera, WIDTH, HEIGHT);
      t.pointer.update(gaze(jupiter, 'Jupiter', toward(-40)), t.camera, WIDTH, HEIGHT);
      expect(t.said()).toEqual(['Look for Mars, 74° right', 'Look for Jupiter, 40° left']);
    });

    it('says a look again when shown again, but not the end of one that stopped while hidden', () => {
      const t = setup();
      const looking = gaze(mars, 'Mars', toward(74));
      t.pointer.update(looking, t.camera, WIDTH, HEIGHT);
      t.pointer.setVisible(false);
      expect(t.status.textContent).toBe('');
      t.pointer.setVisible(true);
      t.pointer.update(looking, t.camera, WIDTH, HEIGHT);
      expect(t.said()).toEqual(['Look for Mars, 74° right', '', 'Look for Mars, 74° right']);
      t.pointer.setVisible(false);
      t.camera.rotation.y = -74 * DEG;
      t.pointer.setVisible(true);
      t.pointer.update(null, t.camera, WIDTH, HEIGHT);
      expect(t.said()).toEqual(['Look for Mars, 74° right', '', 'Look for Mars, 74° right', '']);
    });
  });

  describe('in Cardboard', () => {
    it('draws the arrow once per eye, the right eye’s in the right half, and still says it once', () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const pointer = new GazePointer(parent);
      const head = new THREE.PerspectiveCamera(60, 844 / 390, 0.1, 1e9);
      head.updateMatrixWorld();
      const stereo = new StereoRig();
      stereo.update(head, 422, 390, 300);
      const gaze: AwaitedGaze = { target: { kind: 'horizon', azDeg: 90, altDeg: 0 }, direction: toward(90), name: 'Mars', arriving: 0 };
      pointer.update(gaze, head, 844, 390, { left: stereo.left, right: stereo.right, eyeWidth: 422 });
      const arrows = [...parent.querySelectorAll<HTMLElement>('.gaze-pointer__arrow')];
      expect(arrows.map((a) => a.style.display)).toEqual(['', '']);
      expect(arrows.map((a) => a.textContent)).toEqual(['Mars · 90° right▲', 'Mars · 90° right▲']);
      const x = (a: HTMLElement): number => parseFloat(/translate\(([-\d.]+)px/.exec(a.style.transform)![1]);
      expect(x(arrows[0])).toBeLessThan(422);
      expect(x(arrows[1])).toBeGreaterThan(422);
      expect(parent.querySelectorAll('[role="status"]')).toHaveLength(1);
      pointer.update(gaze, head, 844, 390, null);
      expect(arrows[1].style.display).toBe('none');
      pointer.dispose();
      parent.remove();
    });
  });
});
