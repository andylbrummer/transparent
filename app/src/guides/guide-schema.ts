/**
 * The guide file format (spec/guides.md §3), written once as JSON Schema.
 * The player's types (format.ts) are derived from it, and
 * public/guides/guide.schema.json is its output, written by
 * `npm run guides:schema` and held to it by a test.
 *
 * Only what the app plays: of clips, only audio and images. A schema that
 * accepted more would pass guides the app cannot play.
 */

import {
  CLIP_FIELDS,
  FOV_FIELDS,
  LAYERS_FIELDS,
  LOOK_FIELDS,
  MARK_FIELDS,
  PLACE_SCHEMA,
  PRESET_FIELDS,
  STAND_FIELDS,
  TARGET_SCHEMA,
  TIME_FIELDS,
  TIME_PROPERTIES,
} from '../view/action-schema';
// Kept in format.ts, which the app imports, so that checking a guide at run time does not bring this schema with it.
import { GUIDE_FORMAT_VERSION, ID_PATTERN } from './format';

const ID = { type: 'string', pattern: ID_PATTERN, description: 'Lower-case words joined by hyphens.' } as const;
const TEXT = { type: 'string', minLength: 1 } as const;
// Not `format: 'uri'`: ajv only knows formats with another package.
const HTTPS_URL = { type: 'string', pattern: '^https://' } as const;
// Hyphenated segments joined by slashes, ending in the one extension: no "..", no leading slash and no URL, so a path
// cannot leave the guide's folder.
const AUDIO_PATH = { type: 'string', pattern: '^[a-z0-9-]+(/[a-z0-9-]+)*\\.m4a$', description: "An .m4a file in the guide's folder." } as const;
const CAPTIONS_PATH = { type: 'string', pattern: '^[a-z0-9-]+(/[a-z0-9-]+)*\\.vtt$', description: "A WebVTT file in the guide's folder." } as const;
const IMAGE_PATH = { type: 'string', pattern: '^[a-z0-9-]+(/[a-z0-9-]+)*\\.(webp|jpg)$', description: "A .webp or .jpg file in the guide's folder." } as const;

const CREDIT = {
  type: 'object',
  properties: { what: TEXT, source: TEXT, licence: TEXT, url: HTTPS_URL },
  required: ['what', 'source', 'licence', 'url'],
  additionalProperties: false,
} as const;

const AUTHOR = {
  type: 'object',
  properties: { name: TEXT, url: HTTPS_URL },
  required: ['name'],
  additionalProperties: false,
} as const;

/** A clip of speech: like a narration, every one has its captions. */
const AUDIO_CLIP = {
  type: 'object',
  properties: { kind: { const: 'audio' }, src: AUDIO_PATH, captions: CAPTIONS_PATH, credit: CREDIT },
  required: ['kind', 'src', 'captions', 'credit'],
  additionalProperties: false,
} as const;

/** A picture, shown with its caption; `alt` says what it shows to someone who cannot see it. */
const IMAGE_CLIP = {
  type: 'object',
  properties: { kind: { const: 'image' }, src: IMAGE_PATH, alt: TEXT, caption: TEXT, credit: CREDIT },
  required: ['kind', 'src', 'alt', 'caption', 'credit'],
  additionalProperties: false,
} as const;

/**
 * A clip hung on something in the view (spec/guides.md §8.1): its marker sits on `anchor` and reads "▶ title". One
 * format for a guide's step and for the "Stories and clips" layer.
 */
export const HOTSPOT_SCHEMA = {
  type: 'object',
  properties: {
    id: { ...ID, description: 'Unique in its file: what a clip cue names.' },
    // Short: a marker stands among the map's names.
    title: { ...TEXT, maxLength: 60 },
    anchor: TARGET_SCHEMA,
    layer: { ...TEXT, description: 'A layer switch: the marker shows only while it is on.' },
    clip: { oneOf: [AUDIO_CLIP, IMAGE_CLIP] },
  },
  required: ['id', 'title', 'anchor', 'clip'],
  additionalProperties: false,
} as const;

/** Where the view looks at a chapter's start: both fields, since a scene sets the whole view. */
const SCENE_LOOK = {
  type: 'object',
  properties: { target: TARGET_SCHEMA, fovDeg: LOOK_FIELDS.properties.fovDeg },
  required: ['target', 'fovDeg'],
  additionalProperties: false,
} as const;

/** Where the view stands at a chapter's start. Left out, it stands here: a scene is still the whole view. */
const SCENE_PLACE = { ...PLACE_SCHEMA, description: 'Where the view stands. Left out: here.' } as const;

/** The app clock at a chapter's start. Left out, live time. */
const SCENE_TIME = {
  type: 'object',
  description: "The app clock at the chapter's start. Left out: now, at the real rate.",
  properties: TIME_PROPERTIES,
  required: ['to'],
  additionalProperties: false,
} as const;

const SCENE = {
  description: "The whole view at the chapter's start: where a guide seeks to. Its switches as a preset has them, or as listed.",
  oneOf: [
    {
      type: 'object',
      properties: { preset: TEXT, place: SCENE_PLACE, time: SCENE_TIME, look: SCENE_LOOK },
      required: ['preset', 'look'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        layers: { type: 'array', items: TEXT, uniqueItems: true, description: 'The switches that are on; every other is off. Empty is all off.' },
        place: SCENE_PLACE,
        time: SCENE_TIME,
        look: SCENE_LOOK,
      },
      required: ['layers', 'look'],
      additionalProperties: false,
    },
  ],
} as const;

const AT = { type: 'number', minimum: 0, description: "Seconds from the start of the step's narration." } as const;

