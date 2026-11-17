/**
 * The ease that turns the manual view from one aim to another. A guide
 * that jumped the view would leave the user not knowing which way they
 * had turned; the turn has to be seen. It is a pure function of the two
 * aims and the time, so it is tested without a camera or a clock.
 *
 * It turns the shorter way round in azimuth and straight in altitude,
 * not along a great circle. The camera has yaw and pitch but no roll, so
 * a great circle over the zenith or straight down, which needs the pitch
 * to pass 90°, is a path it cannot follow.
 */

/** Where the manual view points and how wide it is. */
export interface Aim {
  /** Clockwise from north. Not wrapped: an ease may pass 360 on its way round. */
  readonly azDeg: number;
  /** Above the horizon, -90 to 90. */
  readonly altDeg: number;
  readonly fovDeg: number;
}

/** A turn of 90° or less takes this long. */
export const EASE_MIN_MS = 1500;
/** A longer turn goes at this rate. */
export const EASE_DEG_PER_S = 60;

export interface AimEase {
  readonly durationMs: number;
  /** The aim `elapsedMs` into the ease: `from` at 0 or before, the end from `durationMs` on. */
  at(elapsedMs: number): Aim;
}

const DEG = Math.PI / 180;

/** The ease from one aim to another: the shorter way round, in and out gently. */
export function easeAim(from: Aim, to: Aim): AimEase {
  // Into (-180, 180]: exactly half a turn goes clockwise, so the way never flips between calls.
  let azDelta = (((to.azDeg - from.azDeg) % 360) + 360) % 360;
  if (azDelta > 180) azDelta -= 360;
  const end: Aim = { azDeg: from.azDeg + azDelta, altDeg: to.altDeg, fovDeg: to.fovDeg };
  const altDelta = to.altDeg - from.altDeg;
  const fovRatio = to.fovDeg / from.fovDeg;

  const still = azDelta === 0 && altDelta === 0 && fovRatio === 1;
  const durationMs = still ? 0 : Math.max(EASE_MIN_MS, (turnDeg(from, to) / EASE_DEG_PER_S) * 1000);

  return {
    durationMs,
    at(elapsedMs) {
      if (elapsedMs >= durationMs) return end;
      if (elapsedMs <= 0) return from;
      const t = elapsedMs / durationMs;
      // Smoothstep: starts and stops gently, so the turn reads as a turn rather than a lurch.
      const e = t * t * (3 - 2 * t);
      return {
        azDeg: from.azDeg + azDelta * e,
        altDeg: from.altDeg + altDelta * e,
        // Evenly in log scale, as the spyglass opens: a zoom feels steady from wide to narrow.
        fovDeg: from.fovDeg * fovRatio ** e,
      };
    },
  };
}

/** The angle between the two aims' directions, degrees. */
function turnDeg(from: Aim, to: Aim): number {
  const a1 = from.altDeg * DEG;
  const a2 = to.altDeg * DEG;
  const cos = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos((to.azDeg - from.azDeg) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / DEG;
}
