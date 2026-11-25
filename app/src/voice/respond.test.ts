import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createClock } from '../clock';
import { createLookController } from '../input/look';
import type { LayerManager } from '../layers/manager';
import { LAYER_DEFINITIONS } from '../layers/registry';
import { switchesWithLazyLayers, type LayerSwitch } from '../ui/layers-panel';
import { LAYER_PRESETS } from '../ui/presets';
import { createViewControl } from '../view/view-control';
import { createStandingPlace } from '../view/standing-place';
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
    /** A guide open, and whether its narration is heard now. */
    guide?: { narrating: boolean };
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
          return { end: () => done.push('end borrow'), hold: () => {} };
        },
        isOn: () => false,
      },
      lazyLayers: { setParams: () => {}, setOpacity: () => {}, ...(state.lazyLayers ?? { preload: () => Promise.resolve() }) },
      shells: { setShellOpacity: () => {} },
      camera: new THREE.PerspectiveCamera(),
      standing: createStandingPlace(() => null),
      clock: createClock('?time=1970-01-01T00:00:00Z', () => 0),
      getLabels: () => null,
      loadedLabels: { find: () => ({ found: 'none' }) },
      look: createLookController(),
      getAttitude: () => null,
      prefersReducedMotion: () => false,
      addLabels: () => ({ setVisible() {}, remove() {} }),
      dip: (change) => Promise.resolve(change()),
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
    guide: {
      isOpen: () => state.guide !== undefined,
      isNarrating: () => state.guide?.narrating ?? false,
      perform: (action) => {
        if (!state.guide) return null;
        done.push(`guide:${action}`);
        return `did ${action}`;
      },
      play: (title) => {
        done.push(`play:${title}`);
        return `finding ${title}`;
      },
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

  describe('in a guide', () => {
    it.each([
      ['pause', 'pause'],
      ['hold on', 'pause'],
      ['resume', 'resume'],
      ['go on', 'resume'],
      ['next', 'next'],
      ['skip', 'next'],
      ['back', 'back'],
      ['go back', 'back'],
      ['stop guide', 'stop'],
      ['leave the guide', 'stop'],
    ])('takes "%s" as the guide\'s %s', (heard, action) => {
      const { actions, done } = app({ guide: { narrating: false } });
      respondToSpeech([heard], actions);
      expect(done).toEqual([`guide:${action}`]);
    });

    it('speaks the reply to a pause or a stop, and only shows the others, which the narration would talk over', () => {
      const { actions } = app({ guide: { narrating: true } });
      expect(respondToSpeech(['pause'], actions)).toBe('did pause');
      expect(respondToSpeech(['stop guide'], actions)).toBe('did stop');
      expect(respondToSpeech(['next'], actions)).toEqual({ text: 'did next', quiet: true });
    });

    it('drops everything but its own commands, without a reply, while the narration is heard', () => {
      const { actions, done } = app({ guide: { narrating: true } });
      expect(respondToSpeech(['is the third planet from the Sun'], actions)).toBe('');
      expect(respondToSpeech(['tectonics'], actions)).toBe('');
      expect(done).toEqual([]);
    });

    it('takes every command while the guide is paused or waiting', () => {
      const { actions, done } = app({ guide: { narrating: false } });
      expect(respondToSpeech(['tectonics'], actions)).toBe('Tectonics.');
      expect(done).toEqual(['preset:tectonics']);
    });

    it('leaves "back" and "pause" to the view and the unknown without a guide open', () => {
      const { actions, done } = app();
      respondToSpeech(['back'], actions);
      expect(done).toEqual(['zoom-out']);
      expect(respondToSpeech(['pause'], actions)).toBe('I heard "pause". Say help for commands.');
    });

    it('says so when a guide command finds no guide', () => {
      const { actions } = app();
      expect(respondToSpeech(['stop guide'], actions)).toBe('I heard "stop guide". Say help for commands.');
    });

    it('starts a guide by its title at any time, with a quiet reply', () => {
      const { actions, done } = app({ guide: { narrating: true } });
      expect(respondToSpeech(['play guide down through the earth'], actions)).toEqual({ text: 'finding down through the earth', quiet: true });
      expect(done).toEqual(['play:down through the earth']);
    });
  });
});
