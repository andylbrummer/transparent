import { describe, it, expect } from 'vitest';
import { paramProblems } from './params';
import type { LayerParams } from './types';

const params: LayerParams = {
  quake: { type: 'string', description: 'which earthquake', values: ['tohoku2011', 'sumatra2004'] },
  t: { type: 'number', description: 'seconds since the origin', minimum: 0, maximum: 10800 },
  speed: { type: 'number', description: 'compression', values: [30, 60] },
  playing: { type: 'boolean', description: 'whether it plays' },
};

describe('paramProblems', () => {
  it('passes settings the layer takes', () => {
    expect(paramProblems('waves', params, { quake: 'tohoku2011', t: 0, speed: 60, playing: true })).toEqual([]);
    expect(paramProblems('waves', params, { t: 10800 })).toEqual([]);
  });

  it('names a setting the layer does not have, and the ones it does', () => {
    expect(paramProblems('waves', params, { colour: 'red' })).toEqual(['waves has no setting colour: it has quake, t, speed, playing']);
    // Not a setting because every object has one by that name.
    expect(paramProblems('waves', params, { toString: 'x' })).toEqual(['waves has no setting toString: it has quake, t, speed, playing']);
  });

  it('refuses a value of the wrong kind, out of range, or not among the choices', () => {
    expect(paramProblems('waves', params, { quake: 'atlantis', t: -1, speed: 61, playing: 1 })).toEqual([
      'waves quake is one of tohoku2011, sumatra2004',
      'waves t is from 0 to 10800',
      'waves speed is one of 30, 60',
      'waves playing is true or false',
    ]);
    expect(paramProblems('waves', params, { t: Number.NaN })).toEqual(['waves t is a number']);
    expect(paramProblems('waves', params, { t: '5' })).toEqual(['waves t is a number']);
  });

  it('refuses settings for a layer that takes none, and an empty set', () => {
    expect(paramProblems('stars', undefined, { speed: 60 })).toEqual(['stars takes no settings']);
    expect(paramProblems('waves', params, {})).toEqual(['no setting given for waves']);
  });
});
