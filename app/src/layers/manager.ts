/**
 * Runs the lazy layers: loads one the first time it is switched on, keeps
 * its visibility in step with the switch through the load, and forwards
 * frames and resizes to whatever is loaded and showing. A layer can also be
 * loaded ahead of need, and a load can be waited on.
 */

import type { FrameState, LayerContext, LayerDefinition, LayerInstance, LayerParamValues, StatusTone } from './types';

export type SharedLayerContext = Omit<LayerContext, 'setStatus'>;

const LOADING = 'loading…';

interface Slot {
  readonly definition: LayerDefinition;
  wanted: boolean;
  instance: LayerInstance | null;
  /** The load in flight, shared by everyone waiting on it; null when none is. */
  loading: Promise<void> | null;
  /** Settings given before the layer had loaded, the last value of each, for it to take as it arrives; null when none are. */
  params: LayerParamValues | null;
  /** The last opacity given, for a layer that fades to take as it arrives; 1 until a fade. */
  opacity: number;
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
      this.slots.set(definition.id, { definition, wanted: false, instance: null, loading: null, params: null, opacity: 1 });
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

  /**
   * Give a layer settings (LayerDefinition.params), checked already. A loaded layer takes them at once; one not yet
   * loaded takes them as it loads, before it is first shown, so it never shows its defaults first. A layer that takes
   * no settings is a wiring fault and throws, as an unknown id does; so does a value the layer refuses.
   */
  setParams(id: string, values: LayerParamValues): void {
    const slot = this.slot(id);
    if (!slot.definition.params) throw new Error(`lazy layer ${id} takes no settings`);
    if (slot.instance) this.applyParams(slot.instance, id, values);
    else slot.params = { ...slot.params, ...values };
  }

  /**
   * How much of a layer that fades shows, 0 to 1, called every frame of a fade. One still loading takes the last value
   * as it loads. A layer that does not fade is a wiring fault and throws: the view control checks first.
   */
  setOpacity(id: string, opacity: number): void {
    const slot = this.slot(id);
    if (!slot.definition.fades) throw new Error(`lazy layer ${id} cannot fade`);
    slot.opacity = opacity;
    slot.instance?.setOpacity?.(opacity);
  }

  private applyParams(instance: LayerInstance, id: string, values: LayerParamValues): void {
    if (!instance.setParams) throw new Error(`lazy layer ${id} has params but no setParams`);
    instance.setParams(values);
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
      // Before the layer is kept: one that refuses its settings has failed to load as asked, and says so as a failed load does.
      try {
        if (slot.params) {
          const params = slot.params;
          slot.params = null;
          this.applyParams(instance, id, params);
        }
        if (slot.definition.fades) {
          if (!instance.setOpacity) throw new Error(`lazy layer ${id} fades but has no setOpacity`);
          instance.setOpacity(slot.opacity);
        }
      } catch (error) {
        instance.dispose();
        throw error;
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
