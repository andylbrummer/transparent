/**
 * What the app does for each voice command, and what it says back.
 * The app's side is passed in as VoiceActions, so the replies can be
 * tested without the renderer.
 */

import { WAKE_WORD, bestCommand, type VoiceCommand, type Vocabulary } from './commands';
import type { LayerPreset } from '../ui/presets';

export interface VoiceActions {
  readonly vocabulary: Vocabulary;
  applyPreset(preset: LayerPreset): void;
  setLayer(id: string, visible: boolean): void;
  /** The name of what the view is centred on, or null. */
  nameInView(): string | null;
  isInCardboard(): boolean;
  isCalibrating(): boolean;
  /** Enter Cardboard calibrating, or start calibrating inside it. */
  calibrate(): void;
  keepCalibration(): void;
  exitCardboard(): void;
  resetView(): void;
}

const wakeName = WAKE_WORD[0].toUpperCase() + WAKE_WORD.slice(1);

export function helpText(inCardboard: boolean): string {
  const lead = inCardboard ? `Start with "${wakeName}". ` : '';
  const viewer = inCardboard ? ' "calibrate", "keep", "exit",' : ' "calibrate",';
  return `${lead}Say a view, like "tectonics" or "deep space"; a layer on or off, like "show stars" or "hide plates"; or "what's that",${viewer} "reset".`;
}

/** Act on a phrase, the recognizer's guesses best first; the reply to say. */
export function respondToSpeech(alternatives: readonly string[], actions: VoiceActions): string {
  return perform(bestCommand(alternatives, actions.vocabulary), actions);
}

function perform(command: VoiceCommand, actions: VoiceActions): string {
  switch (command.kind) {
    case 'preset':
      actions.applyPreset(command.preset);
      return `${command.preset.label}.`;
    case 'layer':
      actions.setLayer(command.layer.id, command.on);
      return `${command.layer.label} ${command.on ? 'on' : 'off'}.`;
    case 'identify':
      return actions.nameInView() ?? 'Nothing named there.';
    case 'calibrate':
      actions.calibrate();
      return 'Calibrating. Tilt your head to move the images together, then say keep.';
    case 'keep':
      if (!actions.isCalibrating()) return 'Not calibrating.';
      actions.keepCalibration();
      return 'Kept.';
    case 'exit':
      if (!actions.isInCardboard()) return 'Not in Cardboard.';
      actions.exitCardboard();
      return 'Leaving Cardboard.';
    case 'reset':
      actions.resetView();
      return 'View reset.';
    case 'help':
      return helpText(actions.isInCardboard());
    case 'unknown':
      return command.heard ? `I heard "${command.heard}". Say help for commands.` : 'I did not catch that.';
  }
}

/** "What's that" names the label nearest the middle of the view, if one is within this angle of it. */
export const IDENTIFY_MAX_ANGLE_RAD = (10 * Math.PI) / 180;
