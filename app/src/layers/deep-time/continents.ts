/**
 * Continents through time: the coastlines and continental blocks of a
 * global plate model, moved to where the model puts them at an age the
 * user picks, from today back to 1,000 Ma.
 *
 * Data: app/public/geo/deep-time/plates.bin and timescale.json
 * (tools/pipeline/generate_deep_time.py; Merdith et al. 2021, and the ICS
 * chart). The model is in a palaeomagnetic reference frame - positions are
 * relative to the spin axis, so latitudes are real palaeolatitudes and
 * longitudes are the model's choice.
 *
 * Today's map stays underneath, so India is seen leaving Africa and
 * crossing to where Asia is known to be. The ground the user stands on is
 * followed too: a marker where the model puts it at the age shown, the
 * path it took since, and its latitude then in the control.
 *
 * This is deep time, not the app clock: the sky, the weather and the live
 * layers stay at now.
 */

import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { LABEL_KIND_ORDER, type LabelGroup } from '../../render/labels';
import { RENDER_ORDER } from '../../render/order';
import type { FrameState, LayerContext, LayerInstance } from '../types';
import { ALWAYS, PlateShapes } from './plate-shapes';
import {
  crustAt,
  formatLatitude,
  parsePlateFile,
  plateQuaternion,
  rotateInPlace,
  unitFromLonLat,
  type CrustUnderfoot,
  type PlateBlock,
  type PlateModel,
} from './plates-data';
import { TimeControl } from './time-control';
import { describeAge, periodGradient, unitAt, type TimeScale } from './timescale';

/**
 * The great assemblies, named where the model's own paper names them, for
 * the ages it gives (Merdith et al. 2021, Earth-Science Reviews 214,
 * 103477): "Early Tonian until Rodinia breakup (1000-750 Ma)", with the
 * ocean that opened as Rodinia broke up separating "Laurentia from North
 * China, Australia and Antarctica" (§6.1.1); "Gondwana (South America,
 * Africa, India, Antarctica and Australia)" with its own polar wander path
 * for 540-320 Ma, assembled by 520 Ma (§6.1.2); "Laurussia (Baltica,
 * Laurentia and Avalonia)", placed at 410 Ma and colliding with Gondwana
 * "during the Late Carboniferous", 320 Ma, to make Pangea, whose breakup
 * spans "the last ca. 200 Ma"; and "the ocean surrounding Gondwana as the
 * Panthalassic Ocean ('Panthalassa', ca. 520-200 Ma)".
 *
 * A name's position is not from any table: it is the middle of its
 * members where the model has them at the age shown (for the ocean, the
 * point opposite).
 */
export interface Assembly {
  readonly name: string;
  /** Ages it is named between, Ma (older first). */
  readonly from: number;
  readonly to: number;
  /** Plate IDs of the members whose middle places the name. */
  readonly plates: readonly number[];
  /** Place the name opposite its members: an ocean defined by the land it surrounds. */
  readonly opposite?: boolean;
}

const LAURENTIA = 101;
const BALTICA = 302;
const GONDWANA = [201, 701, 501, 802, 801];

export const ASSEMBLIES: readonly Assembly[] = [
  { name: 'Rodinia', from: 1000, to: 750, plates: [LAURENTIA, 801, 802] },
  { name: 'Gondwana', from: 520, to: 320, plates: GONDWANA },
  { name: 'Laurussia', from: 410, to: 320, plates: [LAURENTIA, BALTICA] },
  { name: 'Pangaea', from: 320, to: 200, plates: [LAURENTIA, BALTICA, ...GONDWANA] },
  { name: 'Panthalassa', from: 520, to: 200, plates: GONDWANA, opposite: true },
];

const scratchQ = new Float32Array(4);
const scratchV = [0, 0, 0];

/** Where the model has a named block's label point at `ageMa`: a unit vector into `out`. */
export function blockDirection(model: PlateModel, block: PlateBlock, ageMa: number, out: number[]): void {
  const plate = model.plateIds.indexOf(block.plate);
  unitFromLonLat(block.lon, block.lat, out);
  if (plate < 0) return;
  plateQuaternion(model, plate, ageMa, scratchQ);
  rotateInPlace(scratchQ, 0, out);
}

/**
 * The unit direction of an assembly's name at `ageMa`, into `out`; false
 * when it has no name then or its members' middle is undefined.
 */
export function assemblyDirection(model: PlateModel, assembly: Assembly, ageMa: number, out: number[]): boolean {
  if (ageMa > assembly.from || ageMa < assembly.to) return false;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const id of assembly.plates) {
    const block = model.header.blocks.find((b) => b.plate === id);
    if (!block || block.begin < ageMa) continue;
    blockDirection(model, block, ageMa, scratchV);
    x += scratchV[0];
    y += scratchV[1];
    z += scratchV[2];
  }
  const length = Math.hypot(x, y, z);
  if (length < 1e-6) return false;
  const sign = assembly.opposite ? -1 : 1;
  out[0] = (sign * x) / length;
  out[1] = (sign * y) / length;
  out[2] = (sign * z) / length;
  return true;
}

