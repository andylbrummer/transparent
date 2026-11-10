/**
 * Layers panel: one switch per thing drawn through the Earth.
 *
 * Each switch names what it controls - surface line layers, label kinds,
 * or one of the interior layers - so the app applies them generically.
 * Choices persist per browser in localStorage under LAYERS_STORAGE_KEY.
 * The panel doubles as the legend: each switch shows the colours it draws.
 */

import { OUTLINE_STYLES, SPREADING_RIBBON_MYR, spreadingRampGradient, type OutlineLayerName } from '../render/outlines';
import type { LabelKind } from '../render/labels';
import { PLUME_COLOR, depthRampGradient } from '../render/interior';
import { LAYER_SECTIONS, type Credit, type LayerDefinition, type LayerSection, type StatusTone } from '../layers/types';

export type InteriorLayerName = 'quakes' | 'plumes';

export type LayerTarget =
  | { readonly lines: readonly OutlineLayerName[] }
  | { readonly labels: readonly LabelKind[] }
  | { readonly interior: InteriorLayerName }
  /** A lazy layer from src/layers, by id. */
  | { readonly lazy: string };

export interface LayerSwitch {
  readonly id: string;
  readonly label: string;
  readonly section: LayerSection;
  readonly target: LayerTarget;
  /**
   * Off until the user turns it on. The first view is kept to what reads at
   * a glance - the far side, the plates' edges, slabs, earthquakes, the
   * core - and the layers that draw a field of arrows or a tangle of lines
   * over all of it wait in the panel.
   */
  readonly defaultOff?: boolean;
  /** Switches sharing a group are exclusive. */
  readonly exclusiveGroup?: string;
  /** CSS background for the legend bar; absent for labels. */
  readonly legend?: string;
  /** Text under the legend bar, e.g. its depth scale. */
  readonly caption?: string;
}

export type LayerVisibility = Record<string, boolean>;

export const LAYERS_STORAGE_KEY = 'transparent-earth.layers';
/** Which sections of the panel the user left open. */
export const SECTIONS_STORAGE_KEY = 'transparent-earth.layer-sections';

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** Hard-stop bands, one per colour, for a line group's legend. */
function swatches(colors: readonly number[]): string {
  const step = 100 / colors.length;
  const bands = colors.map((c, i) => `${hex(c)} ${(i * step).toFixed(1)}% ${((i + 1) * step).toFixed(1)}%`);
  return `linear-gradient(to right, ${bands.join(', ')})`;
}

const lineColors = (names: readonly OutlineLayerName[]): number[] => names.map((n) => OUTLINE_STYLES[n].color);

const BOUNDARIES: readonly OutlineLayerName[] = ['ridge', 'transform', 'collision', 'subduction'];
const FAULTS: readonly OutlineLayerName[] = ['fault-normal', 'fault-reverse', 'fault-strike-slip'];
const POLITICAL: readonly OutlineLayerName[] = ['coastline', 'borders', 'states'];
const DEPTH_LEGEND_KM = 700;

export const LAYER_SWITCHES: readonly LayerSwitch[] = [
  {
    id: 'quakes',
    label: 'Earthquakes, M5+ since 1973',
    section: 'Inside the Earth',
    target: { interior: 'quakes' },
    legend: depthRampGradient(DEPTH_LEGEND_KM),
    caption: 'depth 0 – 700 km',
  },
  {
    id: 'plumes',
    label: 'Mantle plumes',
    section: 'Inside the Earth',
    target: { interior: 'plumes' },
    legend: hex(PLUME_COLOR),
    caption: 'faint: may reach the core',
  },
  {
    id: 'boundaries',
    label: 'Plate boundaries',
    section: 'Surface lines',
    target: { lines: BOUNDARIES },
    legend: swatches(lineColors(BOUNDARIES)),
    caption: 'ridge · transform · collision · subduction, teeth on the overriding plate',
  },
  {
    id: 'spreading',
    label: 'Seafloor spreading',
    section: 'Surface lines',
    target: { lines: ['spreading'] },
    legend: spreadingRampGradient(),
    caption: `ribbon = seafloor made in ${SPREADING_RIBBON_MYR} Myr at today's rate · colour 0 – 160 mm/yr · arrows: the plates parting`,
  },
  {
    id: 'faults',
    label: 'Active faults',
    section: 'Surface lines',
    target: { lines: FAULTS },
    // Dense over every mountain belt, in three colours beside the boundaries' four.
    defaultOff: true,
    legend: swatches(lineColors(FAULTS)),
    caption: 'normal · reverse · strike-slip',
  },
  {
    id: 'political',
    label: 'Coastlines and borders',
    section: 'Surface lines',
    target: { lines: POLITICAL },
    legend: swatches(lineColors(POLITICAL)),
  },
  { id: 'place-labels', label: 'Places', section: 'Labels', target: { labels: ['country', 'state', 'city'] } },
  { id: 'plate-labels', label: 'Plates', section: 'Labels', target: { labels: ['plate'] } },
  { id: 'deep-labels', label: 'Deep structures', section: 'Labels', target: { labels: ['deep'] } },
  { id: 'hotspot-labels', label: 'Hotspots', section: 'Labels', target: { labels: ['hotspot'] } },
  { id: 'quake-labels', label: 'Great earthquakes, M8+', section: 'Labels', target: { labels: ['quake'] } },
  { id: 'subduction-labels', label: 'Subduction zones', section: 'Labels', target: { labels: ['subduction'] } },
  { id: 'volcano-labels', label: 'Volcanoes', section: 'Labels', target: { labels: ['volcano'] } },
];

