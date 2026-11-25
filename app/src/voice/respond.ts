/**
 * What the app does for each voice command, and what it says back.
 * The app's side is passed in as VoiceActions, so the replies can be
 * tested without the renderer.
 */

import { WAKE_WORD, bestCommand, type GuideVoiceAction, type VoiceCommand, type Vocabulary } from './commands';
import type { ViewAction, ViewControl } from '../view/actions';

export interface VoiceActions {
  readonly vocabulary: Vocabulary;
  /** Presets and layers go through the view control, as a guide's cues do. */
  readonly viewControl: ViewControl;
  /** The name of what the view is centred on, or null. */
  nameInView(): string | null;
  isInCardboard(): boolean;
  isCalibrating(): boolean;
  /** Enter Cardboard calibrating, or start calibrating inside it. */
  calibrate(): void;
  keepCalibration(): void;
  exitCardboard(): void;
  resetView(): void;
  /** Zoom a step (VoiceCommand zoom); what came of it. */
  zoom(inward: boolean): VoiceZoom;
  readonly guide: VoiceGuide;
}

/** The guide's side of the voice grammar (spec/guides.md §11). */
export interface VoiceGuide {
  /** Whether a guide is open: playing, paused, waiting or ended. Its commands then come first. */
  isOpen(): boolean;
  /**
   * Whether narration is being heard now. Then only the guide's commands are taken, and anything else is dropped
   * without a reply: the narrator saying "Earth is…" must not be answered over (spec/guides.md §12 risk 12).
   */
  isNarrating(): boolean;
  /** Do a guide command; the words to show, or null when no guide is open to do it to. */
  perform(action: GuideVoiceAction): string | null;
  /** Start the guide whose title holds these words; the words to show. */
  play(title: string): string;
}

/**
 * A reply shown but not spoken: a guide's narration is about to play, or plays on, and the reply would talk over it.
 * The empty string, spoken or not, is no reply at all.
 */
export interface QuietReply {
  readonly text: string;
  readonly quiet: true;
}

/**
 * What a spoken zoom did: `on` names what the spyglass is open on, null
 * for the plain view; not done when there was nothing to zoom - no name
 * under the view to open the spyglass on, or no spyglass open to widen.
 */
export type VoiceZoom = { readonly done: true; readonly on: string | null } | { readonly done: false };

const wakeName = WAKE_WORD[0].toUpperCase() + WAKE_WORD.slice(1);

export function helpText(inCardboard: boolean): string {
  const lead = inCardboard ? `Start with "${wakeName}". ` : '';
  const viewer = inCardboard ? ' "calibrate", "keep", "exit",' : ' "calibrate",';
  return `${lead}Say a view, like "tectonics" or "deep space"; a layer on or off, like "show stars" or "hide plates"; or "what's that", "zoom in", "zoom out",${viewer} "reset". In a guide: "pause", "resume", "next", "back", "stop guide"; or "play guide" and its title.`;
}

/** Act on a phrase, the recognizer's guesses best first; the reply to say, or to show only. */
export function respondToSpeech(alternatives: readonly string[], actions: VoiceActions): string | QuietReply {
  const command = bestCommand(alternatives, actions.vocabulary, actions.guide.isOpen());
  const forGuide = command.kind === 'guide' || command.kind === 'play-guide';
  if (actions.guide.isNarrating() && !forGuide) return '';
  return perform(command, actions);
}

function perform(command: VoiceCommand, actions: VoiceActions): string | QuietReply {
  switch (command.kind) {
    case 'guide': {
      const done = actions.guide.perform(command.action);
      if (done === null) return 'No guide is playing.';
      // Pausing and leaving end the narration, so the reply can be heard; the others start it again.
      return command.action === 'pause' || command.action === 'stop' ? done : { text: done, quiet: true };
    }
    case 'play-guide':
      return { text: actions.guide.play(command.title), quiet: true };
    case 'preset':
      performFromVocabulary(actions.viewControl, { do: 'preset', id: command.preset.id });
      return `${command.preset.label}.`;
    case 'layer':
      performFromVocabulary(actions.viewControl, command.on ? { do: 'layers', on: [command.layer.id] } : { do: 'layers', off: [command.layer.id] });
      return `${command.layer.label} ${command.on ? 'on' : 'off'}.`;
    case 'identify':
      return actions.nameInView() ?? 'Nothing named there.';
    case 'zoom': {
      const zoom = actions.zoom(command.inward);
      if (!zoom.done) return command.inward ? 'Nothing named there to zoom in on.' : 'Not zoomed in.';
      const how = command.inward ? 'Closer' : 'Wider';
      return zoom.on ? `${how} on ${zoom.on}.` : `${how}.`;
    }
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

/**
 * Do an action built from a parsed command. The reply does not wait for
 * it: a layer may take seconds to load, and the reply is the only sign
 * the command was heard. A layer that will not load has been reported
 * already, by its chip and on the console, so it is not reported again.
 * The ids come from the vocabulary, so any other failed outcome means the
 * vocabulary and the view control were built from different lists.
 */
function performFromVocabulary(viewControl: ViewControl, action: ViewAction): void {
  void viewControl.perform(action).then((outcome) => {
    if (!outcome.ok && outcome.code !== 'layer-unavailable') console.error(`voice command failed: ${outcome.code}`, outcome.message);
  });
}

/** "What's that" names the label nearest the middle of the view, if one is within this angle of it. */
export const IDENTIFY_MAX_ANGLE_RAD = (10 * Math.PI) / 180;

/** A spoken zoom outside the viewer narrows or widens the field of view by this much. */
export const VOICE_ZOOM_FACTOR = 2;
