import { describe, it, expect } from 'vitest';
import { LAYER_DEFINITIONS } from '../layers/registry';
import { loadLayerVisibility, switchesWithLazyLayers } from './layers-panel';
import { LAYER_PRESETS, defaultPreset, matchesPreset, presetVisibility } from './presets';

const switches = switchesWithLazyLayers(LAYER_DEFINITIONS);

describe('LAYER_PRESETS', () => {
  it('names only switches that exist, each once, under unique ids', () => {
    const ids = new Set(switches.map((s) => s.id));
    for (const preset of LAYER_PRESETS) {
      expect(preset.on.filter((id) => !ids.has(id)), preset.id).toEqual([]);
      expect(new Set(preset.on).size, preset.id).toBe(preset.on.length);
    }
    const presetIds = [...LAYER_PRESETS.map((p) => p.id), defaultPreset(switches).id];
    expect(new Set(presetIds).size).toBe(presetIds.length);
  });

  it('never turns on two switches of one exclusive group', () => {
    const group = new Map(switches.map((s) => [s.id, s.exclusiveGroup]));
    for (const preset of LAYER_PRESETS) {
      const groups = preset.on.map((id) => group.get(id)).filter((g): g is string => g !== undefined);
      expect(new Set(groups).size, preset.id).toBe(groups.length);
    }
  });

  it('leaves the interior view with no surface or sky, and the sky views with no Earth in the way', () => {
    const preset = (id: string) => LAYER_PRESETS.find((p) => p.id === id)!;
    expect(preset('inside').on).not.toContain('globe-surface');
    expect(preset('inside').on).not.toContain('political');
    expect(preset('inside').on).not.toContain('stars');
    expect(preset('inside').on).toEqual(expect.arrayContaining(['shell-core', 'shell-inner-core', 'quakes']));
    for (const id of ['solar-system', 'deep-space', 'enhanced-sky', 'stars-and-dust', 'through-the-dust', 'glowing-gas', 'high-energy', 'cosmology']) {
      expect(preset(id).on.filter((on) => on === 'globe-surface' || on.startsWith('shell-')), id).toEqual([]);
      // Exactly one of the below-horizon switches: they set the same brightness.
      expect(preset(id).on.filter((on) => on === 'sky-below-horizon' || on === 'sky-whole'), id).toHaveLength(1);
    }
    expect(preset('enhanced-sky').on).toContain('sky-whole');
  });
});

describe('presets', () => {
  it('the default preset is the view the app opens with', () => {
    const preset = defaultPreset(switches);
    expect(presetVisibility(preset, switches)).toEqual(loadLayerVisibility(null, switches));
    expect(matchesPreset(preset, loadLayerVisibility(null, switches), switches)).toBe(true);
    expect(preset.on).toEqual(expect.arrayContaining(['globe-surface', 'shell-core', 'shell-inner-core']));
  });

  it('turns everything it does not name off', () => {
    const visibility = presetVisibility({ id: 'x', label: 'x', description: '', on: ['stars'] }, switches);
    expect(Object.entries(visibility).filter(([, on]) => on)).toEqual([['stars', true]]);
  });
});
