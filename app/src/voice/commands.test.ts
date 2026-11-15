import { describe, it, expect } from 'vitest';
import { LAYER_DEFINITIONS } from '../layers/registry';
import { switchesWithLazyLayers } from '../ui/layers-panel';
import { LAYER_PRESETS, defaultPreset } from '../ui/presets';
import { bestCommand, normalizeSpeech, parseCommand, stripWakeWord, type Vocabulary } from './commands';

const switches = switchesWithLazyLayers(LAYER_DEFINITIONS);
const vocabulary: Vocabulary = { presets: [defaultPreset(switches), ...LAYER_PRESETS], switches };

/** What a phrase does, in short: "preset:inside", "on:stars", "off:boundaries", "help". */
function does(heard: string): string {
  const command = parseCommand(heard, vocabulary);
  switch (command.kind) {
    case 'preset':
      return `preset:${command.preset.id}`;
    case 'layer':
      return `${command.on ? 'on' : 'off'}:${command.layer.id}`;
    case 'unknown':
      return `unknown:${command.heard}`;
    default:
      return command.kind;
  }
}

describe('normalizeSpeech', () => {
  it('lowers the case, drops apostrophes and turns punctuation into single spaces', () => {
    expect(normalizeSpeech("  What's THAT?! ")).toBe('whats that');
    expect(normalizeSpeech('Earth, show stars.')).toBe('earth show stars');
  });
});

describe('stripWakeWord', () => {
  it('gives the command after the wake word, with or without a greeting', () => {
    expect(stripWakeWord('Earth, show stars')).toBe('show stars');
    expect(stripWakeWord('hey earth show stars')).toBe('show stars');
    expect(stripWakeWord('OK Earth what is that')).toBe('what is that');
  });

  it('gives an empty command for the wake word alone, and null for talk not addressed to the app', () => {
    expect(stripWakeWord('Earth')).toBe('');
    expect(stripWakeWord('show stars')).toBeNull();
    // The word inside a phrase is not the wake word.
    expect(stripWakeWord('the earth is round')).toBeNull();
    expect(stripWakeWord('earthquakes')).toBeNull();
  });
});

describe('parseCommand', () => {
  it('finds a preset by its label, its id or a spoken name', () => {
    expect(does('tectonics')).toBe('preset:tectonics');
    expect(does('go to deep space')).toBe('preset:deep-space');
    expect(does('solar system view')).toBe('preset:solar-system');
    expect(does('inside the earth')).toBe('preset:inside');
    expect(does('the interior')).toBe('preset:inside');
    expect(does('universe')).toBe('preset:cosmology');
    expect(does('clear all')).toBe('preset:nothing');
    expect(does('default')).toBe('preset:default');
  });

  it('turns a layer on or off however the phrase is put', () => {
    expect(does('show stars')).toBe('on:stars');
    expect(does('turn on the stars')).toBe('on:stars');
    expect(does('stars on')).toBe('on:stars');
    expect(does('hide stars')).toBe('off:stars');
    expect(does('turn the stars off')).toBe('off:stars');
    expect(does('stars off')).toBe('off:stars');
    // A bare name turns it on.
    expect(does('stars')).toBe('on:stars');
  });

  it('prefers the switch the words name most of: stars is Stars, not Nearest stars', () => {
    const nearby = switches.find((s) => s.id === 'nearby-stars')!;
    expect(does('stars')).toBe('on:stars');
    expect(does(`show ${nearby.label}`)).toBe('on:nearby-stars');
  });

  it('knows the spoken names for the planet and its shells', () => {
    expect(does('hide the continents')).toBe('off:globe-surface');
    expect(does('show the core')).toBe('on:shell-core');
    expect(does('show inner core')).toBe('on:shell-inner-core');
    expect(does('hide plates')).toBe('off:boundaries');
    expect(does('hide borders')).toBe('off:political');
    expect(does('show satellites')).toBe('on:sat-visual');
  });

  it('reads the fixed commands, a please either side allowed', () => {
    expect(does("what's that")).toBe('identify');
    expect(does('what am I looking at')).toBe('identify');
    expect(does('calibrate')).toBe('calibrate');
    expect(does('keep it')).toBe('keep');
    expect(does('exit cardboard')).toBe('exit');
    expect(does('reset view')).toBe('reset');
    expect(does('please help')).toBe('help');
    expect(does('help please')).toBe('help');
  });

  it('says what it heard when nothing matches', () => {
    expect(does('make me a sandwich')).toBe('unknown:make me a sandwich');
    expect(does('hide the sandwich')).toBe('unknown:hide the sandwich');
  });
});

describe('bestCommand', () => {
  it('takes the first of the guesses that is a command', () => {
    const command = bestCommand(['show stairs', 'show stars'], vocabulary);
    expect(command.kind === 'layer' && command.layer.id).toBe('stars');
  });

  it('reports the top guess when none is', () => {
    expect(bestCommand(['Show stairs', 'show stares'], vocabulary)).toEqual({ kind: 'unknown', heard: 'show stairs' });
  });
});
