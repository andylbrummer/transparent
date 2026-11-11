import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEPOSIT_COLORS,
  DEPOSIT_SIZE_PX,
  FEATURED_DEPOSITS,
  FEATURED_SIZE_PX,
  depositLabelText,
  depositLegend,
  depositMarkers,
  featuredRows,
  type DepositData,
} from './deposits';
import definition from './layer';

/** The baked file itself. */
const data = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/mineral-deposits.json'))) as DepositData;

describe('the baked deposits', () => {
  it('are the 3,161 with a position, in seven groups', () => {
    expect(data.deposits).toHaveLength(3161);
    expect(new Set(data.deposits.map((r) => r[4]))).toEqual(new Set(Object.keys(DEPOSIT_COLORS)));
  });

  it('hold every featured name, and Bayan Obo as its rare-earth row', () => {
    const rows = featuredRows(data);
    expect(rows).toHaveLength(FEATURED_DEPOSITS.length);
    const bayan = rows.find((r) => r[0] === 'Bayan Obo');
    expect(bayan?.[5]).toMatch(/Rare earth/);
    expect(bayan?.[4]).toBe('critical');
  });
});

describe('the drawing', () => {
  it('colours each dot by its group and makes the named ones bigger', () => {
    const featured = featuredRows(data);
    const markers = depositMarkers(data.deposits, featured);
    expect(markers).toHaveLength(data.deposits.length);
    const kiruna = data.deposits.findIndex((r) => r[0] === 'Kiruna');
    expect(markers[kiruna]).toMatchObject({ color: DEPOSIT_COLORS.steel, sizePx: FEATURED_SIZE_PX, shape: 'disc' });
    expect(markers.filter((m) => m.sizePx === DEPOSIT_SIZE_PX)).toHaveLength(data.deposits.length - featured.length);
  });

  it('labels with name, commodities and country', () => {
    const kiruna = data.deposits.find((r) => r[0] === 'Kiruna');
    expect(kiruna && depositLabelText(kiruna)).toBe('Kiruna · Iron · Sweden');
  });

  it('has a legend band per group', () => {
    expect(depositLegend(['precious', 'base']).match(/#/g)).toHaveLength(2);
  });
});

describe('the switch', () => {
  it('is off, in the human world, crediting the USGS and saying there are no sizes', () => {
    expect(definition.defaultOn).toBeUndefined();
    expect(definition.section).toBe('Human world');
    expect(definition.credits[0].source).toContain('2005-1294');
    expect(definition.caption).toMatch(/no tonnages/);
  });
});
