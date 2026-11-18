/**
 * The guide file format as the player reads it. The types are derived
 * from the schema in guide-schema.ts, the one place the format is written;
 * only types are imported, so the schema itself stays out of the app.
 */

import type { SchemaType } from '../view/action-schema';
import type { GUIDE_SCHEMA } from './guide-schema';

/** A guide file, as guide.schema.json describes it. */
export type Guide = SchemaType<typeof GUIDE_SCHEMA>;
export type Chapter = Guide['chapters'][number];
/** The whole view at a chapter's start. */
export type Scene = Chapter['scene'];
export type Step = Chapter['steps'][number];
/** A view action at a time in its step. */
export type Cue = Step['cues'][number];
