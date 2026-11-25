import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createLookController } from '../input/look';
import type { LayerManager } from '../layers/manager';
import { LAYER_DEFINITIONS } from '../layers/registry';
import { switchesWithLazyLayers, type LayerSwitch } from '../ui/layers-panel';
import { LAYER_PRESETS } from '../ui/presets';
import { createViewControl } from '../view/view-control';
import { helpText, respondToSpeech, type VoiceActions, type VoiceZoom } from './respond';

/**
 * The app's side, recording what was asked of it. Presets and layers go
 * through a real view control onto a recording panel; `viewSwitches`
 * builds that control from a different list than the vocabulary, and
 * `lazyLayers` stands in for the layer manager, whose layers load at once
 * unless it says otherwise.
 */
function app(
  state: {
    inCardboard?: boolean;
    calibrating?: boolean;
    inView?: string | null;
    zoom?: (inward: boolean) => VoiceZoom;
    viewSwitches?: readonly LayerSwitch[];
    lazyLayers?: Pick<LayerManager, 'preload'>;
  } = {}
) {
  const done: string[] = [];
  const switches = switchesWithLazyLayers(LAYER_DEFINITIONS);
  const actions: VoiceActions = {
    vocabulary: { presets: LAYER_PRESETS, switches },
    viewControl: createViewControl({
      presets: LAYER_PRESETS,
      switches: state.viewSwitches ?? switches,
      layersPanel: {
        applyPreset: (preset) => done.push(`preset:${preset.id}`),
        setLayer: (id, visible) => done.push(`${visible ? 'on' : 'off'}:${id}`),
        showOnly: (on) => done.push(`only:${on.join(',')}`),
        borrow: () => {
          done.push('borrow');
          return { end: () => done.push('end borrow') };
        },
      },
      lazyLayers: state.lazyLayers ?? { preload: () => Promise.resolve() },
      camera: new THREE.PerspectiveCamera(),
      getPosition: () => null,
      now: () => new Date(0),
      getLabels: () => null,
      loadedLabels: { find: () => ({ found: 'none' }) },
      look: createLookController(),
      getAttitude: () => null,
      prefersReducedMotion: () => false,
      addLabels: () => ({ setVisible() {}, remove() {} }),
    }),
    nameInView: () => state.inView ?? null,
    isInCardboard: () => state.inCardboard ?? false,
    isCalibrating: () => state.calibrating ?? false,
    calibrate: () => done.push('calibrate'),
    keepCalibration: () => done.push('keep'),
    exitCardboard: () => done.push('exit'),
    resetView: () => done.push('reset'),
    zoom: (inward) => {
      done.push(inward ? 'zoom-in' : 'zoom-out');
      return state.zoom?.(inward) ?? { done: true, on: null };
    },
  };
  return { actions, done };
}

describe('respondToSpeech', () => {
  it('applies a preset and a layer, and says which', () => {
    const { actions, done } = app();
    expect(respondToSpeech(['tectonics'], actions)).toBe('Tectonics.');
    expect(respondToSpeech(['hide stars'], actions)).toBe('Stars off.');
    expect(done).toEqual(['preset:tectonics', 'off:stars']);
  });

  it('reports a command the view control refuses, when it and the vocabulary were built from different lists', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { actions, done } = app({ viewSwitches: [] });
    expect(respondToSpeech(['hide stars'], actions)).toBe('Stars off.');
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('voice command failed: unknown-layer', 'no layer switch stars'));
    expect(error).toHaveBeenCalledTimes(1);
    expect(done).toEqual([]);
    error.mockRestore();
  });

  it('does not report a layer that will not load: the layer manager has already said so', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { actions, done } = app({ lazyLayers: { preload: () => Promise.reject(new Error('offline')) } });
    expect(respondToSpeech(['show stars'], actions)).toBe('Stars on.');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(error).not.toHaveBeenCalled();
    expect(done).toEqual(['on:stars']);
    error.mockRestore();
  });

  it('names what is in view, or says nothing is', () => {
    expect(respondToSpeech(["what's that"], app({ inView: 'Alnair' }).actions)).toBe('Alnair');
    expect(respondToSpeech(["what's that"], app().actions)).toBe('Nothing named there.');
  });

  it('keeps or leaves only where there is something to keep or leave', () => {
    const outside = app();
    expect(respondToSpeech(['keep'], outside.actions)).toBe('Not calibrating.');
    expect(respondToSpeech(['exit'], outside.actions)).toBe('Not in Cardboard.');
    expect(outside.done).toEqual([]);

    const calibrating = app({ inCardboard: true, calibrating: true });
    expect(respondToSpeech(['keep'], calibrating.actions)).toBe('Kept.');
    expect(respondToSpeech(['exit'], calibrating.actions)).toBe('Leaving Cardboard.');
    expect(calibrating.done).toEqual(['keep', 'exit']);
  });

  it('zooms, and says what the spyglass is on, if anything', () => {
    const plain = app();
    expect(respondToSpeech(['zoom in'], plain.actions)).toBe('Closer.');
    expect(respondToSpeech(['zoom out'], plain.actions)).toBe('Wider.');
    expect(plain.done).toEqual(['zoom-in', 'zoom-out']);

    const onAndromeda = app({ inCardboard: true, zoom: () => ({ done: true, on: 'Andromeda Galaxy' }) });
    expect(respondToSpeech(['closer'], onAndromeda.actions)).toBe('Closer on Andromeda Galaxy.');
    expect(respondToSpeech(['wider'], onAndromeda.actions)).toBe('Wider on Andromeda Galaxy.');
  });

  it('says why when there was nothing to zoom', () => {
    const nothing = app({ inCardboard: true, zoom: () => ({ done: false }) });
    expect(respondToSpeech(['zoom in'], nothing.actions)).toBe('Nothing named there to zoom in on.');
    expect(respondToSpeech(['zoom out'], nothing.actions)).toBe('Not zoomed in.');
  });

  it('tells the wake word in help only in Cardboard', () => {
    expect(respondToSpeech(['help'], app({ inCardboard: true }).actions)).toBe(helpText(true));
    expect(helpText(true)).toMatch(/^Start with "Earth"/);
    expect(helpText(false)).not.toMatch(/Earth/);
  });

  it('repeats what it heard when it is not a command', () => {
    const { actions, done } = app();
    expect(respondToSpeech(['make tea'], actions)).toBe('I heard "make tea". Say help for commands.');
    expect(done).toEqual([]);
  });
});
