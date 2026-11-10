/**
 * The geological time scale: which period and epoch an age falls in, by
 * the International Chronostratigraphic Chart
 * (app/public/geo/deep-time/timescale.json, baked from the ICS's own
 * machine-readable chart by tools/pipeline/generate_deep_time.py).
 */

export type TimeRank = 'eon' | 'era' | 'period' | 'epoch';

export interface TimeUnit {
  readonly name: string;
  readonly rank: TimeRank;
  /** Ma; begin is the older boundary. */
  readonly begin: number;
  readonly end: number;
  /** The chart's colour for the unit, #RRGGBB. */
  readonly color: string;
}

export interface TimeScale {
  readonly source: string;
  /** Chart version, e.g. "2024/12". */
  readonly version: string;
  readonly units: readonly TimeUnit[];
}

/** The unit of `rank` holding `ageMa`; a boundary age belongs to the younger unit. */
export function unitAt(scale: TimeScale, rank: TimeRank, ageMa: number): TimeUnit | null {
  for (const unit of scale.units) {
    if (unit.rank === rank && ageMa >= unit.end && ageMa < unit.begin) return unit;
  }
  return null;
}

/**
 * The chart names rock: "Upper Jurassic" is a series, strata lying above
 * the Middle Jurassic. The same span as time is the Late Jurassic epoch -
 * the chart's own convention (its column is headed "Series / Epoch").
 */
export function epochName(seriesName: string): string {
  return seriesName.replace(/^Upper /, 'Late ').replace(/^Lower /, 'Early ');
}

/** "Late Jurassic", "Eocene · Paleogene", "Tonian": the name a reader knows the age by. */
export function describeAge(scale: TimeScale, ageMa: number): string {
  if (ageMa <= 0) return 'today';
  const period = unitAt(scale, 'period', ageMa);
  const epoch = unitAt(scale, 'epoch', ageMa);
  if (!period) return unitAt(scale, 'eon', ageMa)?.name ?? '';
  if (!epoch) return period.name;
  const name = epochName(epoch.name);
  // "Late Jurassic" already says its period; "Eocene" does not.
  return name.includes(period.name) ? name : `${name} · ${period.name}`;
}

/**
 * A CSS gradient of hard-edged bands, one per period in the chart's
 * colours, for a track that runs from `maxMa` on the left to today on the right.
 */
export function periodGradient(scale: TimeScale, maxMa: number): string {
  const periods = scale.units.filter((u) => u.rank === 'period' && u.end < maxMa).sort((a, b) => b.end - a.end);
  const percent = (ageMa: number): string => `${(((maxMa - Math.min(ageMa, maxMa)) / maxMa) * 100).toFixed(2)}%`;
  const stops = periods.map((u) => `${u.color} ${percent(u.begin)} ${percent(u.end)}`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
