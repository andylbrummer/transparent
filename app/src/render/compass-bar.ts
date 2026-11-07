/**
 * Compass tape across the top of the screen: which way the view faces.
 *
 * The tape spans a fixed TAPE_SPAN_DEG across the screen, wider than any
 * phone's field of view (a portrait phone sees ~30°), so cardinal points
 * are always on it. A bracket marks the slice the camera actually sees. It
 * follows the camera, not the raw compass, so drag nudges and manual aim
 * move it too.
 */

import * as THREE from 'three';
import { enuBasis } from '@transparent-earth/core';
import type { SurfacePosition } from '../sensors';

const POINTS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const CARDINALS: Readonly<Record<number, string>> = {
  0: 'N',
  45: 'NE',
  90: 'E',
  135: 'SE',
  180: 'S',
  225: 'SW',
  270: 'W',
  315: 'NW',
};
/** Bearing span across the full screen width: N/E/S/W are 90° apart, so one always shows. */
export const TAPE_SPAN_DEG = 180;
const TICK_STEP_DEG = 15;
const LABEL_STEP_DEG = 30;
const DEG = Math.PI / 180;

/**
 * Bearing the view faces, degrees clockwise from true north.
 *
 * Uses forward - (forward·up)·cameraUp: for an unrolled view that is
 * exactly the forward bearing, and as the view tips straight down (or up)
 * it hands over to the screen's top (or bottom) edge, so looking through
 * the Earth still has a heading instead of a degenerate one.
 */
export function viewBearingDeg(
  forward: THREE.Vector3,
  cameraUp: THREE.Vector3,
  east: THREE.Vector3,
  north: THREE.Vector3,
  up: THREE.Vector3
): number {
  const tip = forward.dot(up);
  const x = forward.dot(east) - tip * cameraUp.dot(east);
  const y = forward.dot(north) - tip * cameraUp.dot(north);
  return normalizeDegrees(Math.atan2(x, y) / DEG);
}

/** Signed shortest turn from `heading` to `bearing`, in (-180, 180]. */
export function bearingOffsetDeg(bearing: number, heading: number): number {
  const delta = normalizeDegrees(bearing - heading);
  return delta > 180 ? delta - 360 : delta;
}

/** 16-point name of a bearing, e.g. 293 -> "WNW". */
export function compassPoint(bearing: number): string {
  return POINTS_16[Math.round(normalizeDegrees(bearing) / 22.5) % 16];
}

/** Horizontal field of view in degrees for a vertical one and an aspect. */
export function horizontalFovDeg(verticalFovDeg: number, aspect: number): number {
  return (2 * Math.atan(aspect * Math.tan((verticalFovDeg * DEG) / 2))) / DEG;
}

function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

interface Tick {
  readonly bearing: number;
  readonly element: HTMLElement;
  visible: boolean;
}

export class CompassBar {
  private readonly root: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly fovBracket: HTMLElement;
  private readonly ticks: Tick[] = [];
  private readonly forward = new THREE.Vector3();
  private readonly cameraUp = new THREE.Vector3();
  private readonly east = new THREE.Vector3();
  private readonly north = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private bearing: number | null = null;
  private lastLayoutKey = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'compass-bar';
    const tape = document.createElement('div');
    tape.className = 'compass-bar__tape';
    for (let bearing = 0; bearing < 360; bearing += TICK_STEP_DEG) {
      const element = document.createElement('div');
      const cardinal = CARDINALS[bearing];
      const labelled = cardinal !== undefined || bearing % LABEL_STEP_DEG === 0;
      element.className = `compass-tick${cardinal ? ' compass-tick--cardinal' : labelled ? ' compass-tick--major' : ''}`;
      if (labelled) {
        const text = document.createElement('span');
        text.textContent = cardinal ?? String(bearing);
        element.appendChild(text);
      }
      if (bearing === 0) element.classList.add('compass-tick--north');
      element.style.display = 'none';
      tape.appendChild(element);
      this.ticks.push({ bearing, element, visible: false });
    }
    this.fovBracket = document.createElement('div');
    this.fovBracket.className = 'compass-bar__fov';
    const caret = document.createElement('div');
    caret.className = 'compass-bar__caret';
    this.readout = document.createElement('div');
    this.readout.className = 'compass-bar__readout';
    this.root.append(this.fovBracket, tape, caret, this.readout);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  /** Bearing the view faced at the last update, or null before one. Instrumentation. */
  getBearing(): number | null {
    return this.bearing;
  }

  /** Lay the tape out for this frame's camera, in a viewport `width` CSS px wide. */
  update(camera: THREE.PerspectiveCamera, position: SurfacePosition, width: number): void {
    const enu = enuBasis({ lat: position.lat, lon: position.lon, alt: 0 });
    this.east.set(enu.e.x, enu.e.y, enu.e.z);
    this.north.set(enu.n.x, enu.n.y, enu.n.z);
    this.up.set(enu.u.x, enu.u.y, enu.u.z);
    this.forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const bearing = viewBearingDeg(this.forward, this.cameraUp, this.east, this.north, this.up);
    this.bearing = bearing;

    const pxPerDeg = width / TAPE_SPAN_DEG;
    const fovPx = Math.min(width, horizontalFovDeg(camera.fov, camera.aspect) * pxPerDeg);
    // The phone never holds perfectly still: skip DOM writes for sub-pixel change.
    const layoutKey = `${(bearing * pxPerDeg).toFixed(0)}|${fovPx.toFixed(0)}|${width}`;
    if (layoutKey === this.lastLayoutKey) return;
    this.lastLayoutKey = layoutKey;

    const half = width / 2;
    this.fovBracket.style.width = `${fovPx.toFixed(1)}px`;
    this.fovBracket.style.transform = `translateX(${(half - fovPx / 2).toFixed(1)}px)`;
    for (const tick of this.ticks) {
      const x = half + bearingOffsetDeg(tick.bearing, bearing) * pxPerDeg;
      const show = x > -40 && x < width + 40;
      if (show) tick.element.style.transform = `translateX(${x.toFixed(1)}px)`;
      if (show !== tick.visible) {
        tick.element.style.display = show ? '' : 'none';
        tick.visible = show;
      }
    }
    this.readout.textContent = `${Math.round(bearing) % 360}° ${compassPoint(bearing)}`;
  }

  dispose(): void {
    this.root.remove();
  }
}
