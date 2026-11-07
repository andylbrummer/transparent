/**
 * Layers panel: one switch per thing drawn through the Earth.
 *
 * Each switch names what it controls - surface line layers, label kinds,
 * or one of the interior layers - so the app applies them generically.
 * Choices persist per browser in localStorage under LAYERS_STORAGE_KEY.
 * The panel doubles as the legend: each switch shows the colours it draws.
 */

import { OUTLINE_STYLES, type OutlineLayerName } from '../render/outlines';
import type { LabelKind } from '../render/labels';
import { PLUME_COLOR, depthRampGradient } from '../render/interior';

export type InteriorLayerName = 'quakes' | 'slabs' | 'plumes';

export type LayerTarget =
  | { readonly lines: readonly OutlineLayerName[] }
  | { readonly labels: readonly LabelKind[] }
  | { readonly interior: InteriorLayerName };

export interface LayerSwitch {
  readonly id: string;
  readonly label: string;
  readonly section: 'Inside the Earth' | 'Surface lines' | 'Labels';
  readonly target: LayerTarget;
  /** CSS background for the legend bar; absent for labels. */
  readonly legend?: string;
  /** Text under the legend bar, e.g. its depth scale. */
  readonly caption?: string;
}

export type LayerVisibility = Record<string, boolean>;

export const LAYERS_STORAGE_KEY = 'transparent-earth.layers';

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
    id: 'slabs',
    label: 'Subducting slabs',
    section: 'Inside the Earth',
    target: { interior: 'slabs' },
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
    caption: 'ridge · transform · collision · subduction',
  },
  {
    id: 'faults',
    label: 'Active faults',
    section: 'Surface lines',
    target: { lines: FAULTS },
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

/** Everything on, overlaid with what was saved; unknown or non-boolean entries are ignored. */
export function loadLayerVisibility(saved: string | null): LayerVisibility {
  const visibility: LayerVisibility = Object.fromEntries(LAYER_SWITCHES.map((s) => [s.id, true]));
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

export class LayersPanel {
  private readonly button: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly onButtonClick = (): void => this.setOpen(this.panel.hidden);

  /** Calls `onChange` for each switch the user flips, after saving the new visibility. */
  constructor(
    parent: HTMLElement,
    private readonly visibility: LayerVisibility,
    private readonly onChange: (layer: LayerSwitch, visible: boolean) => void,
    private readonly storage: Pick<Storage, 'setItem'>
  ) {
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
    let section = '';
    for (const layer of LAYER_SWITCHES) {
      if (layer.section !== section) {
        section = layer.section;
        const heading = document.createElement('h2');
        heading.textContent = section;
        this.panel.appendChild(heading);
      }
      this.panel.appendChild(this.renderSwitch(layer));
    }
    parent.append(this.button, this.panel);
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
      this.storage.setItem(LAYERS_STORAGE_KEY, JSON.stringify(this.visibility));
      this.onChange(layer, input.checked);
    });
    const text = document.createElement('span');
    text.className = 'layer-switch__text';
    text.textContent = layer.label;
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

  setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
  }

  dispose(): void {
    this.button.removeEventListener('click', this.onButtonClick);
    this.button.remove();
    this.panel.remove();
  }
}
