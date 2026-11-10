/**
 * The earthquakes the wave playback offers.
 *
 * Nothing here is typed in: hypocentres and origin times come from the
 * files the earthquake layers already use - app/public/geo/quakes-notable.json
 * (USGS ComCat, audited in docs/data-sources/earthquakes.md) for the presets
 * of spec/seismic.md, the wave bake's own two deep events (ComCat, by event
 * id), and the live USGS feed for the latest large one. Only the short
 * names in the picker are ours.
 */

import type { EventRecord } from '@transparent-earth/core';
import type { NotableQuakeData } from '../quakes-notable/notable';
import type { BakedEvent } from './data';

export interface WaveEvent extends EventRecord {
  /** Short stable id, also what ?quake= takes: 'tohoku2011', 'latest' ... */
  readonly key: string;
  /** What the picker shows. */
  readonly label: string;
}

/** The presets of spec/seismic.md, by ComCat event id as in quakes-notable.json. */
export const PRESETS: readonly { readonly key: string; readonly comcatId: string; readonly label: string }[] = [
  { key: 'tohoku2011', comcatId: 'official20110311054624120_30', label: 'Tōhoku, Japan 2011' },
  { key: 'sumatra2004', comcatId: 'official20041226005853450_30', label: 'Sumatra–Andaman 2004' },
  { key: 'valdivia1960', comcatId: 'official19600522191120_30', label: 'Valdivia, Chile 1960' },
  { key: 'sanfrancisco1906', comcatId: 'official19060418131226300_12', label: 'San Francisco 1906' },
  { key: 'turkiye2023', comcatId: 'us6000jllz', label: 'Türkiye–Syria 2023' },
];

/** The deep events baked with the rays, by ComCat event id. */
export const DEEP_PRESETS: readonly { readonly key: string; readonly comcatId: string; readonly label: string }[] = [
  { key: 'okhotsk2013', comcatId: 'usb000h4jh', label: 'Sea of Okhotsk 2013' },
  { key: 'bolivia1994', comcatId: 'usp0006dzc', label: 'Bolivia 1994' },
];

/** The live entry is offered for earthquakes at least this large. */
export const LATEST_MIN_MAGNITUDE = 6;
export const LATEST_KEY = 'latest';

function describe(label: string, mag: number, depthKm: number): string {
  // Depth is part of the name only where it is the point of the example.
  const deep = depthKm >= 300 ? ` · ${Math.round(depthKm)} km deep` : '';
  return `${label} · M${mag.toFixed(1)}${deep}`;
}

/** The fixed list: the spec's presets, then the deep events. A preset missing from the data is left out. */
export function presetEvents(notable: NotableQuakeData, deep: readonly BakedEvent[]): WaveEvent[] {
  const events: WaveEvent[] = [];
  for (const preset of PRESETS) {
    const quake = notable.events.find((event) => event.id === preset.comcatId);
    if (quake) events.push({ ...quake, key: preset.key, label: describe(preset.label, quake.mag, quake.depthKm) });
  }
  for (const preset of DEEP_PRESETS) {
    const quake = deep.find((event) => event.id === preset.comcatId);
    if (quake) events.push({ ...quake, key: preset.key, label: describe(preset.label, quake.mag, quake.depthKm) });
  }
  return events;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number): string => String(n).padStart(2, '0');

/** "11 Mar 2011, 05:46:24 UTC". */
export function originText(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} UTC`;
}

/**
 * The latest earthquake of at least LATEST_MIN_MAGNITUDE in the live feed
 * that has happened by `nowMs` (the app clock), as a picker entry; null if
 * the feed holds none.
 */
export function latestLargeEvent(events: readonly EventRecord[], nowMs: number): WaveEvent | null {
  let latest: EventRecord | null = null;
  for (const event of events) {
    const t = Date.parse(event.time);
    if (event.mag < LATEST_MIN_MAGNITUDE || t > nowMs) continue;
    if (!latest || t > Date.parse(latest.time)) latest = event;
  }
  if (!latest) return null;
  const d = new Date(latest.time);
  const when = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return { ...latest, key: LATEST_KEY, label: `Latest M6+: M${latest.mag.toFixed(1)} ${latest.name} (${when})` };
}
