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
import { FOV_NEEDS_TARGET_BELOW_DEG, MAX_FADE_S } from './view-control';

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
        'A name from the baked label files (geo/labels.json, geology.json, quakes.json). `labelKind` tells apart places that share a name: Georgia the country from Georgia the state. A name no baked file has is looked for among the names of the layers loaded: "M31". A guide may use only baked names, which can be checked before it plays.',
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

/** Where the view stands (standing-place.ts). Always on the ground: a guide moves the viewer, never the camera off them. */
export const PLACE_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      description: 'Where the sensors say the user is.',
      properties: { kind: { const: 'here' } },
      required: ['kind'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'The far side of the Earth from here.',
      properties: { kind: { const: 'antipode' } },
      required: ['kind'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'A named place on the ground. The name is what the place chip says.',
      properties: { kind: { const: 'at' }, lat: LATITUDE, lon: { type: 'number', minimum: -180, maximum: 180 }, name: NAME },
      required: ['kind', 'lat', 'lon', 'name'],
      additionalProperties: false,
    },
  ],
} as const;

const SWITCH_IDS ={ type: 'array', items: NAME, minItems: 1, uniqueItems: true } as const;

/**
 * Settings for the layers an action turns on, by switch id. What each layer takes is in its definition
 * (layers/<id>/layer.ts, `params`), which the view control and the guide validator check them against: a schema of
 * every layer's settings here would be a second copy of them.
 */
const LAYER_PARAMS = {
  type: 'object',
  description:
    'Settings for switches this action turns on, by switch id, as {"seismic-waves": {"quake": "tohoku2011"}}. Each layer\'s are in its definition (`params`); a setting left out stays as it is.',
  minProperties: 1,
  additionalProperties: { type: 'object', minProperties: 1, additionalProperties: { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'boolean' }] } },
} as const;

const FADE_S = {
  type: 'number',
  description:
    'Fade the switches named in or out over this many seconds rather than at once. Only the globe\'s shells and layers that say they fade can; a switch already as asked stays as it is.',
  exclusiveMinimum: 0,
  maximum: MAX_FADE_S,
} as const;

// Each action's description and fields have one home: a guide's cue is an action with a time added (guides/guide-schema.ts).
export const PRESET_FIELDS = {
  description: 'Every switch as the preset has it (ui/presets.ts).',
  properties: { do: { const: 'preset' }, id: NAME },
  required: ['do', 'id'],
} as const;
export const LAYERS_FIELDS = {
  description: 'Named switches on or off; the rest stay.',
  properties: { do: { const: 'layers' }, on: SWITCH_IDS, off: SWITCH_IDS, params: LAYER_PARAMS, fadeS: FADE_S },
  required: ['do'],
} as const;
export const LOOK_FIELDS = {
  description: 'Look at a target, optionally `fovDeg` wide.',
  properties: { do: { const: 'look' }, target: TARGET_SCHEMA, fovDeg: { type: 'number', minimum: MIN_FOV_DEG, maximum: MAX_FOV_DEG } },
  required: ['do', 'target'],
} as const;
export const FOV_FIELDS = {
  description: 'The field of view with no target: 60 is the default.',
  properties: { do: { const: 'fov' }, fovDeg: { type: 'number', minimum: FOV_NEEDS_TARGET_BELOW_DEG, maximum: MAX_FOV_DEG } },
  required: ['do', 'fovDeg'],
} as const;
export const STAND_FIELDS = {
  description: 'Stand the view somewhere else on the ground: a dip to dark, then the view from there.',
  properties: { do: { const: 'stand' }, place: PLACE_SCHEMA },
  required: ['do', 'place'],
} as const;
export const MARK_FIELDS = {
  description: 'A ring and a line of text on a target; `text: null` removes it.',
  properties: { do: { const: 'mark' }, target: TARGET_SCHEMA, text: { type: ['string', 'null'], minLength: 1 } },
  required: ['do', 'target', 'text'],
} as const;

/** What a guide cue, a voice command and, later, the voice AI may ask of the view. */
export const VIEW_ACTION_SCHEMA = {
  oneOf: [
    { type: 'object', ...PRESET_FIELDS, additionalProperties: false },
    // `do` and at least one of on and off.
    { type: 'object', ...LAYERS_FIELDS, minProperties: 2, additionalProperties: false },
    { type: 'object', ...LOOK_FIELDS, additionalProperties: false },
    { type: 'object', ...FOV_FIELDS, additionalProperties: false },
    { type: 'object', ...MARK_FIELDS, additionalProperties: false },
    { type: 'object', ...STAND_FIELDS, additionalProperties: false },
  ],
} as const;
