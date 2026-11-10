import { describe, it, expect, vi } from 'vitest';
import {
  LAYER_SWITCHES,
  LAYERS_STORAGE_KEY,
  LayersPanel,
  SECTIONS_STORAGE_KEY,
  loadLayerVisibility,
  loadOpenSections,
  matchesFilter,
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
    expect(on).not.toContain('faults');
  });

  it('keeps a saved choice for a layer that is now off by default', () => {
    // What a browser that used the app before the defaults changed has stored: every switch, as it was.
    const before = Object.fromEntries(LAYER_SWITCHES.map((s) => [s.id, true]));
    const visibility = loadLayerVisibility(JSON.stringify(before));
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

  function setup(saved: string | null = null, openSections?: Record<string, boolean>) {
    const parent = document.createElement('div');
    const switches = switchesWithLazyLayers(definitions);
    const changes: [string, boolean][] = [];
    const stored = new Map<string, string>();
    const panel = new LayersPanel(
      parent,
      loadLayerVisibility(saved, switches),
      (layer: LayerSwitch, visible: boolean) => changes.push([layer.id, visible]),
      { setItem: (key, value) => stored.set(key, value) },
      {
        switches,
        credits: [{ what: 'Clouds', source: 'A Source', licence: 'public domain', url: 'https://example.org/' }],
        openSections,
      }
    );
    const input = (id: string): HTMLInputElement => parent.querySelector<HTMLInputElement>(`input[data-layer="${id}"]`)!;
    const sections = (): HTMLDetailsElement[] => [...parent.querySelectorAll<HTMLDetailsElement>('details.layers-section:not(.layers-credits)')];
    const section = (name: string): HTMLDetailsElement => sections().find((d) => d.querySelector('summary span')!.textContent === name)!;
    const filter = (text: string): void => {
      const box = parent.querySelector<HTMLInputElement>('.layers-filter')!;
      box.value = text;
      box.dispatchEvent(new Event('input'));
    };
    return { parent, panel, changes, input, switches, stored, sections, section, filter };
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

  it('starts as a list of closed sections, each saying how much of it is on', () => {
    const { sections, section } = setup();
    expect(sections().every((d) => !d.open)).toBe(true);
    const count = (name: string): string => section(name).querySelector('.layers-section__count')!.textContent!;
    expect(count('Weather')).toBe('1 of 1 on');
    expect(count('Sky maps')).toBe('2');
    const linesOn = LAYER_SWITCHES.filter((l) => l.section === 'Surface lines' && !l.defaultOff).length;
    const lines = LAYER_SWITCHES.filter((l) => l.section === 'Surface lines').length;
    expect(count('Surface lines')).toBe(`${linesOn} of ${lines} on`);
  });

  it('opens the sections the user left open, and remembers the ones they open and close', () => {
    const { section, stored } = setup(null, { 'Sky maps': true, Weather: false });
    expect(section('Sky maps').open).toBe(true);
    expect(section('Weather').open).toBe(false);
    section('Labels').open = true;
    section('Labels').dispatchEvent(new Event('toggle'));
    section('Sky maps').open = false;
    section('Sky maps').dispatchEvent(new Event('toggle'));
    expect(JSON.parse(stored.get(SECTIONS_STORAGE_KEY)!)).toEqual({ 'Sky maps': false, Weather: false, Labels: true });
  });

  it('reads back saved sections, ignoring anything that is not a section left open or closed', () => {
    expect(loadOpenSections(null)).toEqual({});
    expect(loadOpenSections(JSON.stringify({ Sky: true, Weather: false, Labels: 'yes' }))).toEqual({ Sky: true, Weather: false });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(loadOpenSections('{not json')).toEqual({});
    expect(loadOpenSections('[1]')).toEqual({});
    error.mockRestore();
  });

  it('keeps the count in step with the switches, across an exclusive group', () => {
    const { input, section } = setup();
    const count = (): string => section('Sky maps').querySelector('.layers-section__count')!.textContent!;
    input('cmb').checked = true;
    input('cmb').dispatchEvent(new Event('change'));
    expect(count()).toBe('1 of 2 on');
    input('x-ray').checked = true;
    input('x-ray').dispatchEvent(new Event('change'));
    expect(count()).toBe('1 of 2 on');
    input('x-ray').checked = false;
    input('x-ray').dispatchEvent(new Event('change'));
    expect(count()).toBe('2');
  });

  it('turns a whole section off from its button, which is there only when something is on', () => {
    const { section, changes, stored, input } = setup();
    const lines = section('Surface lines');
    const button = lines.querySelector<HTMLButtonElement>('.layers-section__all-off')!;
    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Turn all Surface lines layers off');
    expect(section('Sky maps').querySelector<HTMLButtonElement>('.layers-section__all-off')!.hidden).toBe(true);
    button.click();
    const wereOn = LAYER_SWITCHES.filter((l) => l.section === 'Surface lines' && !l.defaultOff).map((l) => l.id);
    expect(changes).toEqual(wereOn.map((id) => [id, false]));
    expect(input('boundaries').checked).toBe(false);
    expect(button.hidden).toBe(true);
    expect(JSON.parse(stored.get(LAYERS_STORAGE_KEY)!)).toMatchObject({ boundaries: false, political: false, quakes: true });
  });

  it('filters to the switches that match, opening their sections, and puts everything back when cleared', () => {
    const { parent, section, sections, filter, input, stored } = setup(null, { Labels: true });
    filter('plate');
    const shown = [...parent.querySelectorAll<HTMLElement>('.layer-switch')].filter((row) => !row.hidden).map((row) => row.querySelector('input')!.dataset.layer);
    // "Seafloor spreading" answers too: its caption speaks of the plates parting.
    expect(shown).toEqual(['boundaries', 'spreading', 'plate-labels']);
    expect(sections().filter((d) => !d.hidden).map((d) => d.querySelector('summary span')!.textContent)).toEqual(['Surface lines', 'Labels']);
    expect(section('Surface lines').open).toBe(true);
    // A hidden switch is still a switch: the screenshot tool and saved choices reach it by data-layer.
    expect(input('clouds')).not.toBeNull();
    // Opening sections to show matches is not the user opening them.
    section('Surface lines').dispatchEvent(new Event('toggle'));
    expect(stored.has(SECTIONS_STORAGE_KEY)).toBe(false);

    // "Turn all off" would reach the switches the filter hides: it waits until the filter is cleared.
    expect(section('Surface lines').querySelector<HTMLButtonElement>('.layers-section__all-off')!.hidden).toBe(true);

    filter('zzz');
    expect(parent.querySelector<HTMLElement>('.layers-no-matches')!.hidden).toBe(false);

    filter('');
    expect(parent.querySelector<HTMLElement>('.layers-no-matches')!.hidden).toBe(true);
    expect([...parent.querySelectorAll<HTMLElement>('.layer-switch')].every((row) => !row.hidden)).toBe(true);
    expect(sections().every((d) => !d.hidden)).toBe(true);
    expect(section('Surface lines').open).toBe(false);
    expect(section('Labels').open).toBe(true);
    expect(section('Surface lines').querySelector<HTMLButtonElement>('.layers-section__all-off')!.hidden).toBe(false);
  });

  it('marks the page while it is open, so the stylesheet can clear the buttons it covers', () => {
    const { panel } = setup();
    panel.setOpen(true);
    expect(document.body.classList.contains('layers-open')).toBe(true);
    panel.setOpen(false);
    expect(document.body.classList.contains('layers-open')).toBe(false);
  });

  it('matches every word typed against name, caption and section', () => {
    const layer = { label: 'Radio, 408 MHz', caption: 'cosmic-ray electrons', section: 'Sky maps' as const };
    expect(matchesFilter(layer, 'radio')).toBe(true);
    expect(matchesFilter(layer, 'SKY electrons')).toBe(true);
    expect(matchesFilter(layer, 'radio x-ray')).toBe(false);
    expect(matchesFilter(layer, '  ')).toBe(true);
  });

  it('labels the filter box and keeps it and the section headings reachable', () => {
    const { parent, sections } = setup();
    const box = parent.querySelector<HTMLInputElement>('.layers-filter')!;
    expect(box.type).toBe('search');
    expect(box.getAttribute('aria-label')).toBe('Find a layer');
    // The count is part of the heading's text, so a screen reader hears "Weather 1 of 1 on".
    expect(sections()[0].querySelector('summary')!.textContent).toBe('Weather1 of 1 on');
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

