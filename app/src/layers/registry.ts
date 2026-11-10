/**
 * Every lazy layer in the app, gathered from src/layers/<name>/layer.ts.
 *
 * Each such file default-exports one LayerDefinition or an array of them.
 */

import type { LayerDefinition } from './types';
import { LAYER_SECTIONS } from './types';

type LayerModule = { default: LayerDefinition | readonly LayerDefinition[] };

/** Sort by section, then order, then label; reject duplicate ids. */
export function collectDefinitions(modules: Record<string, LayerModule>): LayerDefinition[] {
  const definitions = Object.values(modules).flatMap((module) =>
    Array.isArray(module.default) ? (module.default as readonly LayerDefinition[]) : [module.default as LayerDefinition]
  );
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (seen.has(definition.id)) throw new Error(`duplicate layer id "${definition.id}"`);
    seen.add(definition.id);
  }
  const section = (d: LayerDefinition): number => LAYER_SECTIONS.indexOf(d.section);
  return definitions.sort(
    (a, b) => section(a) - section(b) || (a.order ?? 100) - (b.order ?? 100) || a.label.localeCompare(b.label)
  );
}

export const LAYER_DEFINITIONS: readonly LayerDefinition[] = collectDefinitions(
  import.meta.glob<LayerModule>('./*/layer.ts', { eager: true })
);
