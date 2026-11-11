import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DSDP,
  IODP,
  ODP,
  PROGRAMME_COLORS,
  REVISITED_SIZE_PX,
  firstProgramme,
  holeLabelText,
  holeMarkers,
  programmeNames,
  revisitedHoles,
  type HoleData,
} from './holes';
import definition from './layer';

const data = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/drill-holes.json'))) as HoleData;

describe('the baked holes', () => {
  it('are 4,216 holes from 4,283 rows, most visited first', () => {
    expect(data.rows).toBe(4283);
    expect(data.holes).toHaveLength(4216);
    expect(data.holes[0][0]).toBe('504B');
  });
});

describe('programmes', () => {
  it('colour a hole by the first to drill it and list them all', () => {
    expect(firstProgramme(DSDP | ODP | IODP)).toBe('dsdp');
    expect(firstProgramme(ODP | IODP)).toBe('odp');
    expect(firstProgramme(IODP)).toBe('iodp');
    expect(programmeNames(DSDP | ODP)).toBe('DSDP, ODP');
  });
});

describe('the drawing', () => {
  it('rings and names the holes reopened on three or more cruises', () => {
    const named = revisitedHoles(data);
    expect(named.map((h) => h[0])).toContain('504B');
    expect(named.every((h) => h[4] >= 3)).toBe(true);
    const markers = holeMarkers(data.holes);
    expect(markers.filter((m) => m.shape === 'ring')).toHaveLength(named.length);
    const last = markers[markers.length - 1];
    expect(last).toMatchObject({ lon: -83.7303, shape: 'ring', sizePx: REVISITED_SIZE_PX, color: PROGRAMME_COLORS.dsdp });
    expect(holeLabelText(data.holes[0])).toBe('Hole 504B · 9 cruises · DSDP, ODP, IODP');
  });
});

describe('the switch', () => {
  it('is off, on the surface, and says why holes are not sized', () => {
    expect(definition.defaultOn).toBeUndefined();
    expect(definition.section).toBe('Surface');
    expect(definition.caption).toMatch(/not sized by depth/);
  });
});
