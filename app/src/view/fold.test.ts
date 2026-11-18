import { describe, it, expect } from 'vitest';
import type { FoldedView, Target, ViewAction } from './actions';
import { foldAction } from './fold';

const down: Target = { kind: 'horizon', azDeg: 0, altDeg: -90 };
const sun: Target = { kind: 'body', body: 'sun' };

/** The view a preset scene starts from. */
const fromPreset: FoldedView = { layers: { preset: 'sky', on: [], off: [] }, look: { target: down, fovDeg: 60 }, marks: [] };
/** The view a listed scene starts from. */
const fromList: FoldedView = { layers: { only: ['globe-surface', 'political'] }, look: { target: down, fovDeg: 60 }, marks: [] };

const fold = (view: FoldedView, ...actions: ViewAction[]): FoldedView => actions.reduce(foldAction, view);

describe('foldAction', () => {
  it('drops what was flipped before a preset, and keeps what is flipped after it', () => {
    const view = fold(
      fromPreset,
      { do: 'layers', on: ['shell-moho'], off: ['political'] },
      { do: 'preset', id: 'earth' },
      { do: 'layers', on: ['inner-core'], off: ['stars'] },
    );
    expect(view.layers).toEqual({ preset: 'earth', on: ['inner-core'], off: ['stars'] });
  });

  it('keeps an id in one list after a preset: the last flip wins, and a second switch-on lists it once', () => {
    expect(fold(fromPreset, { do: 'layers', on: ['moho'] }, { do: 'layers', off: ['moho'] }).layers).toEqual({ preset: 'sky', on: [], off: ['moho'] });
    expect(fold(fromPreset, { do: 'layers', off: ['moho'] }, { do: 'layers', on: ['moho'] }).layers).toEqual({ preset: 'sky', on: ['moho'], off: [] });
    expect(fold(fromPreset, { do: 'layers', on: ['moho'] }, { do: 'layers', on: ['moho'] }).layers).toEqual({ preset: 'sky', on: ['moho'], off: [] });
  });

  it('ends an id named both off and on in one action as on: off goes first, and the validator refuses such a cue', () => {
    expect(foldAction(fromPreset, { do: 'layers', on: ['moho'], off: ['moho'] }).layers).toEqual({ preset: 'sky', on: ['moho'], off: [] });
  });

  it('adds to a listed scene once and in order, and takes out what goes off', () => {
    const view = fold(fromList, { do: 'layers', on: ['shell-moho', 'globe-surface'], off: ['political'] }, { do: 'layers', on: ['inner-core'] });
    expect(view.layers).toEqual({ only: ['globe-surface', 'shell-moho', 'inner-core'] });
  });

  it('looks at a new target with or without a new width, and widens without moving', () => {
    expect(foldAction(fromPreset, { do: 'look', target: sun, fovDeg: 10 }).look).toEqual({ target: sun, fovDeg: 10 });
    expect(foldAction(fromPreset, { do: 'look', target: sun }).look).toEqual({ target: sun, fovDeg: 60 });
    expect(foldAction(fromPreset, { do: 'fov', fovDeg: 90 }).look).toEqual({ target: down, fovDeg: 90 });
  });

  it('puts a mark up, retexts it in place by target whatever its field order, and takes it down', () => {
    const ground: Target = { kind: 'ground', lat: 10, lon: 20, depthKm: 0 };
    const sameGround = { depthKm: 0, lon: 20, lat: 10, kind: 'ground' } as const;
    const up = fold(fromPreset, { do: 'mark', target: ground, text: 'Here' }, { do: 'mark', target: sun, text: 'The Sun' });
    expect(up.marks).toEqual([
      { target: ground, text: 'Here' },
      { target: sun, text: 'The Sun' },
    ]);
    const retexted = foldAction(up, { do: 'mark', target: sameGround, text: 'Still here' });
    expect(retexted.marks.map((mark) => mark.text)).toEqual(['Still here', 'The Sun']);
    expect(foldAction(up, { do: 'mark', target: sameGround, text: null }).marks).toEqual([{ target: sun, text: 'The Sun' }]);
    expect(foldAction(up, { do: 'mark', target: down, text: null }).marks).toEqual(up.marks);
  });

  it('changes nothing it is given', () => {
    const view = fold(fromPreset, { do: 'layers', on: ['moho'], off: ['stars'] }, { do: 'mark', target: sun, text: 'The Sun' });
    const actions: ViewAction[] = [
      { do: 'preset', id: 'earth' },
      { do: 'layers', on: ['stars'], off: ['moho'] },
      { do: 'look', target: down, fovDeg: 20 },
      { do: 'fov', fovDeg: 90 },
      { do: 'mark', target: sun, text: 'Again' },
      { do: 'mark', target: sun, text: null },
    ];
    for (const action of actions) {
      const before = structuredClone(view);
      foldAction(view, action);
      expect(view).toEqual(before);
    }
    const listed = structuredClone(fromList);
    foldAction(fromList, { do: 'layers', on: ['stars'], off: ['political'] });
    expect(fromList).toEqual(listed);
  });
});
