/**
 * Meteor shower radiants: the points of the sky the year's showers appear
 * to stream from, marked where the IMO's working list puts them, and
 * brought forward - larger, brighter, named - while a shower is active by
 * the app clock.
 *
 * The list (app/public/space/meteor-showers.json, tools/pipeline/
 * generate_meteor_showers.py) gives each radiant at the shower's maximum.
 * A radiant drifts about a degree a day against the stars as the Earth
 * moves along its orbit; that drift is not applied, so early or late in a
 * long shower the mark is some degrees from the true radiant.
 *
 * A shower's maximum comes when the Earth reaches the same point of its
 * orbit each year - a solar longitude - not on a fixed calendar date, so
 * the date shown is worked out from the Sun's place for the year at hand.
 */

import * as THREE from 'three';
import { raDecToUnit, sunGeocentricAu } from '@transparent-earth/core';
import type { LabelGroup } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import { SkyPoints } from '../../render/sky-points';
import type { LayerContext, LayerInstance } from '../types';

export interface Shower {
  readonly code: string;
  readonly iau: number;
  readonly name: string;
  /** [month, day] UTC of the first and last night of activity and, for the calendar's own year, of the maximum. */
  readonly start: readonly [number, number];
  readonly end: readonly [number, number];
  readonly peak: readonly [number, number];
  /** Solar longitude of the maximum, degrees (J2000). */
  readonly solarLongitude: number;
  /** Radiant at maximum, degrees (J2000). */
  readonly ra: number;
  readonly dec: number;
  readonly speedKmS: number;
  /** Zenithal hourly rate at maximum; null where it varies from year to year. */
  readonly zhr: number | null;
}

export interface ShowerList {
  readonly year: number;
  readonly showers: readonly Shower[];
}

const DEG = Math.PI / 180;
const DAY_MS = 86400000;
/** Obliquity of the ecliptic at J2000, degrees (IAU 1976). */
const OBLIQUITY_J2000 = 23.4392911 * DEG;
/** Within this much solar longitude of the maximum - about a day - a shower is "at its peak". */
export const PEAK_WINDOW_DEG = 1;
const UPDATE_INTERVAL_MS = 60000;

/** The Sun's ecliptic longitude, degrees in [0, 360), on the J2000 ecliptic: the meteor astronomers' calendar. */
export function solarLongitude(date: Date): number {
  const sun = sunGeocentricAu(date);
  const longitude = Math.atan2(sun[1] * Math.cos(OBLIQUITY_J2000) + sun[2] * Math.sin(OBLIQUITY_J2000), sun[0]) / DEG;
  return (longitude + 360) % 360;
}

const wrap180 = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

/** Whether the date falls in the shower's activity period, which may run over New Year. */
export function isActive(shower: Shower, date: Date): boolean {
  const today = (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  const start = shower.start[0] * 100 + shower.start[1];
  const end = shower.end[0] * 100 + shower.end[1];
  return start <= end ? today >= start && today <= end : today >= start || today <= end;
}

/** The instant of the shower's maximum nearest to `date`: when the Sun reaches the shower's solar longitude. */
export function peakTime(shower: Shower, date: Date): Date {
  // The Sun moves 360° in a year: step by the remaining angle until it is there.
  let ms = date.getTime();
  for (let i = 0; i < 6; i++) ms += (wrap180(shower.solarLongitude - solarLongitude(new Date(ms))) / 360) * 365.2422 * DAY_MS;
  return new Date(ms);
}

export type ShowerState = 'quiet' | 'active' | 'peak';

export function showerState(shower: Shower, date: Date): ShowerState {
  if (Math.abs(wrap180(shower.solarLongitude - solarLongitude(date))) <= PEAK_WINDOW_DEG) return 'peak';
  return isActive(shower, date) ? 'active' : 'quiet';
}

/** "Leonids · peak 17 Nov · ZHR 15", "Geminids · at peak · ZHR 150", "June Bootids · peak 22 Jun · rate varies". */
export function showerText(shower: Shower, date: Date): string {
  const state = showerState(shower, date);
  const peak = peakTime(shower, date);
  const when = state === 'peak' ? 'at peak' : `peak ${peak.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
  return `${shower.name} · ${when} · ${shower.zhr === null ? 'rate varies' : `ZHR ${shower.zhr}`}`;
}

/** Marker size, CSS px: by the shower's usual strength, and by whether it is on. */
export function markerSizePx(shower: Shower, state: ShowerState): number {
  if (state === 'quiet') return 7;
  const strength = Math.log10(Math.max(shower.zhr ?? 5, 2)) / Math.log10(150);
  return (state === 'peak' ? 16 : 11) + 10 * strength;
}

export async function createMeteorShowersLayer(context: LayerContext): Promise<LayerInstance> {
  const list = await context.fetchJson<ShowerList>(context.assetUrl('space/meteor-showers.json'));
  const showers = list.showers;
  const count = showers.length;
  const directions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const alphas = new Float32Array(count);
  const points = showers.map((shower, i) => {
    const unit = raDecToUnit(shower.ra, shower.dec);
    directions.set(unit, i * 3);
    return new THREE.Vector3(unit[0], unit[1], unit[2]);
  });
  const markers = new SkyPoints(directions, sizes, colors, context.skyUniforms, { name: 'meteor-radiants', shape: 'cross', renderOrder: RENDER_ORDER.sky + 0.015 }, alphas);
  context.skyRoot.add(markers.object);
  const attribute = (name: string): THREE.BufferAttribute => markers.object.geometry.getAttribute(name) as THREE.BufferAttribute;

  let labels: LabelGroup | null = null;
  let texts = '';
  let visible = false;
  let lastMs = NaN;

  return {
    setVisible(next) {
      visible = next;
      markers.object.visible = next;
      labels?.setVisible(next);
    },
    update(frame) {
      const ms = frame.date.getTime();
      if (Math.abs(ms - lastMs) < UPDATE_INTERVAL_MS) return;
      lastMs = ms;
      const named: { text: string; priority: number; position: THREE.Vector3 }[] = [];
      let active = 0;
      let peaking = '';
      showers.forEach((shower, i) => {
        const state = showerState(shower, frame.date);
        sizes[i] = markerSizePx(shower, state);
        alphas[i] = state === 'quiet' ? 0.28 : state === 'active' ? 0.8 : 1;
        colors.set(state === 'peak' ? [1, 0.95, 0.55] : [0.72, 1, 0.75], i * 3);
        if (state === 'quiet') return;
        active++;
        if (state === 'peak') peaking = shower.name;
        // The strongest first; one at its peak ahead of all.
        named.push({ text: showerText(shower, frame.date), priority: (state === 'peak' ? 0 : 1000) - (shower.zhr ?? 5), position: points[i] });
      });
      for (const name of ['aSize', 'aAlpha', 'aColor']) attribute(name).needsUpdate = true;
      const joined = named.map((label) => label.text).join('|');
      if (joined !== texts) {
        texts = joined;
        labels?.remove();
        // Just ahead of the constellation names (6.36), and above the mark: star names hang below theirs.
        labels = context.addLabels({ rank: 6.355, style: { fontPx: 10, color: '#c8ffd0', italic: true, offsetYPx: -15 }, frame: 'sky', labels: named });
        labels.setVisible(visible);
      }
      context.setStatus(active === 0 ? 'no shower active on the shown date' : peaking !== '' ? `${peaking} at peak · ${active} active` : `${active} active`, 'info');
    },
    dispose() {
      markers.dispose();
      labels?.remove();
    },
  };
}
