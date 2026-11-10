/**
 * Runs the lazy layers: loads one the first time it is switched on, keeps
 * its visibility in step with the switch through the load, and forwards
 * frames and resizes to whatever is loaded and showing.
 */

import type { FrameState, LayerContext, LayerDefinition, LayerInstance, StatusTone } from './types';

export type SharedLayerContext = Omit<LayerContext, 'setStatus'>;

const LOADING = 'loading…';

interface Slot {
  readonly definition: LayerDefinition;
  wanted: boolean;
  instance: LayerInstance | null;
  loading: boolean;
}

export class LayerManager {
  private readonly slots = new Map<string, Slot>();
  private resolution: { width: number; height: number } | null = null;
  private disposed = false;
  private readonly lastStatus = new Map<string, string | null>();

  constructor(
    definitions: readonly LayerDefinition[],
    private readonly shared: SharedLayerContext,
    private readonly onStatus: (id: string, text: string | null, tone: StatusTone) => void
  ) {
    for (const definition of definitions) {
      this.slots.set(definition.id, { definition, wanted: false, instance: null, loading: false });
    }
  }

  has(id: string): boolean {
    return this.slots.has(id);
  }

  setVisible(id: string, visible: boolean): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    slot.wanted = visible;
    if (slot.instance) {
      slot.instance.setVisible(visible);
    } else if (visible && !slot.loading) {
      void this.load(slot);
    }
  }

  private async load(slot: Slot): Promise<void> {
    const id = slot.definition.id;
    slot.loading = true;
    this.status(id, LOADING, 'info');
    const context: LayerContext = {
      ...this.shared,
      setStatus: (text, tone = 'info') => this.status(id, text, tone),
    };
    try {
      const instance = await slot.definition.load(context);
      if (this.disposed) {
        instance.dispose();
        return;
      }
      slot.instance = instance;
      if (this.resolution) instance.setResolution?.(this.resolution.width, this.resolution.height);
      instance.setVisible(slot.wanted);
      // A status the layer set for itself while loading (live, stale, offline) stays.
      if (this.lastStatus.get(id) === LOADING) this.status(id, null, 'info');
    } catch (error) {
      console.error(`layer "${id}" failed to load`, error);
      // Fail visibly: the switch keeps a chip saying so. Switching it on again retries.
      this.status(id, 'unavailable', 'error');
    } finally {
      slot.loading = false;
    }
  }

  private status(id: string, text: string | null, tone: StatusTone): void {
    this.lastStatus.set(id, text);
    this.onStatus(id, text, tone);
  }

  update(frame: FrameState): void {
    for (const slot of this.slots.values()) {
      if (slot.instance && slot.wanted) slot.instance.update?.(frame);
    }
  }

  setResolution(widthCss: number, heightCss: number): void {
    this.resolution = { width: widthCss, height: heightCss };
    for (const slot of this.slots.values()) slot.instance?.setResolution?.(widthCss, heightCss);
  }

  dispose(): void {
    this.disposed = true;
    for (const slot of this.slots.values()) {
      slot.instance?.dispose();
      slot.instance = null;
    }
  }
}
