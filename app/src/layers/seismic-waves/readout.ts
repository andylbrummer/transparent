/**
 * What the playback control says about a place - where the user stands, or
 * the earthquake's antipode: which wave comes next and when, the timetable,
 * and the line shown while a wave is passing.
 */

import { formatClock, formatDuration } from '../../ui/timeline';
import type { Arrival } from './data';

/** The waves a person tells apart: the first P of any kind, the first S, and each surface wave. */
export function headlineArrivals(arrivals: readonly Arrival[]): Arrival[] {
  const seen = new Set<string>();
  const out: Arrival[] = [];
  for (const arrival of arrivals) {
    const kind = arrival.family === 'surface' ? arrival.phase : arrival.family;
    if (seen.has(kind)) continue;
    seen.add(kind);
    out.push(arrival);
  }
  return out;
}

/** "P wave", "core P wave (PKIKP)", "weak P wave bent round the core (Pdiff)". */
export function arrivalName(arrival: Arrival): string {
  if (arrival.family === 'surface') return arrival.phase;
  if (arrival.diffracted) return `weak ${arrival.family} wave bent round the core (${arrival.phase})`;
  // Through the core and out again: the P that comes back beyond the shadow.
  if (arrival.phase === 'PKP' || arrival.phase === 'PKIKP') return `core P wave (${arrival.phase})`;
  return `${arrival.family} wave`;
}

/** The short name for the timetable. */
function shortName(arrival: Arrival): string {
  if (arrival.family === 'surface') return arrival.phase.replace(' wave', '');
  return arrival.phase;
}

export interface PlaceReadout {
  /** "P wave reaches you in 11 min 42 s"; for the antipode, whose line already names it, "core P wave (PKIKP) in 8 min 03 s". */
  readonly next: string;
  /** "P 12:05 · S 22:13 · Love 39:16 · Rayleigh 46:18", times since the origin. */
  readonly timetable: string;
  /** "S wave is passing here now", while it is; else null. */
  readonly passing: string | null;
}

/**
 * @param place     'you' or 'the antipode'
 * @param passingS  for how long (seconds of wave time) an arrival counts as passing
 */
export function placeReadout(arrivals: readonly Arrival[], elapsedS: number, place: 'you' | 'the antipode', passingS: number): PlaceReadout {
  const waves = headlineArrivals(arrivals);
  const upcoming = waves.find((arrival) => arrival.timeS > elapsedS);
  const next = upcoming
    ? `${arrivalName(upcoming)}${place === 'you' ? ' reaches you' : ''} in ${formatDuration(upcoming.timeS - elapsedS)}`
    : // Not "every wave": reflections follow, and the surface waves come round the planet again.
      place === 'you'
      ? 'the first P, S and surface waves have passed you'
      : 'the first waves have passed';
  const parts = waves.map((arrival) => `${shortName(arrival)} ${formatClock(arrival.timeS)}`);
  // The teaching point of the layer: say outright where no S comes.
  if (!waves.some((arrival) => arrival.family === 'S')) parts.push('no S (core shadow)');
  let passing: string | null = null;
  for (const arrival of waves) {
    if (elapsedS >= arrival.timeS && elapsedS - arrival.timeS < passingS) {
      const name = arrivalName(arrival);
      passing = `${name[0].toUpperCase()}${name.slice(1)} is passing ${place === 'you' ? 'under you' : 'the antipode'} now`;
    }
  }
  return { next, timetable: parts.join(' · '), passing };
}
