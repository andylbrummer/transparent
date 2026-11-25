import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CLOSE_MS,
  DEFAULT_FRAMING_DEG,
  DWELL_MS,
  FUSE_DELAY_MS,
  KEY_ZOOM_FACTOR,
  MIN_FRAMING_DEG,
  NOD_ZOOM_FACTOR,
  OPEN_MS,
  RECENT_MS,
  ROLL_DEAD_ZONE_DEG,
  ROLL_FULL_DEG,
  ROLL_MAX_DOUBLINGS_PER_S,
  RELEASE_DEG,
  SPYGLASS_DEG,
  STILL_DEG_PER_S,
  Spyglass,
  framingDeg,
  rollZoomDoublingsPerS,
  type SpyglassTarget,
} from './spyglass';

const FRAME_MS = 16;
const AHEAD = new THREE.Vector3(0, 0, -1);

function target(name: string, extentDeg: number | null, direction = AHEAD): SpyglassTarget {
  return { key: name, name, extentDeg, directionInto: (out) => out.copy(direction) };
}

/** The head turned `deg` from straight ahead, to the right. */
function turned(deg: number): THREE.Vector3 {
  const rad = THREE.MathUtils.degToRad(deg);
  return new THREE.Vector3(Math.sin(rad), 0, -Math.cos(rad));
}

/** Frames of `ms` with the head at `forward` and `candidate` under it. */
function hold(spyglass: Spyglass, ms: number, candidate: SpyglassTarget | null, forward = AHEAD): void {
  for (let t = 0; t < ms; t += FRAME_MS) spyglass.update(forward, candidate, FRAME_MS);
}

