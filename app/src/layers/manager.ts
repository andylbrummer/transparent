/**
 * Runs the lazy layers: loads one the first time it is switched on, keeps
 * its visibility in step with the switch through the load, and forwards
 * frames and resizes to whatever is loaded and showing. A layer can also be
 * loaded ahead of need, and a load can be waited on.
 */

import type { FrameState, LayerContext, LayerDefinition, LayerInstance, StatusTone } from './types';

export type SharedLayerContext = Omit<LayerContext, 'setStatus'>;

const LOADING = 'loading…';

interface Slot {
  readonly definition: LayerDefinition;
  wanted: boolean;
  instance: LayerInstance | null;
  /** The load in flight, shared by everyone waiting on it; null when none is. */
  loading: Promise<void> | null;
}

export class LayerManager {
  private readonly slots = new Map<string, Slot>();
  private resolution: { width: number; height: number } | null = null;
  private disposed = false;
  private readonly lastStatus = new Map<string, string | null>();

  constructor(
    definitions: readonly LayerDefinition[],
    private readonly shared: SharedLayerContext,
    private readonly onStatus: (id: string, text: string | null, tone: StatusTone) => void,
    /** After a layer fails to load and says so: the page may be an old build whose code is gone (build-check). */
    private readonly onLoadFailed: (id: string) => void
  ) {
    for (const definition of definitions) {
      this.slots.set(definition.id, { definition, wanted: false, instance: null, loading: null });
    }
  }

  has(id: string): boolean {
    return this.slots.has(id);
  }

  /**
   * Show or hide a layer. Resolves once it stands as asked: at once, unless
   * a switch-on has to load the layer first. Rejects if that load fails. An
   * id the manager was not built with is a wiring fault, so it throws: a
   * switch that showed on with nothing drawn would say nothing.
   */
  setVisible(id: string, visible: boolean): Promise<void> {
    const slot = this.slot(id);
    slot.wanted = visible;
    if (slot.instance) {
      slot.instance.setVisible(visible);
      return Promise.resolve();
    }
    return visible ? this.loaded(slot) : Promise.resolve();
  }

  /** Load a layer ahead of need, without showing it. Rejects if the load fails. */
  preload(id: string): Promise<void> {
    const slot = this.slot(id);
    return slot.instance ? Promise.resolve() : this.loaded(slot);
  }

  /** Not async on purpose: a wiring fault throws at once, where a failed load is a rejection. */
  private slot(id: string): Slot {
    const slot = this.slots.get(id);
    if (!slot) throw new Error(`no lazy layer ${id}`);
    return slot;
  }

  /** The layer's load: the one in flight, or a new one. */
  private loaded(slot: Slot): Promise<void> {
    if (slot.loading) return slot.loading;
    const loading = this.load(slot).finally(() => {
      slot.loading = null;
    });
    // The manager has already reported a failed load (the chip, the console, onLoadFailed), so a caller that does not wait need not catch.
    loading.catch(() => {});
    slot.loading = loading;
    return loading;
  }

  private async load(slot: Slot): Promise<void> {
    const id = slot.definition.id;
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
      this.onLoadFailed(id);
      throw new Error(`layer "${id}" failed to load`, { cause: error });
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
