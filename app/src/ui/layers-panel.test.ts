import { describe, it, expect, vi } from 'vitest';
import { LAYER_SWITCHES, LAYERS_STORAGE_KEY, LayersPanel, loadLayerVisibility } from './layers-panel';

describe('loadLayerVisibility', () => {
  it('turns everything on when nothing is saved', () => {
    const visibility = loadLayerVisibility(null);
    expect(Object.keys(visibility)).toEqual(LAYER_SWITCHES.map((s) => s.id));
    expect(Object.values(visibility).every(Boolean)).toBe(true);
  });

  it('takes saved booleans for known switches only', () => {
    const visibility = loadLayerVisibility(JSON.stringify({ faults: false, quakes: 'no', retired: false }));
    expect(visibility.faults).toBe(false);
    expect(visibility.quakes).toBe(true);
    expect('retired' in visibility).toBe(false);
  });

  it('reports and ignores an unreadable save', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(Object.values(loadLayerVisibility('{not json')).every(Boolean)).toBe(true);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});

describe('LayersPanel', () => {
  function setup() {
    const parent = document.createElement('div');
    const saved = new Map<string, string>();
    const onChange = vi.fn();
    const panel = new LayersPanel(parent, loadLayerVisibility(null), onChange, {
      setItem: (key, value) => saved.set(key, value),
    });
    return { parent, saved, onChange, panel };
  }

  it('opens and closes from its button', () => {
    const { parent } = setup();
    const button = parent.querySelector<HTMLButtonElement>('#layers-toggle')!;
    const list = parent.querySelector<HTMLElement>('#layers-panel')!;
    expect(list.hidden).toBe(true);
    button.click();
    expect(list.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    button.click();
    expect(list.hidden).toBe(true);
  });

  it('saves a flipped switch and reports which layer it was', () => {
    const { parent, saved, onChange } = setup();
    const faults = parent.querySelector<HTMLInputElement>('input[data-layer="faults"]')!;
    faults.checked = false;
    faults.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'faults' }), false);
    expect(JSON.parse(saved.get(LAYERS_STORAGE_KEY)!)).toMatchObject({ faults: false, quakes: true });
  });

  it('shows a legend for every line and interior layer', () => {
    const { parent } = setup();
    const withLegend = LAYER_SWITCHES.filter((s) => s.section !== 'Labels').length;
    expect(parent.querySelectorAll('.layer-switch__legend')).toHaveLength(withLegend);
  });
});
