/**
 * The view as a fold over actions. Every action is absolute, so the view
 * at any point is the last value of each thing, with no undo to run: a
 * guide seeks by folding its cues (guides/format.ts foldTo). Pure, and it
 * reads no preset, so it needs no registry.
 */

import type { LayerParamValues } from '../layers/types';
import type { FoldedView, Target, TimeSetting, ViewAction } from './actions';
import { targetKey } from './targets';

/** The view after one more action. Pure: `view` is not changed. */
export function foldAction(view: FoldedView, action: ViewAction): FoldedView {
  switch (action.do) {
    case 'preset':
      // A preset sets every switch, so what was flipped before it is gone.
      return { ...view, layers: { preset: action.id, on: [], off: [] } };
    case 'layers': {
      const layers = foldSwitches(view.layers, action.on ?? [], action.off ?? []);
      return action.params ? { ...view, layers, params: foldParams(view.params ?? {}, action.params) } : { ...view, layers };
    }
    case 'look':
      return { ...view, look: { target: action.target, fovDeg: action.fovDeg ?? view.look.fovDeg } };
    case 'fov':
      return { ...view, look: { target: view.look.target, fovDeg: action.fovDeg } };
    case 'mark':
      return { ...view, marks: foldMark(view.marks, action.target, action.text) };
    case 'stand':
      return { ...view, place: action.place };
    case 'time':
      // The whole setting, not merged: a cue that leaves out the rate means the real rate, not the last one.
      return { ...view, time: timeSetting(action) };
  }
}

/**
 * Off first, then on, as perform does. An id is never in both lists. What is
 * on is kept in the order it was last turned on, so turning the switches on in
 * that order again ends the same way, exclusive groups included; the fold
 * itself knows no group.
 */
function foldSwitches(layers: FoldedView['layers'], on: readonly string[], off: readonly string[]): FoldedView['layers'] {
  if ('only' in layers) return { only: turnedOn(layers.only.filter((id) => !off.includes(id)), on) };
  const layersOn = layers.on.filter((id) => !off.includes(id));
  // What is off has no order that matters: nothing turned off turns anything else on.
  const layersOff = union(layers.off, off).filter((id) => !on.includes(id));
  return { preset: layers.preset, on: turnedOn(layersOn, on), off: layersOff };
}

/** `list` then `add`, each id once, an id turned on again moved to the end: the order they were last turned on, which is the order an exclusive group goes by. */
const turnedOn = (list: readonly string[], add: readonly string[]): string[] => [...list.filter((id) => !add.includes(id)), ...new Set(add)];

/** `list` with `add` after it, each id once, in the order it first came. */
const union = (list: readonly string[], add: readonly string[]): string[] => [...new Set([...list, ...add])];

/** Each layer's settings with the new ones over them: a setting not given again keeps its last value. */
function foldParams(
  params: NonNullable<FoldedView['params']>,
  given: Readonly<Record<string, LayerParamValues>>
): NonNullable<FoldedView['params']> {
  const next = { ...params };
  for (const [id, values] of Object.entries(given)) next[id] = { ...next[id], ...values };
  return next;
}

/** A mark is known by its target: new text replaces it where it stands; null takes it down. */
function foldMark(marks: FoldedView['marks'], target: Target, text: string | null): FoldedView['marks'] {
  const key = targetKey(target);
  const at = marks.findIndex((mark) => targetKey(mark.target) === key);
  if (text === null) return at < 0 ? marks : marks.filter((_, i) => i !== at);
  if (at < 0) return [...marks, { target, text }];
  return marks.map((mark, i) => (i === at ? { target, text } : mark));
}

/** A time action as a setting: its fields without its `do`, and nothing else a cue carries, such as its `at`. */
export function timeSetting(action: { readonly to: string; readonly rate?: number; readonly until?: string }): TimeSetting {
  const { to, rate, until } = action;
  return { to, ...(rate === undefined ? {} : { rate }), ...(until === undefined ? {} : { until }) };
}
