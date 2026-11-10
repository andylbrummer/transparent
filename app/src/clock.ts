/**
 * The app clock. Wall time, unless the page was opened with
 * ?time=<ISO 8601>: then that instant, running forward at the real rate -
 * so a screenshot or a check against an almanac can pin the sky.
 */

export interface AppClock {
  now(): Date;
  /** True when ?time= pinned the start. */
  readonly pinned: boolean;
}

export function createClock(search: string, wallNow: () => number = Date.now): AppClock {
  const requested = new URLSearchParams(search).get('time');
  const start = requested === null ? NaN : Date.parse(requested);
  if (Number.isNaN(start)) {
    if (requested !== null) console.error(`ignoring unreadable ?time=${requested}`);
    return { now: () => new Date(wallNow()), pinned: false };
  }
  const openedAt = wallNow();
  return { now: () => new Date(start + (wallNow() - openedAt)), pinned: true };
}
