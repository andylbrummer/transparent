import { describe, it, expect } from 'vitest';
import { LAYER_DEFINITIONS } from '../layers/registry';
import { switchesWithLazyLayers } from '../ui/layers-panel';
import { LAYER_PRESETS } from '../ui/presets';
import { helpText, respondToSpeech, type VoiceActions } from './respond';

/** The app's side, recording what was asked of it. */
function app(state: { inCardboard?: boolean; calibrating?: boolean; inView?: string | null } = {}) {
  const done: string[] = [];
  const actions: VoiceActions = {
    vocabulary: { presets: LAYER_PRESETS, switches: switchesWithLazyLayers(LAYER_DEFINITIONS) },
    applyPreset: (preset) => done.push(`preset:${preset.id}`),
    setLayer: (id, visible) => done.push(`${visible ? 'on' : 'off'}:${id}`),
    nameInView: () => state.inView ?? null,
    isInCardboard: () => state.inCardboard ?? false,
    isCalibrating: () => state.calibrating ?? false,
    calibrate: () => done.push('calibrate'),
    keepCalibration: () => done.push('keep'),
    exitCardboard: () => done.push('exit'),
    resetView: () => done.push('reset'),
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
