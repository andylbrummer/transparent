import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CRATON_KINDS, CRATON_PALETTE, REWORKED_OFFSET } from './classes';
import type { CratonsData } from './cratons';
import definition from './layer';

interface BakedClass {
  readonly id: number;
  readonly name: string;
  readonly reworked: boolean;
  readonly count: number;
}
const baked = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/cratons.json'))) as CratonsData & { classes: BakedClass[] };

describe('the Archean crust colours', () => {
  it('give every class the bake wrote a colour, reworked ones fainter in the same hue', () => {
    const ids = CRATON_PALETTE.map(([id]) => id).sort((a, b) => a - b);
    expect(ids).toEqual(baked.classes.map((c) => c.id).sort((a, b) => a - b));
    for (const kind of CRATON_KINDS) {
      const intact = CRATON_PALETTE.find(([id]) => id === kind.id);
      const reworked = CRATON_PALETTE.find(([id]) => id === kind.id + REWORKED_OFFSET);
      expect(baked.classes.find((c) => c.id === kind.id)).toMatchObject({ name: kind.name, reworked: false });
      expect(reworked?.[1]).toBe(intact?.[1]);
      expect(reworked?.[2]).toBeLessThan(intact?.[2] ?? 0);
    }
  });
});

describe('the names', () => {
  it('are the craton groups, largest first, the Kaapvaal within the Kalahari Craton', () => {
    const names = baked.labels.map((l) => l.name);
    expect(names[0]).toBe('Congo Craton');
    expect(names).toContain('Superior Craton');
    expect(baked.labels.find((l) => l.name === 'Kalahari Craton')?.members).toContain('Kaapvaal Craton');
    const areas = baked.labels.map((l) => l.km2);
    expect(areas).toEqual([...areas].sort((a, b) => b - a));
  });
});

describe('the switch', () => {
  it('is off, on the surface, beside the provinces it was drawn from', () => {
    expect(definition.defaultOn).toBeUndefined();
    expect(definition.section).toBe('Surface');
    expect(definition.credits[0].url).toContain('zenodo.6586972');
    expect(definition.caption).toMatch(/2\.5 billion/);
  });
});