/** The panel's switches for the lazy layers, after the always-loaded ones of their section. */
export function switchesWithLazyLayers(definitions: readonly LayerDefinition[]): LayerSwitch[] {
  const lazy = definitions.map(
    (d): LayerSwitch => ({
      id: d.id,
      label: d.label,
      section: d.section,
      target: { lazy: d.id },
      legend: d.legend,
      caption: d.caption,
      defaultOff: !d.defaultOn,
      exclusiveGroup: d.exclusiveGroup,
    })
  );
  const all = [...LAYER_SWITCHES, ...lazy];
  // Stable: within a section the given order holds.
  return all.sort((a, b) => LAYER_SECTIONS.indexOf(a.section) - LAYER_SECTIONS.indexOf(b.section));
}

/** Each switch's default, overlaid with what was saved; unknown or non-boolean entries are ignored. */
export function loadLayerVisibility(saved: string | null, switches: readonly LayerSwitch[] = LAYER_SWITCHES): LayerVisibility {
  const visibility: LayerVisibility = Object.fromEntries(switches.map((s) => [s.id, !s.defaultOff]));
  if (saved === null) return visibility;
  let parsed: unknown;
  try {
    parsed = JSON.parse(saved);
  } catch (error) {
    console.error(`ignoring unreadable ${LAYERS_STORAGE_KEY}`, error);
    return visibility;
  }
  if (typeof parsed !== 'object' || parsed === null) return visibility;
  for (const [id, on] of Object.entries(parsed)) {
    if (id in visibility && typeof on === 'boolean') visibility[id] = on;
  }
  return visibility;
}

