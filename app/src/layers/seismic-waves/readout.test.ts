import { describe, it, expect } from 'vitest';
import { arrivalsAt } from './data';
import { loadBakedWaves } from './baked.testdata';
import { arrivalName, headlineArrivals, placeReadout } from './readout';

const data = loadBakedWaves();
// Tōhoku 2011 (29 km deep) seen from Austin, 91.5° away; and from inside both shadows, at 120°.
const austin = arrivalsAt(data, 29, 91.45);
const shadow = arrivalsAt(data, 29, 120);
const antipode = arrivalsAt(data, 29, 180);

describe('headlineArrivals', () => {
  it('keeps the first P, the first S and each surface wave', () => {
    expect(headlineArrivals(austin).map((arrival) => arrival.phase)).toEqual(['P', 'S', 'Love wave', 'Rayleigh wave']);
    // At the antipode the inner-core wave is first, the outer-core branches follow it: one P line.
    expect(headlineArrivals(antipode).map((arrival) => arrival.phase)).toEqual(['PKIKP', 'Love wave', 'Rayleigh wave']);
  });
});

describe('arrivalName', () => {
  it('names the wave as a person would feel it', () => {
    expect(arrivalName(headlineArrivals(austin)[0])).toBe('P wave');
    expect(arrivalName(headlineArrivals(antipode)[0])).toBe('core P wave (PKIKP)');
    expect(arrivalName(headlineArrivals(shadow)[0])).toBe('weak P wave bent round the core (Pdiff)');
    expect(arrivalName(headlineArrivals(austin)[3])).toBe('Rayleigh wave');
  });
});

describe('placeReadout', () => {
  it('counts down to the next wave', () => {
    const p = austin[0].timeS;
    expect(placeReadout(austin, p - 702, 'you', 240).next).toBe('P wave reaches you in 11 min 42 s');
    expect(placeReadout(austin, p + 1, 'you', 240).next).toMatch(/^S wave reaches you in /);
    expect(placeReadout(antipode, 0, 'the antipode', 240).next).toMatch(/^core P wave \(PKIKP\) in 20 min/);
  });

  it('says so when the first waves are all past, without claiming nothing more will come', () => {
    expect(placeReadout(austin, 3500, 'you', 240).next).toBe('the first P, S and surface waves have passed you');
  });

  it('lists the timetable since the origin', () => {
    expect(placeReadout(austin, 0, 'you', 240).timetable).toMatch(/^P 13:0\d · S 24:0\d · Love 38:\d\d · Rayleigh 45:\d\d$/);
  });

  it('says outright where no S wave comes', () => {
    expect(placeReadout(antipode, 0, 'the antipode', 240).timetable).toContain('no S (core shadow)');
    // In the shadow only the diffracted S arrives: it is named as such, not passed off as S.
    expect(placeReadout(shadow, 0, 'you', 240).timetable).toContain('Sdiff');
  });

  it('marks a wave as passing for a while after it arrives, and not before', () => {
    const p = austin[0].timeS;
    expect(placeReadout(austin, p - 1, 'you', 240).passing).toBeNull();
    expect(placeReadout(austin, p, 'you', 240).passing).toBe('P wave is passing under you now');
    expect(placeReadout(austin, p + 239, 'you', 240).passing).toBe('P wave is passing under you now');
    expect(placeReadout(austin, p + 241, 'you', 240).passing).toBeNull();
  });
});
