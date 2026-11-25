import { describe, it, expect, vi } from 'vitest';
import {
  LAYER_SWITCHES,
  LAYERS_STORAGE_KEY,
  LayersPanel,
  SECTIONS_STORAGE_KEY,
  loadLayerVisibility,
  loadOpenSections,
  matchesFilter,
  canFade,
  switchesWithLazyLayers,
  type GuideCredits,
  type LayerSwitch,
} from './layers-panel';
import type { LayerDefinition } from '../layers/types';
import { defaultPreset, type LayerPreset } from './presets';

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

  function setup(saved: string | null = null, openSections?: Record<string, boolean>, guideCredits?: () => Promise<readonly GuideCredits[]>) {
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
        guideCredits,
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
    expect(sections).toEqual(['Weather', 'Surface', 'Surface lines', 'Inside the Earth', 'Sky maps', 'Labels']);
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

  it('flips a switch by id as a tap would, its group and the save following', () => {
    const { panel, changes, input, stored } = setup(JSON.stringify({ cmb: true }));
    panel.setLayer('x-ray', true);
    expect(changes).toEqual([
      ['cmb', false],
      ['x-ray', true],
    ]);
    expect(input('x-ray').checked).toBe(true);
    expect(input('cmb').checked).toBe(false);
    expect(JSON.parse(stored.get(LAYERS_STORAGE_KEY)!)).toMatchObject({ cmb: false, 'x-ray': true });
    expect(() => panel.setLayer('no-such-layer', true)).toThrow('no layer switch no-such-layer');
  });

  it('shows only the switches it is given, flipping just the ones that differ, off first, and saves', () => {
    const { panel, changes, input, switches, stored } = setup(JSON.stringify({ cmb: true }));
    const before = switches.filter((s) => input(s.id).checked).map((s) => s.id);
    panel.showOnly(['x-ray', 'clouds']);
    // clouds is on by default and stays on: it is not flipped.
    const off = before.filter((id) => id !== 'clouds').map((id): [string, boolean] => [id, false]);
    expect(changes).toEqual([...off, ['x-ray', true]]);
    for (const s of switches) expect(input(s.id).checked).toBe(s.id === 'x-ray' || s.id === 'clouds');
    expect(JSON.parse(stored.get(LAYERS_STORAGE_KEY)!)).toEqual(Object.fromEntries(switches.map((s) => [s.id, s.id === 'x-ray' || s.id === 'clouds'])));
  });

  it('saves nothing it shows while borrowed', () => {
    const { panel, stored, input } = setup();
    panel.borrow();
    panel.showOnly(['cmb']);
    expect(input('cmb').checked).toBe(true);
    expect(stored.has(LAYERS_STORAGE_KEY)).toBe(false);
  });

  it('refuses an unknown switch before flipping anything', () => {
    const { panel, changes, stored } = setup();
    expect(() => panel.showOnly(['cmb', 'no-such-layer'])).toThrow(new Error('no layer switch no-such-layer'));
    expect(changes).toEqual([]);
    expect(stored.has(LAYERS_STORAGE_KEY)).toBe(false);
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

  it('sets every switch from a preset, turning off before on, and lights the preset it matches', () => {
    const parent = document.createElement('div');
    const switches = switchesWithLazyLayers(definitions);
    const changes: [string, boolean][] = [];
    const stored = new Map<string, string>();
    const sky: LayerPreset = { id: 'sky', label: 'Sky', description: 'x-ray sky', on: ['x-ray'] };
    const panel = new LayersPanel(
      parent,
      loadLayerVisibility(JSON.stringify({ cmb: true }), switches),
      (layer: LayerSwitch, visible: boolean) => changes.push([layer.id, visible]),
      { setItem: (key, value) => stored.set(key, value) },
      { switches, presets: [defaultPreset(switches), sky] }
    );
    const button = (id: string): HTMLButtonElement => parent.querySelector<HTMLButtonElement>(`.layers-preset[data-preset="${id}"]`)!;
    expect(button('sky').getAttribute('aria-pressed')).toBe('false');
    expect(button('default').getAttribute('aria-pressed')).toBe('false');

    button('sky').click();
    // Everything that was on goes off first: an exclusive group is never doubled.
    expect(changes.at(-1)).toEqual(['x-ray', true]);
    expect(changes.filter(([, on]) => on)).toEqual([['x-ray', true]]);
    expect(changes.map(([id]) => id)).toContain('cmb');
    expect(parent.querySelector<HTMLInputElement>('input[data-layer="x-ray"]')!.checked).toBe(true);
    expect(parent.querySelector<HTMLInputElement>('input[data-layer="boundaries"]')!.checked).toBe(false);
    expect(JSON.parse(stored.get(LAYERS_STORAGE_KEY)!)).toMatchObject({ 'x-ray': true, cmb: false, boundaries: false });
    expect(button('sky').getAttribute('aria-pressed')).toBe('true');

    // A switch flipped by hand leaves the preset.
    const quakes = parent.querySelector<HTMLInputElement>('input[data-layer="quakes"]')!;
    quakes.checked = true;
    quakes.dispatchEvent(new Event('change'));
    expect(button('sky').getAttribute('aria-pressed')).toBe('false');

    panel.applyPreset(defaultPreset(switches));
    expect(button('default').getAttribute('aria-pressed')).toBe('true');
    panel.dispose();
  });

  /** Borrow a panel that starts with cmb on, then change it every way there is, checking nothing is saved. */
  function borrowAndChange() {
    const parts = setup(JSON.stringify({ cmb: true }));
    const { panel, input, switches, stored, sections, changes } = parts;
    const counts = (): string[] => sections().map((d) => d.querySelector('.layers-section__count')!.textContent!);
    const before = { checked: switches.map((s) => input(s.id).checked), counts: counts() };
    const borrow = panel.borrow();

    panel.setLayer('x-ray', true);
    expect(input('x-ray').checked).toBe(true);
    expect(input('cmb').checked).toBe(false);
    expect(stored.has(LAYERS_STORAGE_KEY)).toBe(false);

    panel.applyPreset({ id: 'lines', label: 'Lines', description: 'plates and quakes', on: ['boundaries', 'quakes'] });
    expect(input('x-ray').checked).toBe(false);
    expect(input('boundaries').checked).toBe(true);
    expect(stored.has(LAYERS_STORAGE_KEY)).toBe(false);

    parts.section('Surface lines').querySelector<HTMLButtonElement>('.layers-section__all-off')!.click();
    expect(input('boundaries').checked).toBe(false);
    expect(stored.has(LAYERS_STORAGE_KEY)).toBe(false);

    input('clouds').checked = true;
    input('clouds').dispatchEvent(new Event('change'));
    expect(changes.at(-1)).toEqual(['clouds', true]);
    expect(stored.has(LAYERS_STORAGE_KEY)).toBe(false);

    return { ...parts, borrow, before, counts };
  }

  it('flips switches as usual while borrowed, but saves none of them', () => {
    const { changes } = borrowAndChange();
    expect(changes.map(String)).toEqual(expect.arrayContaining(['cmb,false', 'x-ray,true', 'x-ray,false', 'boundaries,false', 'clouds,true']));
  });

  it('puts every switch back when the borrow ends, off before on, without saving', () => {
    const { borrow, before, counts, changes, switches, input, stored } = borrowAndChange();
    const changesBefore = changes.length;
    borrow.end();
    expect(switches.map((s) => input(s.id).checked)).toEqual(before.checked);
    const restored = changes.slice(changesBefore);
    expect(restored.length).toBeGreaterThan(0);
    const firstOn = restored.findIndex(([, on]) => on);
    expect(restored.slice(firstOn).every(([, on]) => on)).toBe(true);
    expect(restored).toContainEqual(['cmb', true]);
    expect(stored.has(LAYERS_STORAGE_KEY)).toBe(false);
    expect(counts()).toEqual(before.counts);
  });

  it('flips nothing when a borrow that changed nothing ends', () => {
    const { panel, changes } = setup();
    panel.borrow().end();
    expect(changes).toEqual([]);
  });

  it('saves as usual once the borrow has ended', () => {
    const { panel, stored } = setup();
    panel.borrow().end();
    panel.setLayer('x-ray', true);
    expect(JSON.parse(stored.get(LAYERS_STORAGE_KEY)!)).toMatchObject({ 'x-ray': true, cmb: false });
  });

  it('still saves which sections are open while borrowed: that is the panel, not the view', () => {
    const { panel, section, stored } = setup();
    panel.borrow();
    section('Labels').open = true;
    section('Labels').dispatchEvent(new Event('toggle'));
    expect(JSON.parse(stored.get(SECTIONS_STORAGE_KEY)!)).toEqual({ Labels: true });
  });

  it('refuses a second borrow while one is open, and the first still ends', () => {
    const { panel, input } = setup();
    const borrow = panel.borrow();
    panel.setLayer('x-ray', true);
    expect(() => panel.borrow()).toThrow('layers panel is already borrowed');
    borrow.end();
    expect(input('x-ray').checked).toBe(false);
  });

  it('refuses to end a borrow twice, even once a new borrow is open', () => {
    const { panel, input } = setup();
    const first = panel.borrow();
    first.end();
    expect(() => first.end()).toThrow('layers panel borrow has already ended');

    const second = panel.borrow();
    panel.setLayer('x-ray', true);
    expect(() => first.end()).toThrow('layers panel borrow has already ended');
    expect(input('x-ray').checked).toBe(true);
    second.end();
    expect(input('x-ray').checked).toBe(false);
  });

  it('lists the data credits with a link to each source', () => {
    const { parent } = setup();
    const link = parent.querySelector<HTMLAnchorElement>('.layers-credits a')!;
    expect(link.href).toBe('https://example.org/');
    expect(parent.querySelector('.layers-credits li')!.textContent).toBe('Clouds — A Source (public domain)');
  });

  it('lists each guide\u2019s credits under its title the first time the credits are opened', async () => {
    const guideCredits = vi.fn(async (): Promise<readonly GuideCredits[]> => [
      { title: 'Down through the Earth', credits: [{ what: 'Narration', source: 'Piper', licence: 'CC BY 4.0', url: 'https://example.org/n' }] },
    ]);
    const { parent } = setup(null, undefined, guideCredits);
    const block = parent.querySelector<HTMLDetailsElement>('.layers-credits')!;
    expect(guideCredits).not.toHaveBeenCalled();
    block.open = true;
    block.dispatchEvent(new Event('toggle'));
    await Promise.resolve();
    await Promise.resolve();
    expect(block.querySelector('h3')!.textContent).toBe('Guide: Down through the Earth');
    expect([...block.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Clouds — A Source (public domain)',
      'Narration — Piper (CC BY 4.0)',
    ]);
    block.dispatchEvent(new Event('toggle'));
    expect(guideCredits).toHaveBeenCalledOnce();
  });
});

describe('canFade', () => {
  it('lets the shells fade, and a lazy layer only when its definition says it fades', () => {
    const load = (): Promise<never> => Promise.reject(new Error('not loaded in this test'));
    const switches = switchesWithLazyLayers([
      { id: 'clouds', label: 'Clouds', section: 'Sky', credits: [], fades: true, load },
      { id: 'stars', label: 'Stars', section: 'Sky', credits: [], load },
    ]);
    const byId = (id: string): LayerSwitch => switches.find((s) => s.id === id)!;
    expect(canFade(byId('clouds'))).toBe(true);
    expect(canFade(byId('stars'))).toBe(false);
    const shells = LAYER_SWITCHES.filter((s) => 'shell' in s.target);
    expect(shells.length).toBeGreaterThan(0);
    for (const shell of shells) expect(canFade(shell)).toBe(true);
    for (const other of LAYER_SWITCHES.filter((s) => !('shell' in s.target))) expect(canFade(other)).toBe(false);
  });
});
