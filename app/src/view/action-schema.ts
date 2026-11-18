/**
 * The view's actions and targets, written once as JSON Schema. The types
 * in actions.ts are derived from it, and the guide schema is built from
 * it, so the two cannot drift. It also states the ranges the view control
 * enforces, read from the same constants, so a guide is refused for the
 * value the app would refuse at run time.
 *
 * TypeScript constants rather than a .json file: the types can only be
 * derived from literal types, which a JSON import does not keep.
 */

import type { FromSchema, JSONSchema } from 'json-schema-to-ts';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { MAX_FOV_DEG, MIN_FOV_DEG } from '../input/look';
import { FOV_NEEDS_TARGET_BELOW_DEG } from './view-control';

/** Arrays and fields read-only all the way down; anything else as it is. */
type DeepReadonly<T> = T extends readonly (infer E)[]
  ? readonly DeepReadonly<E>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** The type a schema describes, read-only all the way down, as the app's hand-written types are. */
export type SchemaType<S extends JSONSchema> = DeepReadonly<FromSchema<S>>;

/** The deepest a ground target goes: the Earth's centre. */
const EARTH_RADIUS_KM = EARTH_RADIUS_M / 1000;

const NAME = { type: 'string', minLength: 1 } as const;
const LATITUDE = { type: 'number', minimum: -90, maximum: 90 } as const;

/** Something to look at. Every kind resolves to a direction from where the view stands (targets.ts). */
export const TARGET_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      description: "The Sun, the Moon or a planet, at the app clock's time.",
      properties: {
        kind: { const: 'body' },
        // Literal, for the type: a test holds it to PLANET_NAMES.
        body: { enum: ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] },
      },
      required: ['kind', 'body'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'A fixed place on the sky, ICRS.',
      properties: {
        kind: { const: 'sky' },
        raDeg: { type: 'number', minimum: 0, exclusiveMaximum: 360 },
        decDeg: LATITUDE,
        name: NAME,
        extentDeg: { type: 'number', exclusiveMinimum: 0, maximum: 180 },
      },
      required: ['kind', 'raDeg', 'decDeg'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'A direction in the local frame: azimuth clockwise from north, altitude above the horizon. -90 is straight down.',
      properties: {
        kind: { const: 'horizon' },
        azDeg: { type: 'number', minimum: 0, exclusiveMaximum: 360 },
        altDeg: LATITUDE,
      },
      required: ['kind', 'azDeg', 'altDeg'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'A place on or in the Earth.',
      properties: {
        kind: { const: 'ground' },
        lat: LATITUDE,
        lon: { type: 'number', minimum: -180, maximum: 180 },
        depthKm: { type: 'number', minimum: 0, maximum: EARTH_RADIUS_KM },
        name: NAME,
      },
      required: ['kind', 'lat', 'lon'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description:
        'A name from the baked label files (geo/labels.json, geology.json, quakes.json). `labelKind` tells apart places that share a name: Georgia the country from Georgia the state.',
      properties: {
        kind: { const: 'label' },
        name: NAME,
        // Literal, for the type: a test holds it to LABEL_KIND_ORDER.
        labelKind: { enum: ['country', 'state', 'city', 'plate', 'deep', 'hotspot', 'quake', 'subduction', 'volcano'] },
      },
      required: ['kind', 'name'],
      additionalProperties: false,
    },
  ],
} as const;

const SWITCH_IDS = { type: 'array', items: NAME, minItems: 1, uniqueItems: true } as const;

// Each action's fields have one home, so a guide's cue can add its own to them.
const PRESET_FIELDS = {
  properties: { do: { const: 'preset' }, id: NAME },
  required: ['do', 'id'],
} as const;
const LAYERS_FIELDS = {
  properties: { do: { const: 'layers' }, on: SWITCH_IDS, off: SWITCH_IDS },
  required: ['do'],
} as const;
const LOOK_FIELDS = {
  properties: { do: { const: 'look' }, target: TARGET_SCHEMA, fovDeg: { type: 'number', minimum: MIN_FOV_DEG, maximum: MAX_FOV_DEG } },
  required: ['do', 'target'],
} as const;
const FOV_FIELDS = {
  properties: { do: { const: 'fov' }, fovDeg: { type: 'number', minimum: FOV_NEEDS_TARGET_BELOW_DEG, maximum: MAX_FOV_DEG } },
  required: ['do', 'fovDeg'],
} as const;
const MARK_FIELDS = {
  properties: { do: { const: 'mark' }, target: TARGET_SCHEMA, text: { type: ['string', 'null'], minLength: 1 } },
  required: ['do', 'target', 'text'],
} as const;

/** What a guide cue, a voice command and, later, the voice AI may ask of the view. */
export const VIEW_ACTION_SCHEMA = {
  oneOf: [
    { type: 'object', description: 'Every switch as the preset has it (ui/presets.ts).', ...PRESET_FIELDS, additionalProperties: false },
    {
      type: 'object',
      description: 'Named switches on or off; the rest stay.',
      ...LAYERS_FIELDS,
      // `do` and at least one of on and off.
      minProperties: 2,
      additionalProperties: false,
    },
    { type: 'object', description: 'Look at a target, optionally `fovDeg` wide.', ...LOOK_FIELDS, additionalProperties: false },
    { type: 'object', description: 'The field of view with no target: 60 is the default.', ...FOV_FIELDS, additionalProperties: false },
    {
      type: 'object',
      description: 'A ring and a line of text on a target; `text: null` removes it.',
      ...MARK_FIELDS,
      additionalProperties: false,
    },
  ],
} as const;
