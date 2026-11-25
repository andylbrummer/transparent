import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import { PLANET_NAMES } from '@transparent-earth/core';
import { MAX_FOV_DEG, MIN_FOV_DEG } from '../input/look';
import { LABEL_KIND_ORDER } from '../render/labels';
import { ID_PATTERN } from '../guides/format';
import { TARGET_SCHEMA, VIEW_ACTION_SCHEMA } from './action-schema';
import { FOV_NEEDS_TARGET_BELOW_DEG } from './view-control';

const ajv = new Ajv2020();
const isTarget = ajv.compile(TARGET_SCHEMA);
const isAction = ajv.compile(VIEW_ACTION_SCHEMA);

type TargetVariant = (typeof TARGET_SCHEMA.oneOf)[number];
type ActionVariant = (typeof VIEW_ACTION_SCHEMA.oneOf)[number];

/** The schema of one kind of target, typed as that kind. */
const kind = <K extends TargetVariant['properties']['kind']['const']>(name: K) =>
  TARGET_SCHEMA.oneOf.find((variant): variant is Extract<TargetVariant, { properties: { kind: { const: K } } }> => variant.properties.kind.const === name)!;

/** The schema of one action, typed as that action. */
const action = <D extends ActionVariant['properties']['do']['const']>(name: D) =>
  VIEW_ACTION_SCHEMA.oneOf.find((variant): variant is Extract<ActionVariant, { properties: { do: { const: D } } }> => variant.properties.do.const === name)!;

const sun = { kind: 'body', body: 'sun' };

describe('the action schema', () => {
  it('compiles under strict mode', () => {
    expect(() => new Ajv2020().compile(TARGET_SCHEMA)).not.toThrow();
    expect(() => new Ajv2020().compile(VIEW_ACTION_SCHEMA)).not.toThrow();
  });

  it.each([
    sun,
    { kind: 'body', body: 'neptune' },
    { kind: 'sky', raDeg: 83.8, decDeg: -5.4 },
    { kind: 'sky', raDeg: 0, decDeg: 90, name: 'Orion Nebula', extentDeg: 180 },
    { kind: 'horizon', azDeg: 0, altDeg: -90 },
    { kind: 'ground', lat: 19.4, lon: -155.3 },
    { kind: 'ground', lat: -90, lon: 180, depthKm: 6371, name: 'Kilauea' },
    { kind: 'label', name: 'Georgia' },
    { kind: 'label', name: 'Georgia', labelKind: 'country' },
  ])('takes the target %o', (target) => {
    expect(isTarget(target)).toBe(true);
  });

  it.each([
    { do: 'preset', id: 'sky' },
    { do: 'layers', on: ['x-ray'] },
    { do: 'layers', off: ['clouds'] },
    { do: 'layers', on: ['x-ray'], off: ['clouds'] },
    { do: 'look', target: sun },
    { do: 'look', target: sun, fovDeg: MIN_FOV_DEG },
    { do: 'fov', fovDeg: MAX_FOV_DEG },
    { do: 'mark', target: sun, text: 'The Sun' },
    { do: 'mark', target: sun, text: null },
    { do: 'stand', place: { kind: 'here' } },
    { do: 'time', to: 'now' },
    { do: 'time', to: '2011-03-11T05:46:24Z', rate: 0 },
    { do: 'time', to: '2011-03-11T05:46-05:00', rate: -31_557_600, until: '2010-03-11T05:46Z' },
    { do: 'stand', place: { kind: 'antipode' } },
    { do: 'stand', place: { kind: 'at', lat: 90, lon: 0, name: 'North Pole' } },
    { do: 'clip', hotspot: 'prem' },
    { do: 'clip', hotspot: null },
  ])('takes the action %o', (viewAction) => {
    expect(isAction(viewAction)).toBe(true);
  });

  it.each([
    ['an unknown field', { do: 'preset', id: 'sky', speed: 2 }],
    ['an unknown action', { do: 'spin' }],
    ['an unknown target kind', { do: 'look', target: { kind: 'star', name: 'Vega' } }],
    ['a look with no target', { do: 'look', fovDeg: 30 }],
    ['a field of view of 0', { do: 'look', target: sun, fovDeg: 0 }],
    ['a field of view of 101', { do: 'look', target: sun, fovDeg: 101 }],
    ['a field of view too narrow without a target', { do: 'fov', fovDeg: 29 }],
    ['layers naming no switch', { do: 'layers' }],
    ['an empty list of switches', { do: 'layers', on: [] }],
    ['a switch named twice', { do: 'layers', on: ['x-ray', 'x-ray'] }],
    ['an empty mark', { do: 'mark', target: sun, text: '' }],
    ['an azimuth of 360', { do: 'look', target: { kind: 'horizon', azDeg: 360, altDeg: 0 } }],
    ['an altitude of 91', { do: 'look', target: { kind: 'horizon', azDeg: 0, altDeg: 91 } }],
    ['a latitude of 91', { do: 'look', target: { kind: 'ground', lat: 91, lon: 0 } }],
    ['a longitude of 181', { do: 'look', target: { kind: 'ground', lat: 0, lon: 181 } }],
    ['a depth above the ground', { do: 'look', target: { kind: 'ground', lat: 0, lon: 0, depthKm: -1 } }],
    ['an unknown body', { do: 'look', target: { kind: 'body', body: 'pluto' } }],
    ['an unknown label kind', { do: 'look', target: { kind: 'label', name: 'Tuzo', labelKind: 'ocean' } }],
    ['an empty preset id', { do: 'preset', id: '' }],
    ['a stand with no place', { do: 'stand' }],
    ['a time with no instant', { do: 'time', rate: 2 }],
    ['a time at a date with no time', { do: 'time', to: '2011-03-11' }],
    ['a time at a word', { do: 'time', to: 'tomorrow' }],
    ['a clock rate over a year a second', { do: 'time', to: 'now', rate: 31_557_601 }],
    ['a stop that is not an instant', { do: 'time', to: 'now', until: 'later' }],
    ['a place with no name', { do: 'stand', place: { kind: 'at', lat: 0, lon: 0 } }],
    ['a place off the globe', { do: 'stand', place: { kind: 'at', lat: 91, lon: 0, name: 'Nowhere' } }],
    ['a place that is not here with a position', { do: 'stand', place: { kind: 'here', lat: 0 } }],
    ['a clip naming no hotspot', { do: 'clip' }],
    ['a clip whose hotspot is no id', { do: 'clip', hotspot: 'PREM model' }],
  ])('refuses %s', (_, viewAction) => {
    expect(isAction(viewAction)).toBe(false);
  });

  it('names exactly the bodies the ephemeris has', () => {
    expect(kind('body').properties.body.enum).toEqual(['sun', 'moon', ...PLANET_NAMES]);
  });

  it('names exactly the label kinds the label layer has', () => {
    expect(new Set(kind('label').properties.labelKind.enum)).toEqual(new Set(LABEL_KIND_ORDER));
  });

  it('names a hotspot as a guide names its ids', () => {
    expect(action('clip').properties.hotspot.anyOf[0].pattern).toBe(ID_PATTERN);
  });

  it('holds a field of view to the range the view control enforces', () => {
    expect(action('look').properties.fovDeg).toMatchObject({ minimum: MIN_FOV_DEG, maximum: MAX_FOV_DEG });
    expect(action('fov').properties.fovDeg).toMatchObject({ minimum: FOV_NEEDS_TARGET_BELOW_DEG, maximum: MAX_FOV_DEG });
  });
});
