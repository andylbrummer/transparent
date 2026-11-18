/**
 * Writes public/guides/guide.schema.json from GUIDE_SCHEMA, the one place
 * the guide format is written. An editor reads the file for completion and
 * a guide's "$schema" points at it; a test fails when it is out of date.
 *
 *   npm run guides:schema
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guideSchemaText } from '../src/guides/guide-schema';

const OUTPUT = fileURLToPath(new URL('../public/guides/guide.schema.json', import.meta.url));

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, guideSchemaText());
console.error(`wrote ${OUTPUT}`);
