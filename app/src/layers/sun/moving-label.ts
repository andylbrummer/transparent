/**
 * One sky label whose text or drop below its point changes now and then:
 * the Moon's phase, the Sun's name stepping clear of its growing disc.
 *
 * Label groups are fixed once added, so a change swaps the group for a
 * new one - rare enough (minutes apart, or on a zoom) to cost nothing.
 */

import * as THREE from 'three';
import type { LabelGroup, LabelStyle } from '../../render/labels';
import type { LayerContext } from '../types';

export class MovingLabel {
  /** Unit ICRS direction of the label's point: write to move it. */
  readonly position = new THREE.Vector3();
  private group: LabelGroup | null = null;
  private text = '';
  private offsetYPx = NaN;
  private visible = false;

  constructor(
    private readonly context: LayerContext,
    private readonly rank: number,
    private readonly style: Omit<LabelStyle, 'offsetYPx'>,
    /** Lower wins when labels collide. */
    private readonly priority = 0
  ) {}

  /** Show `text` (empty: nothing) dropped `offsetYPx` below the point. */
  set(text: string, offsetYPx: number): void {
    if (text === this.text && offsetYPx === this.offsetYPx) return;
    this.text = text;
    this.offsetYPx = offsetYPx;
    this.group?.remove();
    this.group = null;
    if (text === '') return;
    this.group = this.context.addLabels({
      rank: this.rank,
      style: { ...this.style, offsetYPx },
      frame: 'sky',
      labels: [{ text, priority: this.priority, position: this.position }],
    });
    this.group.setVisible(this.visible);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.group?.setVisible(visible);
  }

  dispose(): void {
    this.group?.remove();
    this.group = null;
  }
}

/**
 * How far below a disc's centre its name goes, CSS px: clear of the disc
 * (or of the glow that stands for it when small), in steps so that a slow
 * zoom does not rebuild the label every frame.
 */
export function labelDropPx(discPx: number, minimumPx: number): number {
  const STEP = 4;
  return Math.max(minimumPx, Math.ceil((discPx / 2 + 12) / STEP) * STEP);
}