/** The saved open/closed state of the panel's sections; anything unreadable is no state. */
export function loadOpenSections(saved: string | null): Record<string, boolean> {
  if (saved === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(saved);
  } catch (error) {
    console.error(`ignoring unreadable ${SECTIONS_STORAGE_KEY}`, error);
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  return Object.fromEntries(Object.entries(parsed).filter(([, open]) => typeof open === 'boolean')) as Record<string, boolean>;
}

/** Whether a switch answers a filter: every word typed is in its name, caption or section. */
export function matchesFilter(layer: Pick<LayerSwitch, 'label' | 'caption' | 'section'>, filter: string): boolean {
  const text = `${layer.label} ${layer.caption ?? ''} ${layer.section}`.toLowerCase();
  return filter
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

export interface LayersPanelOptions {
  /** Defaults to the always-loaded LAYER_SWITCHES. */
  readonly switches?: readonly LayerSwitch[];
  /** Listed under "Data credits" at the foot of the panel. */
  readonly credits?: readonly Credit[];
  /**
   * Sections as the user left them (loadOpenSections). A section with no
   * entry starts closed: with a hundred switches the panel opens as a list
   * of its sections, each saying how much of it is on.
   */
  readonly openSections?: Readonly<Record<string, boolean>>;
}

interface SectionParts {
  readonly block: HTMLDetailsElement;
  readonly count: HTMLElement;
  readonly allOff: HTMLButtonElement;
  readonly layers: LayerSwitch[];
  readonly rows: HTMLElement[];
}

export class LayersPanel {
  private readonly button: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly filter: HTMLInputElement;
  private readonly noMatches: HTMLElement;
  private readonly switches: readonly LayerSwitch[];
  private readonly inputs = new Map<string, HTMLInputElement>();
  private readonly chips = new Map<string, HTMLElement>();
  private readonly sections = new Map<string, SectionParts>();
  /** Sections as the user has them, kept apart from what a filter forces open. */
  private readonly openSections: Record<string, boolean>;
  private filtering = false;
  private readonly onButtonClick = (): void => this.setOpen(this.panel.hidden);

  /** Calls `onChange` for each switch that flips, after saving the new visibility. */
  constructor(
    parent: HTMLElement,
    private readonly visibility: LayerVisibility,
    private readonly onChange: (layer: LayerSwitch, visible: boolean) => void,
    private readonly storage: Pick<Storage, 'setItem'>,
    options: LayersPanelOptions = {}
  ) {
    this.switches = options.switches ?? LAYER_SWITCHES;
    this.openSections = { ...options.openSections };
    this.button = document.createElement('button');
    this.button.id = 'layers-toggle';
    this.button.type = 'button';
    this.button.textContent = 'Layers';
    this.button.setAttribute('aria-controls', 'layers-panel');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.addEventListener('click', this.onButtonClick);

    this.panel = document.createElement('div');
    this.panel.id = 'layers-panel';
    this.panel.className = 'layers-panel';
    this.panel.hidden = true;

    // Find a layer by name: quicker than opening sections to look for it.
    this.filter = document.createElement('input');
    this.filter.type = 'search';
    this.filter.className = 'layers-filter';
    this.filter.placeholder = `Find among ${this.switches.length} layers`;
    this.filter.setAttribute('aria-label', 'Find a layer');
    this.filter.autocomplete = 'off';
    this.filter.addEventListener('input', () => this.applyFilter());
    this.panel.appendChild(this.filter);
    this.noMatches = document.createElement('p');
    this.noMatches.className = 'layers-no-matches';
    this.noMatches.textContent = 'No layer of that name.';
    this.noMatches.hidden = true;
    this.panel.appendChild(this.noMatches);

    // One collapsible block per section.
    for (const layer of this.switches) {
      let section = this.sections.get(layer.section);
      if (!section) {
        section = this.renderSection(layer.section);
        this.sections.set(layer.section, section);
        this.panel.appendChild(section.block);
      }
      const row = this.renderSwitch(layer);
      section.layers.push(layer);
      section.rows.push(row);
      section.block.appendChild(row);
    }
    for (const name of this.sections.keys()) this.updateSection(name);
    if (options.credits && options.credits.length > 0) this.panel.appendChild(renderCredits(options.credits));
    parent.append(this.button, this.panel);
  }

  private renderSection(name: string): SectionParts {
    const block = document.createElement('details');
    block.className = 'layers-section';
    block.open = this.openSections[name] ?? false;
    const heading = document.createElement('summary');
    const title = document.createElement('span');
    title.textContent = name;
    const count = document.createElement('span');
    count.className = 'layers-section__count';
    heading.append(title, count);
    block.appendChild(heading);
    // Remember what the user opens and closes - not what a filter opens to show its matches.
    block.addEventListener('toggle', () => {
      if (this.filtering || this.openSections[name] === block.open) return;
      this.openSections[name] = block.open;
      this.storage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(this.openSections));
    });
    const allOff = document.createElement('button');
    allOff.type = 'button';
    allOff.className = 'layers-section__all-off';
    allOff.textContent = 'Turn all off';
    allOff.setAttribute('aria-label', `Turn all ${name} layers off`);
    allOff.addEventListener('click', () => this.turnSectionOff(name));
    block.appendChild(allOff);
    return { block, count, allOff, layers: [], rows: [] };
  }

  /** The section's count of what is on, and whether there is anything for "Turn all off" to do. */
  private updateSection(name: string): void {
    const section = this.sections.get(name);
    if (!section) return;
    const on = section.layers.filter((layer) => this.visibility[layer.id]).length;
    section.count.textContent = on === 0 ? `${section.layers.length}` : `${on} of ${section.layers.length} on`;
    section.count.classList.toggle('layers-section__count--on', on > 0);
    // Not while filtering: it would switch off layers the filter is hiding.
    section.allOff.hidden = on === 0 || this.filtering;
  }

  private turnSectionOff(name: string): void {
    const section = this.sections.get(name);
    if (!section) return;
    for (const layer of section.layers) {
      if (!this.visibility[layer.id]) continue;
      this.visibility[layer.id] = false;
      this.inputs.get(layer.id)!.checked = false;
      this.onChange(layer, false);
    }
    this.storage.setItem(LAYERS_STORAGE_KEY, JSON.stringify(this.visibility));
    this.updateSection(name);
  }

  /** Show only the switches that answer the filter box, in sections opened to show them. */
  private applyFilter(): void {
    const text = this.filter.value.trim();
    this.filtering = text !== '';
    let matches = 0;
    for (const [name, section] of this.sections) {
      let shown = 0;
      section.layers.forEach((layer, i) => {
        const match = !this.filtering || matchesFilter(layer, text);
        section.rows[i].hidden = !match;
        if (match) shown++;
      });
      section.block.hidden = shown === 0;
      section.block.open = this.filtering ? shown > 0 : (this.openSections[name] ?? false);
      this.updateSection(name);
      matches += shown;
    }
    this.noMatches.hidden = matches > 0;
  }

  private renderSwitch(layer: LayerSwitch): HTMLElement {
    const row = document.createElement('label');
    row.className = 'layer-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.visibility[layer.id];
    input.dataset.layer = layer.id;
    input.addEventListener('change', () => {
      this.visibility[layer.id] = input.checked;
      // Exclusive group: the others go off before this one comes on.
      if (input.checked && layer.exclusiveGroup) {
        for (const other of this.switches) {
          if (other.id === layer.id || other.exclusiveGroup !== layer.exclusiveGroup || !this.visibility[other.id]) continue;
          this.visibility[other.id] = false;
          this.inputs.get(other.id)!.checked = false;
          this.onChange(other, false);
        }
      }
      this.storage.setItem(LAYERS_STORAGE_KEY, JSON.stringify(this.visibility));
      this.onChange(layer, input.checked);
      // An exclusive group can reach into another section.
      for (const name of this.sections.keys()) this.updateSection(name);
    });
    this.inputs.set(layer.id, input);
    const text = document.createElement('span');
    text.className = 'layer-switch__text';
    const name = document.createElement('span');
    name.textContent = layer.label;
    text.appendChild(name);
    if ('lazy' in layer.target) {
      const chip = document.createElement('span');
      chip.className = 'layer-switch__status';
      chip.hidden = true;
      name.append(' ', chip);
      this.chips.set(layer.id, chip);
    }
    if (layer.legend) {
      const bar = document.createElement('span');
      bar.className = 'layer-switch__legend';
      bar.style.background = layer.legend;
      text.appendChild(bar);
    }
    if (layer.caption) {
      const caption = document.createElement('span');
      caption.className = 'layer-switch__caption';
      caption.textContent = layer.caption;
      text.appendChild(caption);
    }
    row.append(input, text);
    return row;
  }

  /** Show a lazy layer's state beside its switch - loading, live, stale, unavailable - or clear it with null. */
  setStatus(id: string, text: string | null, tone: StatusTone = 'info'): void {
    const chip = this.chips.get(id);
    if (!chip) return;
    chip.hidden = text === null;
    chip.textContent = text ?? '';
    chip.dataset.tone = tone;
  }

  setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    // For the stylesheet: on a narrow screen the open panel takes the place of the buttons beside it.
    document.body.classList.toggle('layers-open', open);
  }

  dispose(): void {
    document.body.classList.remove('layers-open');
    this.button.removeEventListener('click', this.onButtonClick);
    this.button.remove();
    this.panel.remove();
  }
}

/** The credits list: what, who, licence, each linking to its source. */
function renderCredits(credits: readonly Credit[]): HTMLElement {
  const block = document.createElement('details');
  block.className = 'layers-section layers-credits';
  const heading = document.createElement('summary');
  heading.textContent = 'Data credits';
  block.appendChild(heading);
  const list = document.createElement('ul');
  for (const credit of credits) {
    const item = document.createElement('li');
    const what = document.createElement('strong');
    what.textContent = credit.what;
    const link = document.createElement('a');
    link.href = credit.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = credit.source;
    item.append(what, ' — ', link, ` (${credit.licence})`);
    list.appendChild(item);
  }
  block.appendChild(list);
  return block;
}
