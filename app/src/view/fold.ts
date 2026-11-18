/**
 * The view as a fold over actions. Every action is absolute, so the view
 * at any point is the last value of each thing, with no undo to run: a
 * guide seeks by folding its cues (guides/format.ts foldTo). Pure, and it
 * reads no preset, so it needs no registry.
 */

import type { FoldedView, Target, ViewAction } from './actions';
import { targetKey } from './targets';

/** The view after one more action. Pure: `view` is not changed. */
export function foldAction(view: FoldedView, action: ViewAction): FoldedView {
  switch (action.do) {
    case 'preset':
      // A preset sets every switch, so what was flipped before it is gone.
      return { ...view, layers: { preset: action.id, on: [], off: [] } };
    case 'layers':
      return { ...view, layers: foldSwitches(view.layers, action.on ?? [], action.off ?? []) };
    case 'look':
      return { ...view, look: { target: action.target, fovDeg: action.fovDeg ?? view.look.fovDeg } };
    case 'fov':
      return { ...view, look: { target: view.look.target, fovDeg: action.fovDeg } };
    case 'mark':
      return { ...view, marks: foldMark(view.marks, action.target, action.text) };
  }
}

/** Off first, then on, as perform does. An id is never in both lists. */
function foldSwitches(layers: FoldedView['layers'], on: readonly string[], off: readonly string[]): FoldedView['layers'] {
  if ('only' in layers) return { only: union(layers.only.filter((id) => !off.includes(id)), on) };
  const layersOn = layers.on.filter((id) => !off.includes(id));
  const layersOff = union(layers.off, off).filter((id) => !on.includes(id));
  return { preset: layers.preset, on: union(layersOn, on), off: layersOff };
}

/** `list` with `add` after it, each id once, in the order it first came. */
const union = (list: readonly string[], add: readonly string[]): string[] => [...new Set([...list, ...add])];

/** A mark is known by its target: new text replaces it where it stands; null takes it down. */
function foldMark(marks: FoldedView['marks'], target: Target, text: string | null): FoldedView['marks'] {
  const key = targetKey(target);
  const at = marks.findIndex((mark) => targetKey(mark.target) === key);
  if (text === null) return at < 0 ? marks : marks.filter((_, i) => i !== at);
  if (at < 0) return [...marks, { target, text }];
  return marks.map((mark, i) => (i === at ? { target, text } : mark));
}
