/**
 * What voice control is doing, on screen: listening (with what it has
 * heard so far), its reply, or what went wrong. On the phone one line
 * near the foot of the screen; in Cardboard one per eye, each under its
 * eye's convergence spot so the two read as one.
 */

import type { VoiceStatus } from './voice-control';

/** A reply or error stays up this long after it is shown. */
export const VOICE_REPLY_MS = 4000;

export class VoiceOverlay {
  private readonly element: HTMLElement;
  private readonly readouts: HTMLElement[];
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private placedKey = '';

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.id = 'voice-status';
    this.element.hidden = true;
    this.element.setAttribute('role', 'status');
    this.readouts = [0, 1].map(() => {
      const readout = document.createElement('div');
      readout.className = 'voice-status__readout';
      this.element.appendChild(readout);
      return readout;
    });
    // The right eye's copy repeats the left: read once.
    this.readouts[1].setAttribute('aria-hidden', 'true');
    parent.appendChild(this.element);
  }

  show(status: VoiceStatus): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (status.state === 'idle') {
      this.element.hidden = true;
      return;
    }
    const text = status.state === 'listening' ? `Listening… ${status.heard}`.trim() : status.text;
    for (const readout of this.readouts) readout.textContent = text;
    this.element.dataset.state = status.state;
    this.element.hidden = false;
    if (status.state !== 'listening') {
      this.hideTimer = setTimeout(() => {
        this.element.hidden = true;
        this.hideTimer = null;
      }, VOICE_REPLY_MS);
    }
  }

  isShown(): boolean {
    return !this.element.hidden;
  }

  /** Place the readouts on a screen width×height CSS px: one, or in stereo one per eye, `spacingPx` apart. */
  place(stereo: boolean, width: number, height: number, spacingPx: number): void {
    const key = `${stereo}:${width}:${height}:${Math.round(spacingPx)}`;
    if (key === this.placedKey) return;
    this.placedKey = key;
    const top = `${Math.round(height * (stereo ? 0.7 : 0.82))}px`;
    const lefts = stereo ? [width / 2 - spacingPx / 2, width / 2 + spacingPx / 2] : [width / 2];
    this.readouts.forEach((readout, i) => {
      readout.hidden = i >= lefts.length;
      readout.style.left = `${lefts[i] ?? 0}px`;
      readout.style.top = top;
      readout.style.maxWidth = `${Math.round(stereo ? spacingPx * 0.9 : width * 0.8)}px`;
    });
  }

  dispose(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.element.remove();
  }
}
