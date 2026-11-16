import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HeadGestures, REFRACTORY_MS, type HeadGesture } from './head-gestures';

const FRAME_MS = 1000 / 60;
const DEG = Math.PI / 180;

/** Where the head starts: looking well above the horizon and turned, so its own axes are not the world's. */
const BASE = new THREE.Quaternion().setFromEuler(new THREE.Euler(50 * DEG, 30 * DEG, 0, 'YXZ'));

/** The head at `yawDeg` left and `pitchDeg` up of BASE, in its own frame. */
function head(yawDeg: number, pitchDeg: number): THREE.Quaternion {
  return BASE.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchDeg * DEG, yawDeg * DEG, 0, 'YXZ')));
}

/** Run `motion` (seconds → yaw and pitch, degrees) for `seconds`, then a still half second; the gestures seen. */
function run(gestures: HeadGestures, seconds: number, motion: (t: number) => [number, number]): HeadGesture[] {
  const seen: HeadGesture[] = [];
  const frames = Math.round((seconds * 1000) / FRAME_MS);
  for (let frame = 0; frame <= frames; frame++) {
    const gesture = gestures.update(head(...motion((frame * FRAME_MS) / 1000)), FRAME_MS);
    if (gesture) seen.push(gesture);
  }
  const [yaw, pitch] = motion(seconds);
  for (let frame = 0; frame < 30; frame++) {
    const gesture = gestures.update(head(yaw, pitch), FRAME_MS);
    if (gesture) seen.push(gesture);
  }
  return seen;
}

/** A head shake: 12° each way at 2.5 Hz, for one and a half cycles. */
const shake = (t: number): [number, number] => [12 * Math.sin(2 * Math.PI * 2.5 * t), 0];
/** A nod: 10° down and back at 2 Hz, one cycle. */
const nod = (t: number): [number, number] => [0, -10 * Math.sin(2 * Math.PI * 2 * t)];

describe('HeadGestures', () => {
  it('sees a head shake once', () => {
    expect(run(new HeadGestures(), 0.6, shake)).toEqual(['shake']);
  });

  it('sees a nod once', () => {
    expect(run(new HeadGestures(), 0.5, nod)).toEqual(['nod']);
  });

  it('sees nothing in a slow look round and back', () => {
    const lookRound = (t: number): [number, number] => [60 * Math.sin((Math.PI * t) / 4), 10 * Math.sin((Math.PI * t) / 2)];
    expect(run(new HeadGestures(), 4, lookRound)).toEqual([]);
  });

  it('sees nothing in a quick turn that stops', () => {
    const turn = (t: number): [number, number] => [Math.min(1, t / 0.3) * 40, 0];
    expect(run(new HeadGestures(), 0.4, turn)).toEqual([]);
  });

  it('sees no shake in a glance left and back: two swings, not three', () => {
    const glance = (t: number): [number, number] => [15 * Math.sin(2 * Math.PI * 1.5 * t), 0];
    expect(run(new HeadGestures(), 1 / 1.5 / 2, glance)).toEqual([]);
  });

  it('sees no nod in a glance up and back', () => {
    const glanceUp = (t: number): [number, number] => [0, 10 * Math.sin(2 * Math.PI * 2 * t)];
    expect(run(new HeadGestures(), 0.25, glanceUp)).toEqual([]);
  });

  it('sees neither in a head rolling round diagonally', () => {
    const diagonal = (t: number): [number, number] => [12 * Math.sin(2 * Math.PI * 2.5 * t), 12 * Math.sin(2 * Math.PI * 2.5 * t)];
    expect(run(new HeadGestures(), 0.6, diagonal)).toEqual([]);
  });

  it('sees no shake in swings too far apart', () => {
    // Each swing quick, with a still second between them.
    const slowRhythm = (t: number): [number, number] => {
      const swing = Math.min(2, Math.floor(t / 1.2));
      const within = Math.min(1, (t - swing * 1.2) / 0.2);
      const at = (k: number): number => (k % 2 === 0 ? 0 : 20);
      return [at(swing) + (at(swing + 1) - at(swing)) * within, 0];
    };
    expect(run(new HeadGestures(), 3.6, slowRhythm)).toEqual([]);
  });

  it('sees a second gesture once the first has settled', () => {
    const gestures = new HeadGestures();
    expect(run(gestures, 0.6, shake)).toEqual(['shake']);
    expect(REFRACTORY_MS).toBeLessThan(500);
    expect(run(gestures, 0.5, nod)).toEqual(['nod']);
  });
});