/** A view action at a time in its step: each action's fields with `at` added. */
const CUE = {
  oneOf: [
    { type: 'object', ...PRESET_FIELDS, properties: { ...PRESET_FIELDS.properties, at: AT }, required: [...PRESET_FIELDS.required, 'at'], additionalProperties: false },
    {
      type: 'object',
      ...LAYERS_FIELDS,
      properties: { ...LAYERS_FIELDS.properties, at: AT },
      required: [...LAYERS_FIELDS.required, 'at'],
      // `do`, `at` and at least one of on and off.
      minProperties: 3,
      additionalProperties: false,
    },
    { type: 'object', ...LOOK_FIELDS, properties: { ...LOOK_FIELDS.properties, at: AT }, required: [...LOOK_FIELDS.required, 'at'], additionalProperties: false },
    { type: 'object', ...FOV_FIELDS, properties: { ...FOV_FIELDS.properties, at: AT }, required: [...FOV_FIELDS.required, 'at'], additionalProperties: false },
    { type: 'object', ...MARK_FIELDS, properties: { ...MARK_FIELDS.properties, at: AT }, required: [...MARK_FIELDS.required, 'at'], additionalProperties: false },
    { type: 'object', ...STAND_FIELDS, properties: { ...STAND_FIELDS.properties, at: AT }, required: [...STAND_FIELDS.required, 'at'], additionalProperties: false },
    { type: 'object', ...TIME_FIELDS, properties: { ...TIME_FIELDS.properties, at: AT }, required: [...TIME_FIELDS.required, 'at'], additionalProperties: false },
    { type: 'object', ...CLIP_FIELDS, properties: { ...CLIP_FIELDS.properties, at: AT }, required: [...CLIP_FIELDS.required, 'at'], additionalProperties: false },
  ],
} as const;

/** What every step has, beside its narration or its silence. */
const STEP_FIELDS = {
  id: ID,
  cues: { type: 'array', items: CUE },
  advance: {
    enum: ['auto', 'gaze', 'continue'],
    description: 'When the step is over: as the narration ends, once the user has turned to the look, or when they say so.',
  },
  hotspots: {
    type: 'array',
    items: HOTSPOT_SCHEMA,
    minItems: 1,
    description: 'Clips beside the narration, shown from this step to the end of its chapter.',
  },
} as const;

/** A step is narrated, with captions, or a silence of so many seconds: exactly one. */
const STEP = {
  oneOf: [
    {
      type: 'object',
      properties: {
        ...STEP_FIELDS,
        narration: {
          type: 'object',
          description: 'Every narration has its captions.',
          properties: { audio: AUDIO_PATH, captions: CAPTIONS_PATH },
          required: ['audio', 'captions'],
          additionalProperties: false,
        },
      },
      required: ['id', 'narration', 'cues', 'advance'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { ...STEP_FIELDS, silenceS: { type: 'number', exclusiveMinimum: 0, description: 'Seconds with no narration.' } },
      required: ['id', 'silenceS', 'cues', 'advance'],
      additionalProperties: false,
    },
  ],
} as const;

const CHAPTER = {
  type: 'object',
  properties: { id: ID, title: TEXT, scene: SCENE, steps: { type: 'array', items: STEP, minItems: 1 } },
  required: ['id', 'title', 'scene', 'steps'],
  additionalProperties: false,
} as const;

/** BCP 47: a guide's language, and the media layer's. */
const LANGUAGE = { type: 'string', pattern: '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$', description: 'BCP 47, as "en" or "pt-BR".' } as const;

/** The guide file format (spec/guides.md §3). Written here once: the types in format.ts and guide.schema.json both come from it. */
export const GUIDE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Transparent Earth guide',
  type: 'object',
  properties: {
    $schema: { type: 'string', description: 'Where an editor finds this schema: "../guide.schema.json".' },
    formatVersion: { const: GUIDE_FORMAT_VERSION },
    id: { ...ID, description: "The guide's folder name and its deep link: ?guide=<id>." },
    title: TEXT,
    summary: TEXT,
    language: LANGUAGE,
    topics: {
      type: 'array',
      items: { enum: ['geology', 'solar-system', 'stars', 'deep-space', 'sun', 'weather', 'near-space'] },
      minItems: 1,
      uniqueItems: true,
    },
    authors: { type: 'array', items: AUTHOR, minItems: 1 },
    licence: { ...TEXT, description: 'The licence of the script and narration.' },
    credits: { type: 'array', items: CREDIT, minItems: 1, description: 'Everything the guide uses that someone made.' },
    chapters: { type: 'array', items: CHAPTER, minItems: 1 },
  },
  required: ['formatVersion', 'id', 'title', 'summary', 'language', 'topics', 'authors', 'licence', 'credits', 'chapters'],
  additionalProperties: false,
} as const;

/**
 * public/media/hotspots.json, the "Stories and clips" layer's hotspots (spec/guides.md §8.1): the same hotspots as a
 * guide step's, with their files beside the list. Read only by the app and the validator, so it has no schema file.
 */
export const MEDIA_HOTSPOTS_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Transparent Earth hotspots',
  type: 'object',
  properties: {
    formatVersion: { const: GUIDE_FORMAT_VERSION },
    language: { ...LANGUAGE, description: "The language of the clips' captions and text." },
    hotspots: { type: 'array', items: HOTSPOT_SCHEMA, minItems: 1 },
  },
  required: ['formatVersion', 'language', 'hotspots'],
  additionalProperties: false,
} as const;

/** guide.schema.json's text, exactly: what the script writes and the test compares. */
export function guideSchemaText(): string {
  return JSON.stringify(GUIDE_SCHEMA, null, 2) + '\n';
}
