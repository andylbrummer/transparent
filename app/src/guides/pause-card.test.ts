import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { CHOICE_SPACING_DEG, PAUSE_DWELL_MS, PauseCard, type PauseChoice } from './pause-card';
import { StereoRig } from '../render/stereo';

const DEG = Math.PI / 180;
/** The direction `rightDeg` right of straight ahead (-z) and `upDeg` above it, for a head at the origin. */
function toward(rightDeg: number, upDeg = 0): THREE.Vector3 {
  return new THREE.Vector3(Math.tan(rightDeg * DEG), Math.tan(upDeg * DEG), -1).normalize();
}

let parent: HTMLElement;
let card: PauseCard;
let head: THREE.PerspectiveCamera;
const items = (): HTMLElement[] => [...parent.querySelectorAll<HTMLElement>('.pause-card__item')];

/** Frames of 16 ms looking along `forward`, for `ms`; the last choice made. */
function look(forward: THREE.Vector3, ms: number): PauseChoice | null {
  let chosen: PauseChoice | null = null;
  for (let t = 0; t < ms; t += 16) chosen = card.update(forward, 16) ?? chosen;
  return chosen;
}

beforeEach(() => {
  parent = document.createElement('div');
  card = new PauseCard(parent);
  head = new THREE.PerspectiveCamera(60, 2, 0.1, 1e9);
  head.updateMatrixWorld();
});

describe('PauseCard', () => {
  it('is down until a pause puts it up, and offers Back, Resume, Next and Leave in each eye', () => {
    expect(card.isOpen()).toBe(false);
    expect(parent.querySelector<HTMLElement>('.pause-card')!.hidden).toBe(true);
    card.open(head);
    expect(card.isOpen()).toBe(true);
    expect(items().map((i) => i.textContent)).toEqual(['Back', 'Resume', 'Next', 'Leave', 'Back', 'Resume', 'Next', 'Leave']);
  });

  it('chooses nothing while the view has not yet left Resume, under it as the card opens', () => {
    card.open(head);
    expect(look(toward(0), 3 * PAUSE_DWELL_MS)).toBeNull();
  });

  it.each<[PauseChoice, number, number]>([
    ['back', -CHOICE_SPACING_DEG, 0],
    ['next', CHOICE_SPACING_DEG, 0],
    ['leave', 0, -0.7 * CHOICE_SPACING_DEG],
  ])('chooses %s after a look of PAUSE_DWELL_MS at it, and closes', (choice, rightDeg, upDeg) => {
    card.open(head);
    // On the way there the view crosses the gap between choices, which arms the card.
    look(toward(11, 0), 32);
    look(toward(rightDeg, upDeg), PAUSE_DWELL_MS - 50);
    expect(card.isOpen()).toBe(true);
    expect(look(toward(rightDeg, upDeg), 100)).toBe(choice);
    expect(card.isOpen()).toBe(false);
  });

  it('chooses Resume once the view has left it and come back', () => {
    card.open(head);
    look(toward(11, 0), 100);
    expect(look(toward(0), PAUSE_DWELL_MS + 50)).toBe('resume');
  });

  it('starts a dwell again when the view moves to another choice, and shows it filling', () => {
    card.open(head);
    look(toward(11, 0), 100);
    look(toward(-CHOICE_SPACING_DEG), PAUSE_DWELL_MS * 0.6);
    expect(Number(items()[0].style.getPropertyValue('--dwell'))).toBeGreaterThan(0.4);
    expect(look(toward(CHOICE_SPACING_DEG), PAUSE_DWELL_MS * 0.6)).toBeNull();
    expect(items()[0].style.getPropertyValue('--dwell')).toBe('0');
  });

  it('stays on the scene where it opened: turning the head does not move the choices', () => {
    card.open(head);
    head.rotateY(-30 * DEG);
    head.updateMatrixWorld();
    look(toward(11, 0), 100);
    expect(look(toward(CHOICE_SPACING_DEG), PAUSE_DWELL_MS + 50)).toBe('next');
  });

  it("places each eye's copy in its own half, at one height", () => {
    const rig = new StereoRig();
    rig.update(head, 422, 390, 300);
    card.open(head);
    card.place(rig.left, rig.right, 422, 390);
    const at = (i: HTMLElement): [number, number] => {
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(i.style.transform)!;
      return [parseFloat(m[1]), parseFloat(m[2])];
    };
    const [leftResume, rightResume] = [items()[1], items()[5]].map(at);
    expect(leftResume[0]).toBeLessThan(422);
    expect(rightResume[0]).toBeGreaterThan(422);
    expect(leftResume[1]).toBeCloseTo(rightResume[1], 3);
    expect(at(items()[3])[1]).toBeGreaterThan(leftResume[1]);
  });

  it('leaves with dispose', () => {
    card.dispose();
    expect(parent.querySelector('.pause-card')).toBeNull();
  });
});
