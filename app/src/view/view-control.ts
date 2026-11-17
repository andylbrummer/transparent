/**
 * Does the view's actions (actions.ts). It is the one implementation:
 * guides, voice commands and later the voice AI all come through here, so
 * they cannot drift apart. Its collaborators are passed in, so it is
 * tested without the renderer.
 */

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
}

export function createViewControl(deps: ViewControlDeps): ViewControl {
  const switchIds = new Set(deps.switches.map((s) => s.id));

  // Async with no await yet: an async function runs synchronously up to its
  // first await, so the switches have flipped by the time perform returns.
  async function perform(action: ViewAction): Promise<ActionOutcome> {
    switch (action.do) {
      case 'preset': {
        const preset = deps.presets.find((p) => p.id === action.id);
        if (!preset) return { ok: false, code: 'unknown-preset', message: `no preset ${action.id}` };
        deps.layersPanel.applyPreset(preset);
        return { ok: true };
      }
      case 'layers': {
        const on = action.on ?? [];
        const off = action.off ?? [];
        // Check everything before flipping anything, so a mistake leaves the view untouched.
        if (on.length === 0 && off.length === 0) return { ok: false, code: 'bad-value', message: 'layers names no switch' };
        const unknown = [...new Set([...off, ...on].filter((id) => !switchIds.has(id)))];
        if (unknown.length > 0) return { ok: false, code: 'unknown-layer', message: `no layer switch ${unknown.join(', ')}` };
        const both = [...new Set(on.filter((id) => off.includes(id)))];
        if (both.length > 0) return { ok: false, code: 'bad-value', message: `layers turns ${both.join(', ')} both on and off` };
        // Off before on, as applyPreset does: an exclusive group never has two on.
        for (const id of off) deps.layersPanel.setLayer(id, false);
        for (const id of on) deps.layersPanel.setLayer(id, true);
        return { ok: true };
      }
    }
  }

  return { perform };
}