describe('Spyglass', () => {
  const m31 = target('M31', 3);

  it('opens after a still stare of DWELL_MS at a name', () => {
    const spyglass = new Spyglass();
    hold(spyglass, DWELL_MS - 2 * FRAME_MS, m31);
    expect(spyglass.getState().kind).toBe('fusing');
    hold(spyglass, 3 * FRAME_MS, m31);
    expect(spyglass.getState().kind).toBe('open');
  });

  describe('claims, ahead of a guide', () => {
    it('passes the button on at bare sky with nothing looked at lately', () => {
      const spyglass = new Spyglass();
      hold(spyglass, RECENT_MS + 100, null);
      expect(spyglass.claims(null)).toBe(false);
    });

    it('claims it for a name under the view, one held still on just now, a stare, or an open window', () => {
      const spyglass = new Spyglass();
      expect(spyglass.claims(m31)).toBe(true);
      hold(spyglass, 100, m31);
      expect(spyglass.claims(null)).toBe(true);
      spyglass.openOn(m31);
      hold(spyglass, RECENT_MS + 100, null);
      expect(spyglass.claims(null)).toBe(true);
    });
  });

  describe('openOn, for a guide in Cardboard', () => {
    it('opens at once on the target, framed as its extent says, with no stare', () => {
      const spyglass = new Spyglass();
      spyglass.openOn(m31);
      expect(spyglass.getState()).toMatchObject({ kind: 'open', target: m31, progress: 0, framedDeg: framingDeg(m31) });
    });

    it('leaves a window open on the same target as it is, and reopens one closing on it', () => {
      const spyglass = new Spyglass();
      spyglass.openOn(m31);
      hold(spyglass, 400, null);
      const progress = (spyglass.getState() as { progress: number }).progress;
      spyglass.openOn(m31);
      expect((spyglass.getState() as { progress: number }).progress).toBe(progress);
      hold(spyglass, FRAME_MS, null, turned(90));
      expect(spyglass.getState().kind).toBe('closing');
      spyglass.openOn(m31);
      expect(spyglass.getState().kind).toBe('open');
    });

    it('moves a window open on something else to the target', () => {
      const spyglass = new Spyglass();
      spyglass.openOn(target('Mars', null));
      spyglass.openOn(m31);
      expect(spyglass.getState()).toMatchObject({ kind: 'open', target: m31, progress: 0 });
    });
  });

  it('does nothing at bare sky', () => {
    const spyglass = new Spyglass();
    hold(spyglass, 3 * DWELL_MS, null);
    expect(spyglass.getState().kind).toBe('idle');
    expect(spyglass.view()).toBeNull();
  });

  it('shows the ring only after FUSE_DELAY_MS, filling to the end of the dwell', () => {
    const spyglass = new Spyglass();
    hold(spyglass, FUSE_DELAY_MS - 2 * FRAME_MS, m31);
    expect(spyglass.fuse()).toBeNull();
    hold(spyglass, (DWELL_MS - FUSE_DELAY_MS) / 2 + 2 * FRAME_MS, m31);
    expect(spyglass.fuse()?.fraction).toBeCloseTo(0.5, 1);
  });

  it('starts the dwell over when the head turns faster than holding still', () => {
    const spyglass = new Spyglass();
    hold(spyglass, DWELL_MS - 4 * FRAME_MS, m31);
    // One frame turned at twice the still speed.
    spyglass.update(turned(((2 * STILL_DEG_PER_S) / 1000) * FRAME_MS), m31, FRAME_MS);
    expect(spyglass.getState().kind).toBe('idle');
  });

  it('starts the dwell over when another name comes under the view', () => {
    const spyglass = new Spyglass();
    hold(spyglass, DWELL_MS - 4 * FRAME_MS, m31);
    hold(spyglass, 2 * FRAME_MS, target('M32', 0.1));
    expect(spyglass.getState()).toMatchObject({ kind: 'fusing', target: { name: 'M32' } });
    expect((spyglass.getState() as { heldMs: number }).heldMs).toBeLessThan(DWELL_MS / 2);
  });

  it('zooms from no magnification to the framing, and back when looked away from', () => {
    const spyglass = new Spyglass();
    hold(spyglass, DWELL_MS + FRAME_MS, m31);
    expect(spyglass.view()!.fovDeg).toBeCloseTo(SPYGLASS_DEG, 0);
    hold(spyglass, OPEN_MS + FRAME_MS, m31);
    expect(spyglass.view()!.fovDeg).toBeCloseTo(framingDeg(m31), 5);
    // Inside the release angle it stays open, the window fixed on the object.
    hold(spyglass, 200, null, turned(RELEASE_DEG - 1));
    expect(spyglass.getState().kind).toBe('open');
    spyglass.update(turned(RELEASE_DEG + 1), null, FRAME_MS);
    expect(spyglass.getState().kind).toBe('closing');
    hold(spyglass, CLOSE_MS + FRAME_MS, null, turned(RELEASE_DEG + 1));
    expect(spyglass.getState().kind).toBe('idle');
    expect(spyglass.view()).toBeNull();
  });

  it('zooms evenly in log scale: half way through, the geometric mean', () => {
    const spyglass = new Spyglass();
    hold(spyglass, DWELL_MS + FRAME_MS, m31);
    // Smoothstep is at one half at the middle of the opening.
    hold(spyglass, OPEN_MS / 2, m31);
    const progress = (spyglass.getState() as { progress: number }).progress;
    const eased = progress * progress * (3 - 2 * progress);
    expect(spyglass.view()!.fovDeg).toBeCloseTo(SPYGLASS_DEG * Math.pow(framingDeg(m31) / SPYGLASS_DEG, eased), 6);
  });

  it('opens at once on Enter, on the name under the view, and closes on Enter', () => {
    const spyglass = new Spyglass();
    expect(spyglass.onKeyDown('Enter', m31)).toBe(true);
    expect(spyglass.getState()).toMatchObject({ kind: 'open', target: { name: 'M31' } });
    expect(spyglass.onKeyDown('Enter', m31)).toBe(true);
    expect(spyglass.getState().kind).toBe('closing');
  });

  it('does nothing on Enter at bare sky', () => {
    const spyglass = new Spyglass();
    spyglass.onKeyDown('Enter', null);
    expect(spyglass.getState().kind).toBe('idle');
  });

  it('opens the name being stared at on Enter, without waiting out the dwell', () => {
    const spyglass = new Spyglass();
    hold(spyglass, DWELL_MS / 2, m31);
    spyglass.onKeyDown('Enter', null);
    expect(spyglass.getState()).toMatchObject({ kind: 'open', target: { name: 'M31' } });
  });

  it('keeps a window closed by key shut on that name until the view leaves it', () => {
    const spyglass = new Spyglass();
    spyglass.onKeyDown('Enter', m31);
    hold(spyglass, OPEN_MS, m31);
    spyglass.onKeyDown('Enter', m31);
    hold(spyglass, CLOSE_MS + 3 * DWELL_MS, m31);
    expect(spyglass.getState().kind).toBe('idle');
    hold(spyglass, 2 * FRAME_MS, null);
    hold(spyglass, DWELL_MS + FRAME_MS, m31);
    expect(spyglass.getState().kind).toBe('open');
  });

  it('reopens a closing window on Enter from where it had got to', () => {
    const spyglass = new Spyglass();
    spyglass.onKeyDown('Enter', m31);
    hold(spyglass, OPEN_MS + FRAME_MS, m31);
    spyglass.onKeyDown('Enter', m31);
    hold(spyglass, CLOSE_MS / 4, m31);
    const fovClosing = spyglass.view()!.fovDeg;
    spyglass.onKeyDown('Enter', m31);
    expect(spyglass.getState().kind).toBe('open');
    expect(spyglass.view()!.fovDeg).toBeCloseTo(fovClosing, 6);
    // Reopened by hand, the stare is not held against it.
    hold(spyglass, OPEN_MS + FRAME_MS, m31);
    expect(spyglass.view()!.fovDeg).toBeCloseTo(framingDeg(m31), 6);
  });

  it('zooms the open window by KEY_ZOOM_FACTOR a press, within bounds', () => {
    const spyglass = new Spyglass();
    spyglass.onKeyDown('Enter', m31);
    hold(spyglass, OPEN_MS + FRAME_MS, m31);
    spyglass.onKeyDown('+', m31);
    expect(spyglass.view()!.fovDeg).toBeCloseTo(framingDeg(m31) / KEY_ZOOM_FACTOR, 6);
    spyglass.onKeyDown('-', m31);
    spyglass.onKeyDown('_', m31);
    expect(spyglass.view()!.fovDeg).toBeCloseTo(framingDeg(m31) * KEY_ZOOM_FACTOR, 6);
    for (let press = 0; press < 100; press++) spyglass.onKeyDown('=', m31);
    expect(spyglass.view()!.fovDeg).toBe(MIN_FRAMING_DEG);
    for (let press = 0; press < 100; press++) spyglass.onKeyDown('-', m31);
    expect(spyglass.view()!.fovDeg).toBe(SPYGLASS_DEG);
  });

  it('opens on + when shut, takes every zoom key, and leaves the rest to the look', () => {
    const spyglass = new Spyglass();
    expect(spyglass.onKeyDown('-', m31)).toBe(true);
    expect(spyglass.getState().kind).toBe('idle');
    expect(spyglass.onKeyDown('+', m31)).toBe(true);
    expect(spyglass.getState().kind).toBe('open');
    for (const key of ['ArrowLeft', 'ArrowUp', 'r', 'R', 'a']) expect(spyglass.onKeyDown(key, m31)).toBe(false);
  });

  it('opens at once on a nod at a name', () => {
    const spyglass = new Spyglass();
    spyglass.deeper(m31);
    expect(spyglass.getState()).toMatchObject({ kind: 'open', target: { name: 'M31' } });
  });

  it('opens on a nod the name held still on just before it, the nod having moved the view off', () => {
    const spyglass = new Spyglass();
    hold(spyglass, 200, m31);
    hold(spyglass, RECENT_MS / 2, null, turned(10));
    spyglass.deeper(null);
    expect(spyglass.getState()).toMatchObject({ kind: 'open', target: { name: 'M31' } });
  });

  it('does nothing on a nod at bare sky long after a name', () => {
    const spyglass = new Spyglass();
    hold(spyglass, 200, m31);
    hold(spyglass, RECENT_MS + 100, null, turned(10));
    spyglass.deeper(null);
    expect(spyglass.getState().kind).toBe('idle');
  });

  it('goes a level deeper on each nod, and a shake backs out a level, then closes', () => {
    const spyglass = new Spyglass();
    spyglass.deeper(m31);
    hold(spyglass, OPEN_MS + FRAME_MS, m31);
    spyglass.deeper(m31);
    spyglass.deeper(m31);
    expect(spyglass.view()!.fovDeg).toBeCloseTo(framingDeg(m31) / NOD_ZOOM_FACTOR ** 2, 6);
    spyglass.back();
    expect(spyglass.view()!.fovDeg).toBeCloseTo(framingDeg(m31) / NOD_ZOOM_FACTOR, 6);
    spyglass.back();
    expect(spyglass.view()!.fovDeg).toBeCloseTo(framingDeg(m31), 6);
    expect(spyglass.getState().kind).toBe('open');
    spyglass.back();
    expect(spyglass.getState().kind).toBe('closing');
    // Closed by a shake, it stays shut on that name like one closed by key.
    hold(spyglass, CLOSE_MS + 2 * DWELL_MS, m31);
    expect(spyglass.getState().kind).toBe('idle');
  });

  it('counts no level a nod could not go: the deepest zoom, then one shake backs out', () => {
    const spyglass = new Spyglass();
    spyglass.deeper(m31);
    hold(spyglass, OPEN_MS + FRAME_MS, m31);
    for (let nod = 0; nod < 20; nod++) spyglass.deeper(m31);
    expect(spyglass.view()!.fovDeg).toBe(MIN_FRAMING_DEG);
    const levels = (spyglass.getState() as { depth: number }).depth;
    expect(levels).toBe(Math.ceil(Math.log2(framingDeg(m31) / MIN_FRAMING_DEG)));
    for (let shake = 0; shake < levels; shake++) spyglass.back();
    expect(spyglass.getState().kind).toBe('open');
    spyglass.back();
    expect(spyglass.getState().kind).toBe('closing');
  });

  it('refuses the name just stared at on a shake, until the view leaves it', () => {
    const spyglass = new Spyglass();
    hold(spyglass, DWELL_MS / 2, m31);
    // The shake's own motion broke the stare before it was seen.
    spyglass.update(turned(12), null, FRAME_MS);
    spyglass.back();
    hold(spyglass, 3 * DWELL_MS, m31);
    expect(spyglass.getState().kind).toBe('idle');
    hold(spyglass, 2 * FRAME_MS, null);
    hold(spyglass, DWELL_MS + FRAME_MS, m31);
    expect(spyglass.getState().kind).toBe('open');
  });

  it('zooms with the head rolled: right to magnify, left to widen, from its roll when it opened', () => {
    const DEG = Math.PI / 180;
    const rolled = (deg: number): THREE.Quaternion =>
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 1.1, 0.2, 'YXZ')).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), deg * DEG));
    const spyglass = new Spyglass();
    // Shut, a roll does nothing.
    spyglass.tilt(rolled(-40), FRAME_MS);
    spyglass.deeper(m31);
    hold(spyglass, OPEN_MS + FRAME_MS, m31);
    // Opened with the head already tipped 10° left: that is level for the zoom.
    spyglass.tilt(rolled(10), FRAME_MS);
    for (let t = 0; t < 1000; t += FRAME_MS) spyglass.tilt(rolled(10 + ROLL_DEAD_ZONE_DEG - 1), FRAME_MS);
    expect(spyglass.view()!.fovDeg).toBeCloseTo(framingDeg(m31), 9);
    // A full roll right for one second: ROLL_MAX_DOUBLINGS_PER_S of magnification.
    for (let t = 0; t < 1000; t += 10) spyglass.tilt(rolled(10 - ROLL_FULL_DEG - 5), 10);
    expect(spyglass.view()!.fovDeg).toBeCloseTo(framingDeg(m31) / 2 ** ROLL_MAX_DOUBLINGS_PER_S, 6);
    // And left as far, back.
    for (let t = 0; t < 1000; t += 10) spyglass.tilt(rolled(10 + ROLL_FULL_DEG + 5), 10);
    expect(spyglass.view()!.fovDeg).toBeCloseTo(framingDeg(m31), 6);
  });

  it('rolls faster the further past the dead zone, to the most at ROLL_FULL_DEG', () => {
    const rad = THREE.MathUtils.degToRad;
    expect(rollZoomDoublingsPerS(rad(ROLL_DEAD_ZONE_DEG))).toBeCloseTo(0, 12);
    expect(rollZoomDoublingsPerS(rad(-(ROLL_DEAD_ZONE_DEG + ROLL_FULL_DEG) / 2))).toBeCloseTo(ROLL_MAX_DOUBLINGS_PER_S / 2, 9);
    expect(rollZoomDoublingsPerS(rad(-90))).toBe(ROLL_MAX_DOUBLINGS_PER_S);
    expect(rollZoomDoublingsPerS(rad(90))).toBe(-ROLL_MAX_DOUBLINGS_PER_S);
  });

  it('frames an object by its size, a point by the default, within bounds', () => {
    expect(framingDeg(target('point', null))).toBe(DEFAULT_FRAMING_DEG);
    expect(framingDeg(target('M31', 3))).toBeCloseTo(4.8);
    expect(framingDeg(target('tiny', 0.001))).toBe(MIN_FRAMING_DEG);
    expect(framingDeg(target('huge', 90))).toBe(SPYGLASS_DEG);
  });
});
