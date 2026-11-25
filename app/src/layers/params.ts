/**
 * Checks a layer's settings against its params (types.ts LayerParam).
 * The view control refuses a bad value with these words at run time and
 * the guide validator refuses it with the same words before a guide
 * ships, so the two cannot disagree about what a layer takes.
 */

import type { LayerParam, LayerParams, LayerParamValues } from './types';

/** Everything wrong with giving `values` to layer `id`, which takes `params`; empty when nothing is. */
export function paramProblems(id: string, params: LayerParams | undefined, values: LayerParamValues): string[] {
  const names = Object.keys(values);
  if (names.length === 0) return [`no setting given for ${id}`];
  if (!params) return [`${id} takes no settings`];
  const problems: string[] = [];
  for (const name of names) {
    // Own properties only: a guide naming "toString" is asking for a setting that does not exist.
    const param = Object.hasOwn(params, name) ? params[name] : undefined;
    if (!param) problems.push(`${id} has no setting ${name}: it has ${Object.keys(params).join(', ')}`);
    else {
      const wrong = valueProblem(param, values[name]);
      if (wrong) problems.push(`${id} ${name} ${wrong}`);
    }
  }
  return problems;
}

/** What is wrong with `value` for `param`, as the end of a sentence; null when nothing is. */
function valueProblem(param: LayerParam, value: unknown): string | null {
  switch (param.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'is true or false';
    case 'string':
      return typeof value === 'string' && param.values.includes(value) ? null : `is one of ${param.values.join(', ')}`;
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'is a number';
      if (param.values) return param.values.includes(value) ? null : `is one of ${param.values.join(', ')}`;
      if ((param.minimum !== undefined && value < param.minimum) || (param.maximum !== undefined && value > param.maximum)) {
        return `is from ${param.minimum ?? '-∞'} to ${param.maximum ?? '∞'}`;
      }
      return null;
    }
  }
}
