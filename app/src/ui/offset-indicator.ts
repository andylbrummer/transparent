/**
 * How far a drag has moved the view off where the phone points, shown on the Reset button: the heading nudge across
 * and the tilt nudge up and down, in whole degrees, so the viewer knows the picture is not the phone's own aim and by
 * how much. While a drag aims the view (no attitude) there is no phone aim to be off from, and the button says only
 * what it does.
 */

const DEG = 180 / Math.PI;
export const RESET_LABEL = 'Reset offset';

/** The offset in words, or the plain label when there is none. Heading counter-clockwise positive, tilt up positive. */
export function offsetLabel(headingDeg: number, tiltDeg: number): string {
  if (headingDeg === 0 && tiltDeg === 0) return RESET_LABEL;
  const across = `${headingDeg > 0 ? '←' : headingDeg < 0 ? '→' : '↔'} ${String(Math.abs(headingDeg))}°`;
  const upDown = `${tiltDeg > 0 ? '↑' : tiltDeg < 0 ? '↓' : '↕'} ${String(Math.abs(tiltDeg))}°`;
  return `${across}  ${upDown} · Reset`;
}

/** Whole degrees in -179..180: a heading nudge may have gone round more than once. */
function wrappedDegrees(rad: number): number {
  const deg = Math.round(rad * DEG) % 360;
  if (deg > 180) return deg - 360;
  if (deg <= -180) return deg + 360;
  return deg;
}

export class OffsetIndicator {
  private headingDeg = 0;
  private tiltDeg = 0;

  constructor(private readonly button: HTMLElement) {
    button.textContent = RESET_LABEL;
  }

  /** Called every frame: touches the button only when a whole degree changes. */
  update(phoneAims: boolean, headingNudgeRad: number, tiltNudgeRad: number): void {
    const heading = phoneAims ? wrappedDegrees(headingNudgeRad) : 0;
    const tilt = phoneAims ? Math.round(tiltNudgeRad * DEG) : 0;
    if (heading === this.headingDeg && tilt === this.tiltDeg) return;
    this.headingDeg = heading;
    this.tiltDeg = tilt;
    this.button.textContent = offsetLabel(heading, tilt);
    this.button.classList.toggle('reset-offset--off', heading !== 0 || tilt !== 0);
  }
}
