import { describe, it, expect, vi } from 'vitest';
import {
  LAYER_SWITCHES,
  LAYERS_STORAGE_KEY,
  LayersPanel,
  loadLayerVisibility,
  switchesWithLazyLayers,
  type LayerSwitch,
} from './layers-panel';
import type { LayerDefinition } from '../layers/types';

describe('loadLayerVisibility', () => {
  it('gives every switch its default when nothing is saved', () => {
    const visibility = loadLayerVisibility(null);
    expect(Object.keys(visibility)).toEqual(LAYER_SWITCHES.map((s) => s.id));
    for (const layer of LAYER_SWITCHES) expect(visibility[layer.id]).toBe(!layer.defaultOff);
  });

  it('starts with the map, the plates, slabs and earthquakes, and leaves the arrow fields and faults off', () => {
    const on = Object.entries(loadLayerVisibility(null))
      .filter(([, visible]) => visible)
      .map(([id]) => id);
    expect(on).toEqual(expect.arrayContaining(['political', 'boundaries', 'spreading', 'quakes', 'plumes', 'place-labels']));
    for (const busy of ['mantle-flow', 'plate-motion', 'faults']) expect(on).not.toContain(busy);
  });

  it('keeps a saved choice for a layer that is now off by default', () => {
    // What a browser that used the app before the defaults changed has stored: every switch, as it was.
    const before = Object.fromEntries(LAYER_SWITCHES.map((s) => [s.id, true]));
    const visibility = loadLayerVisibility(JSON.stringify(before));
    expect(visibility['mantle-flow']).toBe(true);
    expect(visibility.faults).toBe(true);
  });

  it('takes saved booleans for known switches only', () => {
    const visibility = loadLayerVisibility(JSON.stringify({ boundaries: false, faults: true, quakes: 'no', retired: false }));
    expect(visibility.boundaries).toBe(false);
    expect(visibility.faults).toBe(true);
    expect(visibility.quakes).toBe(true);
    expect('retired' in visibility).toBe(false);
  });

  it('reports and ignores an unreadable save', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(loadLayerVisibility('{not json')).toEqual(loadLayerVisibility(null));
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
    const boundaries = parent.querySelector<HTMLInputElement>('input[data-layer="boundaries"]')!;
    boundaries.checked = false;
    boundaries.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'boundaries' }), false);
    expect(JSON.parse(saved.get(LAYERS_STORAGE_KEY)!)).toMatchObject({ boundaries: false, quakes: true });
  });

  it('shows a legend for every line and interior layer', () => {
    const { parent } = setup();
    const withLegend = LAYER_SWITCHES.filter((s) => s.section !== 'Labels').length;
    expect(parent.querySelectorAll('.layer-switch__legend')).toHaveLength(withLegend);
  });
});

describe('LayersPanel with lazy layers', () => {
  const lazy = (id: string, extra: Partial<LayerDefinition> = {}): LayerDefinition => ({
    id,
    label: id,
    section: 'Sky maps',
    credits: [],
    load: async () => ({ setVisible() {}, dispose() {} }),
    ...extra,
  });
  const definitions = [
    lazy('cmb', { exclusiveGroup: 'sky-map' }),
    lazy('x-ray', { exclusiveGroup: 'sky-map' }),
    lazy('clouds', { section: 'Weather', defaultOn: true }),
  ];

  function setup(saved: string | null = null) {
    const parent = document.createElement('div');
    const switches = switchesWithLazyLayers(definitions);
    const changes: [string, boolean][] = [];
    const panel = new LayersPanel(
      parent,
      loadLayerVisibility(saved, switches),
      (layer: LayerSwitch, visible: boolean) => changes.push([layer.id, visible]),
      { setItem: () => {} },
      {
        switches,
        credits: [{ what: 'Clouds', source: 'A Source', licence: 'public domain', url: 'https://example.org/' }],
      }
    );
    const input = (id: string): HTMLInputElement => parent.querySelector<HTMLInputElement>(`input[data-layer="${id}"]`)!;
    return { parent, panel, changes, input, switches };
  }

  it('starts lazy layers off unless they ask to be on, and orders sections as the panel lists them', () => {
    const { input, switches } = setup();
    expect(input('cmb').checked).toBe(false);
    expect(input('clouds').checked).toBe(true);
    expect(input('boundaries').checked).toBe(true);
    expect(input('faults').checked).toBe(false);
    const sections = [...new Set(switches.map((s) => s.section))];
    expect(sections).toEqual(['Weather', 'Surface lines', 'Inside the Earth', 'Sky maps', 'Labels']);
  });

  it('opens only the sections that have something switched on', () => {
    const { parent } = setup();
    const open = [...parent.querySelectorAll<HTMLDetailsElement>('details.layers-section')]
      .filter((d) => d.open)
      .map((d) => d.querySelector('summary')!.textContent);
    expect(open).toEqual(['Weather', 'Surface lines', 'Inside the Earth', 'Labels']);
  });

  it('turns the rest of an exclusive group off when one comes on', () => {
    const { changes, input } = setup(JSON.stringify({ cmb: true }));
    input('x-ray').checked = true;
    input('x-ray').dispatchEvent(new Event('change'));
    expect(changes).toEqual([
      ['cmb', false],
      ['x-ray', true],
    ]);
    expect(input('cmb').checked).toBe(false);
  });

  it('shows and clears a status chip beside a lazy switch', () => {
    const { parent, panel } = setup();
    const chip = parent.querySelector<HTMLElement>('input[data-layer="clouds"] + span .layer-switch__status')!;
    expect(chip.hidden).toBe(true);
    panel.setStatus('clouds', 'offline · snapshot 9 Nov', 'stale');
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toBe('offline · snapshot 9 Nov');
    expect(chip.dataset.tone).toBe('stale');
    panel.setStatus('clouds', null);
    expect(chip.hidden).toBe(true);
  });

  it('lists the data credits with a link to each source', () => {
    const { parent } = setup();
    const link = parent.querySelector<HTMLAnchorElement>('.layers-credits a')!;
    expect(link.href).toBe('https://example.org/');
    expect(parent.querySelector('.layers-credits li')!.textContent).toBe('Clouds — A Source (public domain)');
  });
});

