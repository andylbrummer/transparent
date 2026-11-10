import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatKa, positionFromLocation, sliceAt, sliceDescription, sliceSpoken, sliceStatus, sliceText, type IceSheetsData } from './slices';
import definition from './layer';
import iceAge from '../ice-age/layer';

/** The baked file itself: what the layer will read. */
const data = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/ice-sheets.json'))) as IceSheetsData;
const byId = (id: string) => data.slices.find((slice) => slice.id === id)!;

describe('the baked slices', () => {
  it('are the paper’s 18, youngest first, each with its picture', () => {
    expect(data.slices).toHaveLength(18);
    expect(data.slices[0].id).toBe('lgm');
    expect(data.slices.at(-1)!.id).toBe('late-gauss');
    for (const [i, slice] of data.slices.entries()) {
      expect(slice.youngKa).toBeLessThanOrEqual(slice.oldKa);
      if (i > 0) expect(slice.youngKa).toBeGreaterThan(data.slices[i - 1].youngKa);
      expect(() => readFileSync(`public/${slice.file}`)).not.toThrow();
    }
  });
});

describe('formatKa', () => {
  it('writes thousands of years below a million, millions above', () => {
    expect(formatKa(30)).toBe('30 ka');
    expect(formatKa(26.5)).toBe('26.5 ka');
    expect(formatKa(2600)).toBe('2.6 Ma');
    expect(formatKa(3590)).toBe('3.59 Ma');
  });
});

describe('a slice on the control', () => {
  it('is nothing at the present and the slice in order after it', () => {
    expect(sliceAt(data, 0)).toBeNull();
    expect(sliceAt(data, 1)!.id).toBe('lgm');
    expect(sliceAt(data, 18)!.id).toBe('late-gauss');
    expect(sliceAt(data, 2.6)!.id).toBe('35ka');
    expect(sliceAt(data, 99)!.id).toBe('late-gauss');
  });

  it('shows its age range, in the units that suit it', () => {
    expect(sliceText(null)).toBe('today');
    expect(sliceText(byId('30ka'))).toBe('30 ka');
    expect(sliceText(byId('lgm'))).toBe('26.5–19 ka');
    expect(sliceText(byId('mis6'))).toBe('190–132 ka');
    expect(sliceText(byId('early-matuyama'))).toBe('2.6–1.78 Ma');
  });

  it('reads it out in years', () => {
    expect(sliceSpoken(null)).toBe('the present');
    expect(sliceSpoken(byId('30ka'))).toBe('30,000 years ago');
    expect(sliceSpoken(byId('mis6'))).toBe('MIS 6, 190,000 to 132,000 years ago');
  });

  it('says whether it is the largest extent or the warmest moment', () => {
    expect(sliceDescription(null)).toBe('');
    expect(sliceDescription(byId('mis6'))).toBe('MIS 6 · largest extent');
    expect(sliceDescription(byId('mis5a'))).toBe('MIS 5a · peak warmth');
    expect(sliceDescription(byId('30ka'))).toBe('largest extent');
  });

  it('puts the area in the chip', () => {
    expect(sliceStatus(byId('mis6'))).toBe('MIS 6 · ice 34 million km² · best estimate');
    expect(sliceStatus(byId('30ka'))).toBe('30 ka · ice 14 million km² · best estimate');
    expect(sliceStatus(null)).toBe('today: of these ice sheets only Greenland’s is left');
  });
});

describe('positionFromLocation', () => {
  it('opens at the slice named by ?ice=, else at the glacial maximum', () => {
    expect(positionFromLocation('?ice=mis6', data)).toBe(11);
    expect(positionFromLocation('?time=2026-01-01&ice=late-gauss', data)).toBe(18);
    expect(positionFromLocation('?ice=today', data)).toBe(0);
    expect(positionFromLocation('?ice=nonsense', data)).toBe(1);
    expect(positionFromLocation('', data)).toBe(1);
  });
});

describe('the switch', () => {
  it('is off, in the Surface section beside the LGM layer and exclusive with it, crediting the paper', () => {
    expect(definition.defaultOn).toBeUndefined();
    expect(definition.section).toBe('Surface');
    expect(definition.exclusiveGroup).toBeDefined();
    expect(iceAge.exclusiveGroup).toBe(definition.exclusiveGroup);
    expect(definition.credits[0].source).toContain('Batchelor');
    expect(definition.caption).toContain('best estimate');
  });
});
