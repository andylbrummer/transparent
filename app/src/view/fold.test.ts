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
    // globe-surface, listed already, is turned on again after shell-moho, so it moves after it.
    const view = fold(fromList, { do: 'layers', on: ['shell-moho', 'globe-surface'], off: ['political'] }, { do: 'layers', on: ['inner-core'] });
    expect(view.layers).toEqual({ only: ['shell-moho', 'globe-surface', 'inner-core'] });
  });

  // Turning on one switch of an exclusive group turns the others off, so the last one turned on is the one that shows.
  it('lists switches turned on after a preset in the order they were last turned on', () => {
    const view = fold(fromPreset, { do: 'layers', on: ['a'] }, { do: 'layers', on: ['b'] }, { do: 'layers', on: ['a'] });
    expect(view.layers).toEqual({ preset: 'sky', on: ['b', 'a'], off: [] });
  });

  it('lists a listed scene in the order its switches were last turned on', () => {
    const view = fold({ ...fromList, layers: { only: ['p', 'a'] } }, { do: 'layers', on: ['b'] }, { do: 'layers', on: ['a'] });
    expect(view.layers).toEqual({ only: ['p', 'b', 'a'] });
  });

  it('keeps the order one action names, each id once', () => {
    expect(foldAction(fromPreset, { do: 'layers', on: ['a', 'b'] }).layers).toEqual({ preset: 'sky', on: ['a', 'b'], off: [] });
    expect(foldAction(fromPreset, { do: 'layers', on: ['a', 'a'] }).layers).toEqual({ preset: 'sky', on: ['a'], off: [] });
    expect(foldAction(fromList, { do: 'layers', on: ['a', 'a'] }).layers).toEqual({ only: ['globe-surface', 'political', 'a'] });
  });

  it('puts a switch turned off and on again at the end', () => {
    const view = fold(fromPreset, { do: 'layers', on: ['a', 'b'] }, { do: 'layers', off: ['a'] }, { do: 'layers', on: ['a'] });
    expect(view.layers).toEqual({ preset: 'sky', on: ['b', 'a'], off: [] });
    const listed = fold(fromList, { do: 'layers', off: ['globe-surface'] }, { do: 'layers', on: ['globe-surface'] });
    expect(listed.layers).toEqual({ only: ['political', 'globe-surface'] });
  });

  it("keeps each layer's last settings, through its switch going off and a preset", () => {
    const view = fold(
      fromPreset,
      { do: 'layers', on: ['waves'], params: { waves: { quake: 'tohoku2011', playing: true } } },
      { do: 'layers', off: ['waves'] },
      { do: 'preset', id: 'earth' },
      { do: 'layers', on: ['waves', 'ice'], params: { waves: { playing: false }, ice: { ka: 21 } } },
    );
    expect(view.params).toEqual({ waves: { quake: 'tohoku2011', playing: false }, ice: { ka: 21 } });
    // No settings, no field: a view folded from actions with none is as it was before settings existed.
    expect('params' in fold(fromPreset, { do: 'layers', on: ['waves'] })).toBe(false);
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
