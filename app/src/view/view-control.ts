/**
 * Does the view's actions (actions.ts). It is the one implementation:
 * guides, voice commands and later the voice AI all come through here, so
 * they cannot drift apart. Its collaborators are passed in, so it is
 * tested without the renderer.
 */

import type { LayerManager } from '../layers/manager';
import type { LayerSwitch, LayersPanel } from '../ui/layers-panel';
import type { LayerPreset } from '../ui/presets';
import type { ActionOutcome, ViewAction, ViewControl } from './actions';

export interface ViewControlDeps {
  /** Every preset an action may name. */
  readonly presets: readonly LayerPreset[];
  /** Every switch an action may name. */
  readonly switches: readonly LayerSwitch[];
  /** Switches are flipped through the panel, so its rows, the save and the scene stay in step. */
  readonly layersPanel: Pick<LayersPanel, 'applyPreset' | 'setLayer'>;
  /** The lazy layers: a switch-on is not done until its layer has loaded. */
  readonly lazyLayers: Pick<LayerManager, 'preload'>;
}

export function createViewControl(deps: ViewControlDeps): ViewControl {
  const switchesById = new Map(deps.switches.map((s) => [s.id, s]));

  /**
   * Wait for the lazy layers among `switches` to load; the rest are drawn
   * already. A failed load leaves its switch on with its chip, as a failed
   * tap does: putting the view back is the borrow's job. The preloads all
   * start before the first await, so one that throws for an unknown id
   * rejects perform rather than turning into an outcome.
   */
  async function lazyLayersLoaded(switches: readonly LayerSwitch[]): Promise<ActionOutcome> {
    const waits: { readonly id: string; readonly loading: Promise<void> }[] = [];
    for (const layer of switches) {
      if ('lazy' in layer.target) waits.push({ id: layer.id, loading: deps.lazyLayers.preload(layer.target.lazy) });
    }
    const results = await Promise.allSettled(waits.map((wait) => wait.loading));
    const failed = waits.filter((_, i) => results[i].status === 'rejected').map((wait) => wait.id);
    if (failed.length > 0) return { ok: false, code: 'layer-unavailable', message: `layer failed to load: ${failed.join(', ')}` };
    return { ok: true };
  }

  // The switches flip before the first await, so they have flipped by the
  // time perform returns; its promise then waits for the layers to load.
  async function perform(action: ViewAction): Promise<ActionOutcome> {
    switch (action.do) {
      case 'preset': {
        const preset = deps.presets.find((p) => p.id === action.id);
        if (!preset) return { ok: false, code: 'unknown-preset', message: `no preset ${action.id}` };
        deps.layersPanel.applyPreset(preset);
        const on = new Set(preset.on);
        return lazyLayersLoaded(deps.switches.filter((s) => on.has(s.id)));
      }
      case 'layers': {
        const on = action.on ?? [];
        const off = action.off ?? [];
        // Check everything before flipping anything, so a mistake leaves the view untouched.
        if (on.length === 0 && off.length === 0) return { ok: false, code: 'bad-value', message: 'layers names no switch' };
        const unknown = [...new Set([...off, ...on].filter((id) => !switchesById.has(id)))];
        if (unknown.length > 0) return { ok: false, code: 'unknown-layer', message: `no layer switch ${unknown.join(', ')}` };
        const both = [...new Set(on.filter((id) => off.includes(id)))];
        if (both.length > 0) return { ok: false, code: 'bad-value', message: `layers turns ${both.join(', ')} both on and off` };
        // Off before on, as applyPreset does: an exclusive group never has two on.
        for (const id of off) deps.layersPanel.setLayer(id, false);
        for (const id of on) deps.layersPanel.setLayer(id, true);
        return lazyLayersLoaded([...new Set(on)].map((id) => switchesById.get(id)!));
      }
    }
  }

  return { perform };
}