/** A step of the user's track longer than this in one million years is a jump in the model, not motion. */
const TRACK_JUMP_COS = Math.cos((6 * Math.PI) / 180);

/**
 * The path the ground at (lon, lat) took: one segment per million years
 * from today back to the oldest age the model carries that crust, each
 * tagged to appear once the age shown reaches its older end. Steps where
 * the model hands the crust from one parent plate to another, and it
 * jumps, are left out.
 */
export function groundTrack(
  model: PlateModel,
  crust: CrustUnderfoot,
  lon: number,
  lat: number,
  column: number
): { start: Float32Array; end: Float32Array; meta: Float32Array } {
  const steps = Math.min(crust.begin, model.header.maxAgeMa);
  const start = new Float32Array(steps * 3);
  const end = new Float32Array(steps * 3);
  const meta = new Float32Array(steps * 3);
  const previous = [0, 0, 0];
  const current = [0, 0, 0];
  unitFromLonLat(lon, lat, previous);
  let written = 0;
  for (let age = 1; age <= steps; age++) {
    unitFromLonLat(lon, lat, current);
    plateQuaternion(model, crust.plate, age, scratchQ);
    rotateInPlace(scratchQ, 0, current);
    if (previous[0] * current[0] + previous[1] * current[1] + previous[2] * current[2] >= TRACK_JUMP_COS) {
      start.set(previous, written * 3);
      end.set(current, written * 3);
      meta[written * 3] = column;
      meta[written * 3 + 1] = ALWAYS;
      meta[written * 3 + 2] = age;
      written += 1;
    }
    previous[0] = current[0];
    previous[1] = current[1];
    previous[2] = current[2];
  }
  return { start: start.subarray(0, written * 3), end: end.subarray(0, written * 3), meta: meta.subarray(0, written * 3) };
}

/** What the control says about the user's own ground at `ageMa`. */
export function groundNote(model: PlateModel, crust: CrustUnderfoot | null, lon: number, lat: number, ageMa: number): string {
  if (!crust) return 'no continental crust here in the model';
  if (ageMa > crust.begin) return `the ground here appears at ${crust.begin} Ma`;
  if (ageMa <= 0) return '';
  unitFromLonLat(lon, lat, scratchV);
  plateQuaternion(model, crust.plate, ageMa, scratchQ);
  rotateInPlace(scratchQ, 0, scratchV);
  const then = (Math.asin(Math.max(-1, Math.min(1, scratchV[2]))) * 180) / Math.PI;
  return `the ground here was at ${formatLatitude(then)}`;
}

/** "152 Ma"; fractions only below ten, where a million years is a visible step. */
export function formatMa(ageMa: number): string {
  if (ageMa <= 0) return '0 Ma';
  return `${ageMa < 10 ? Number(ageMa.toFixed(1)) : Math.round(ageMa).toLocaleString('en-US')} Ma`;
}

const COAST_STYLE = { color: 0xffd27a, opacity: 0.95, widthPx: 1.6, renderOrder: RENDER_ORDER.outlines + 0.3 };
const BLOCK_STYLE = { color: 0xc98f4a, opacity: 0.7, widthPx: 1, renderOrder: RENDER_ORDER.outlines + 0.25 };
const TRACK_STYLE = { color: 0xffffff, opacity: 0.9, widthPx: 1.5, renderOrder: RENDER_ORDER.outlines + 0.35 };
// Over the images draped on the surface, under every line.
const FILL_STYLE = { color: 0xd9a05a, opacity: 0.26, renderOrder: RENDER_ORDER.surfaceShell + 0.2 };

const BLOCK_LABEL_RANK = LABEL_KIND_ORDER.indexOf('country') - 0.3;
const ASSEMBLY_LABEL_RANK = LABEL_KIND_ORDER.indexOf('country') - 0.5;
const HERE_LABEL_RANK = LABEL_KIND_ORDER.indexOf('country') - 0.6;

interface MovingLabel {
  readonly position: THREE.Vector3;
  readonly group: LabelGroup;
  shown: boolean;
}

/** The age asked for in the address (?ma=152), for links and screenshots; 0 without one. */
export function ageFromLocation(search: string, maxMa: number): number {
  const value = Number(new URLSearchParams(search).get('ma'));
  return Number.isFinite(value) ? Math.min(maxMa, Math.max(0, value)) : 0;
}

export async function createContinentsLayer(context: LayerContext): Promise<LayerInstance> {
  const [response, scale] = await Promise.all([
    fetch(context.assetUrl('geo/deep-time/plates.bin')),
    context.fetchJson<TimeScale>(context.assetUrl('geo/deep-time/timescale.json')),
  ]);
  if (!response.ok) throw new Error(`plates.bin: HTTP ${response.status}`);
  const model = parsePlateFile(await response.arrayBuffer());
  const maxMa = model.header.maxAgeMa;

  const shapes = new PlateShapes(model);
  shapes.addFill('continent-fill', model.sets.continents, FILL_STYLE);
  shapes.addOutlines('continent-blocks', model.sets.continents, BLOCK_STYLE);
  shapes.addOutlines('coastlines', model.sets.coast, COAST_STYLE);
  const empty = new Float32Array(0);
  const track = shapes.addSegments('ground-track', empty, empty, empty, TRACK_STYLE);
  shapes.group.visible = false;
  context.earthRoot.add(shapes.group);

  const moving = (text: string, rank: number, style: { fontPx: number; color: string; italic?: boolean; bold?: boolean; wide?: boolean }): MovingLabel => {
    const position = new THREE.Vector3();
    const group = context.addLabels({ rank, style, frame: 'earth', labels: [{ text, priority: 0, position }] });
    group.setVisible(false);
    return { position, group, shown: false };
  };
  const blockLabels = model.header.blocks.map((block) => ({ block, label: moving(block.name, BLOCK_LABEL_RANK, { fontPx: 12, color: '#ffd98a', italic: true, bold: true }) }));
  const assemblyLabels = ASSEMBLIES.map((assembly) => ({
    assembly,
    label: moving(assembly.name, ASSEMBLY_LABEL_RANK, { fontPx: 14, color: assembly.opposite ? '#9fdcff' : '#fff1c9', wide: true, bold: true }),
  }));
  const here = moving('◎ here, then', HERE_LABEL_RANK, { fontPx: 12, color: '#ffffff', bold: true });

  const control = new TimeControl(
    {
      id: 'continents',
      title: 'Continents through time',
      max: maxMa,
      step: 1,
      buttonStep: 10,
      playRate: 20,
      // The breakup of Pangaea is what most people come for; the full billion years is a drag away.
      playFrom: 250,
      format: formatMa,
      formatSpoken: (value) => (value <= 0 ? 'the present' : `${Math.round(value).toLocaleString('en-US')} million years ago`),
      describe: (value) => describeAge(scale, value),
      swatch: (value) => (value <= 0 ? null : (unitAt(scale, 'period', value)?.color ?? null)),
      trackBackground: periodGradient(scale, maxMa),
    },
    ageFromLocation(window.location.search, maxMa)
  );

  let visible = false;
  let age = Number.NaN;
  let crust: CrustUnderfoot | null = null;
  let groundLon = Number.NaN;
  let groundLat = Number.NaN;
  const direction = [0, 0, 0];

  const show = (label: MovingLabel, on: boolean): void => {
    if (label.shown !== on) {
      label.shown = on;
      label.group.setVisible(on);
    }
  };

  const followGround = (): boolean => {
    const position = context.getPosition();
    if (!position) return false;
    // A step of a kilometre does not change which block the user is on; a new fix far away does.
    if (Math.abs(position.lon - groundLon) < 0.01 && Math.abs(position.lat - groundLat) < 0.01) return false;
    groundLon = position.lon;
    groundLat = position.lat;
    crust = crustAt(model, groundLon, groundLat);
    const segments = crust ? groundTrack(model, crust, groundLon, groundLat, shapes.identityColumn) : { start: empty, end: empty, meta: empty };
    shapes.setSegments(track.geometry, segments.start, segments.end, segments.meta);
    return true;
  };

  const apply = (force: boolean): void => {
    const next = control.value;
    if (!force && next === age) return;
    age = next;
    shapes.setAge(age);
    const past = visible && age > 0;
    for (const { block, label } of blockLabels) {
      const on = past && age <= block.begin;
      if (on) {
        blockDirection(model, block, age, direction);
        label.position.set(direction[0], direction[1], direction[2]).multiplyScalar(EARTH_RADIUS_M);
      }
      show(label, on);
    }
    for (const { assembly, label } of assemblyLabels) {
      const on = past && assemblyDirection(model, assembly, age, direction);
      if (on) label.position.set(direction[0], direction[1], direction[2]).multiplyScalar(EARTH_RADIUS_M);
      show(label, on);
    }
    const onGround = past && crust !== null && age <= crust.begin;
    if (onGround && crust) {
      unitFromLonLat(groundLon, groundLat, direction);
      plateQuaternion(model, crust.plate, age, scratchQ);
      rotateInPlace(scratchQ, 0, direction);
      here.position.set(direction[0], direction[1], direction[2]).multiplyScalar(EARTH_RADIUS_M);
    }
    show(here, onGround);
    control.setNote(Number.isNaN(groundLon) ? '' : groundNote(model, crust, groundLon, groundLat, age));
    if (visible) {
      const name = describeAge(scale, age);
      context.setStatus(age <= 0 ? 'today · model' : `${formatMa(age)} · ${name} · model`, 'info');
    }
  };

  control.onChange(() => apply(false));

  return {
    setVisible(on) {
      visible = on;
      shapes.group.visible = on;
      control.setVisible(on);
      if (on) followGround();
      else context.setStatus(null);
      apply(true);
    },
    update(frame: FrameState) {
      control.tick(frame.deltaMs);
      if (followGround()) apply(true);
    },
    setResolution(widthCss, heightCss) {
      shapes.setResolution(widthCss, heightCss);
    },
    dispose() {
      control.dispose();
      for (const { label } of blockLabels) label.group.remove();
      for (const { label } of assemblyLabels) label.group.remove();
      here.group.remove();
      shapes.dispose();
    },
  };
}
