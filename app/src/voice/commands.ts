/**
 * Voice commands: what was heard, turned into something the app does.
 *
 * The grammar is small and fixed - presets, layers on and off, "what's
 * that", zoom in and out, calibration, reset, help, exit - so recognition
 * needs no server
 * of ours. Matching is by words, not exact phrases: "show the stars",
 * "turn stars on" and "stars" all find the Stars switch, and of several
 * switches holding the words heard, the one with the fewest other words
 * wins ("stars" is Stars, not "Nearest stars").
 *
 * In Cardboard every command starts with the wake word, WAKE_WORD, since
 * the microphone is open the whole time (stripWakeWord).
 *
 * While a guide is open its own commands come first (spec/guides.md §11):
 * "back" then steps the guide back rather than widening the view.
 */

import type { LayerSwitch } from '../ui/layers-panel';
import type { LayerPreset } from '../ui/presets';

export const WAKE_WORD = 'earth';

export type VoiceCommand =
  | { readonly kind: 'preset'; readonly preset: LayerPreset }
  | { readonly kind: 'layer'; readonly layer: LayerSwitch; readonly on: boolean }
  | { readonly kind: 'identify' }
  /** A step closer (inward) or wider: in the viewer, the spyglass's; elsewhere, the view's. */
  | { readonly kind: 'zoom'; readonly inward: boolean }
  | { readonly kind: 'calibrate' }
  /** Keep the calibration: the hands-free stand-in for the viewer's button. */
  | { readonly kind: 'keep' }
  | { readonly kind: 'exit' }
  | { readonly kind: 'reset' }
  | { readonly kind: 'help' }
  /** Pause, resume, step or leave the open guide. */
  | { readonly kind: 'guide'; readonly action: GuideVoiceAction }
  /** Start the guide whose title holds these words. */
  | { readonly kind: 'play-guide'; readonly title: string }
  /** Open the hotspot marker at the middle of the view ("play that"). */
  | { readonly kind: 'clip-here' }
  /** Open the shown hotspot whose title holds these words ("play <title>"). */
  | { readonly kind: 'play-clip'; readonly title: string }
  /** Close the clip that is open ("stop", while one is). */
  | { readonly kind: 'clip-stop' }
  | { readonly kind: 'unknown'; readonly heard: string };

export type GuideVoiceAction = 'pause' | 'resume' | 'next' | 'back' | 'stop';

export interface Vocabulary {
  readonly presets: readonly LayerPreset[];
  readonly switches: readonly LayerSwitch[];
}

/** Lower case, apostrophes dropped ("what's" → "whats"), everything else not a letter or digit a single space. */
export function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The command after the wake word, or null when the phrase does not start
 * with it. "Hey" or "OK" before it is allowed; a bare wake word gives ''.
 */
export function stripWakeWord(heard: string): string | null {
  const match = new RegExp(`^(?:(?:hey|ok|okay) )?${WAKE_WORD}(?: (.*))?$`).exec(normalizeSpeech(heard));
  return match ? (match[1] ?? '') : null;
}

/** Words that carry no name: dropped before a phrase is matched to a switch or a guide's title. */
export const FILLER = new Set(['the', 'a', 'an', 'please', 'layer', 'layers', 'all', 'me', 'my', 'of', 'and', 'with', 'now']);

/** Spoken names for switches whose label says it another way. */
const LAYER_ALIASES: Readonly<Record<string, string>> = {
  continents: 'globe-surface',
  land: 'globe-surface',
  surface: 'globe-surface',
  'earth surface': 'globe-surface',
  oceans: 'globe-surface',
  ground: 'globe-surface',
  core: 'shell-core',
  'outer core': 'shell-core',
  'inner core': 'shell-inner-core',
  moho: 'shell-moho',
  crust: 'shell-moho',
  'lower mantle': 'shell-670',
  mantle: 'shell-670',
  borders: 'political',
  coastlines: 'political',
  coasts: 'political',
  countries: 'political',
  plates: 'boundaries',
  satellites: 'sat-visual',
  labels: 'place-labels',
  names: 'place-labels',
};

/** Spoken names for presets beyond their label and id. */
const PRESET_ALIASES: Readonly<Record<string, string>> = {
  interior: 'inside',
  inside: 'inside',
  'inside earth': 'inside',
  'the interior': 'inside',
  tectonic: 'tectonics',
  'plate tectonics': 'tectonics',
  weather: 'weather',
  'solar system': 'solar-system',
  planetary: 'solar-system',
  'deep sky': 'deep-space',
  galaxy: 'deep-space',
  enhanced: 'enhanced-sky',
  'milky way up close': 'enhanced-sky',
  'astronomy book': 'enhanced-sky',
  'coffee table': 'enhanced-sky',
  'coffee table book': 'enhanced-sky',
  'high energy': 'high-energy',
  universe: 'cosmology',
  cosmos: 'cosmology',
  'big bang': 'cosmology',
  clear: 'nothing',
  nothing: 'nothing',
  'everything off': 'nothing',
  'all off': 'nothing',
  'start': 'default',
  home: 'default',
};

const singular = (word: string): string => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
const wordsOf = (text: string): string[] => normalizeSpeech(text).split(' ').filter(Boolean).map(singular);

function findPreset(phrase: string, presets: readonly LayerPreset[]): LayerPreset | null {
  const bare = phrase
    .replace(/^(go to|switch to|change to|use|the) /, '')
    .replace(/ (view|preset|mode)$/, '')
    .replace(/^(view|preset|mode) /, '');
  const id = PRESET_ALIASES[bare];
  return presets.find((p) => p.id === id || normalizeSpeech(p.label) === bare || normalizeSpeech(p.id) === bare) ?? null;
}

function findLayer(phrase: string, switches: readonly LayerSwitch[]): LayerSwitch | null {
  const wanted = wordsOf(phrase).filter((w) => !FILLER.has(w));
  if (wanted.length === 0) return null;
  const aliased = LAYER_ALIASES[wanted.join(' ')] ?? LAYER_ALIASES[normalizeSpeech(phrase)];
  if (aliased) {
    const layer = switches.find((s) => s.id === aliased);
    if (layer) return layer;
  }
  let best: LayerSwitch | null = null;
  let bestScore = 0;
  for (const layer of switches) {
    const words = new Set([...wordsOf(layer.label), ...wordsOf(layer.id)]);
    if (!wanted.every((w) => words.has(w))) continue;
    // The share of the label the phrase covers: "stars" is all of Stars, a third of "Nearest stars".
    const score = wanted.length / wordsOf(layer.label).length;
    if (score > bestScore) {
      best = layer;
      bestScore = score;
    }
  }
  return best;
}

const ZOOM_IN = /^(?:zoom|zoom in|zoom closer|closer|get closer|go closer|magnify|enhance|deeper|go deeper)(?: on (?:that|this|it))?$/;
const ZOOM_OUT = /^(?:zoom out|zoom back|wider|go wider|further|farther|back|go back|back out)$/;
const OFF = [/^(?:turn off|switch off|hide|remove|disable|stop showing) (.+)$/, /^(?:turn|switch) (.+) off$/, /^(.+) off$/];
const ON = [/^(?:turn on|switch on|show|add|enable|display|show me) (.+)$/, /^(?:turn|switch) (.+) on$/, /^(.+) on$/];

const PLAY_GUIDE = /^(?:play|start|open|begin)(?: the)? guide(?: called)? (.+)$/;
/** Each guide command's phrases, tried only while a guide is open. */
const GUIDE_ACTIONS: readonly [GuideVoiceAction, RegExp][] = [
  ['stop', /^(?:stop|leave|end|exit|quit|close)(?: the)? guide$/],
  ['pause', /^(?:pause|pause (?:the )?guide|hold on|wait)$/],
  ['resume', /^(?:resume|continue|go on|carry on|keep going|unpause|play)$/],
  ['next', /^(?:next|next step|skip|skip (?:it|this|ahead)|go ahead)$/],
  ['back', /^(?:back|go back|previous|previous step|step back|back a step)$/],
];

/** Closes an open clip: tried only while one is, before "stop" can mean leaving the viewer. */
const CLIP_STOP = /^(?:stop|close|enough|thats enough|(?:stop|close) (?:that|it|this|the clip|the picture|the film|the video))$/;
const CLIP_HERE = /^(?:play|open|show me) (?:that|this|it)$/;
/** After the guide's own: a bare "play" there is resume, and "play guide …" is a guide. */
const PLAY_CLIP = /^(?:play|open)(?: the)? (.+)$/;

/** What the app has open, which changes what a phrase means. */
export interface SpeechContext {
  /** A guide is open: its commands are tried first. */
  readonly guideOpen?: boolean;
  /** A clip is open: "stop" closes it. */
  readonly clipOpen?: boolean;
}

/** The command in one phrase; WAKE_WORD already stripped if it was there. */
export function parseCommand(heard: string, vocabulary: Vocabulary, context: SpeechContext = {}): VoiceCommand {
  const phrase = normalizeSpeech(heard).replace(/^please /, '').replace(/ please$/, '');
  const playGuide = PLAY_GUIDE.exec(phrase);
  if (playGuide) return { kind: 'play-guide', title: playGuide[1] };
  if (context.clipOpen && CLIP_STOP.test(phrase)) return { kind: 'clip-stop' };
  if (context.guideOpen) {
    for (const [action, pattern] of GUIDE_ACTIONS) if (pattern.test(phrase)) return { kind: 'guide', action };
  }
  if (CLIP_HERE.test(phrase)) return { kind: 'clip-here' };
  const playClip = PLAY_CLIP.exec(phrase);
  if (playClip) return { kind: 'play-clip', title: playClip[1] };
  if (/^(?:exit|leave|quit|close|stop)(?: cardboard| vr| headset| the headset)?$/.test(phrase)) return { kind: 'exit' };
  if (/^(?:calibrate|calibration|start calibrating|calibrate the headset)$/.test(phrase)) return { kind: 'calibrate' };
  if (/^(?:keep|keep it|keep that|save|save it|done|thats it|thats good|lock it)$/.test(phrase)) return { kind: 'keep' };
  if (/^(?:reset|recenter|re center|center|reset offset|reset view|center view)$/.test(phrase)) return { kind: 'reset' };
  if (/^(?:help|what can i say|commands|what are the commands)$/.test(phrase)) return { kind: 'help' };
  if (ZOOM_IN.test(phrase)) return { kind: 'zoom', inward: true };
  if (ZOOM_OUT.test(phrase)) return { kind: 'zoom', inward: false };
  if (/^(?:whats that|what is that|whats this|what is this|what am i looking at|identify|identify that|name that|whats there|what is there)$/.test(phrase)) {
    return { kind: 'identify' };
  }
  for (const pattern of OFF) {
    const match = pattern.exec(phrase);
    if (!match) continue;
    const layer = findLayer(match[1], vocabulary.switches);
    return layer ? { kind: 'layer', layer, on: false } : { kind: 'unknown', heard: phrase };
  }
  let named = phrase;
  for (const pattern of ON) {
    const match = pattern.exec(phrase);
    if (match) {
      named = match[1];
      break;
    }
  }
  const preset = findPreset(named, vocabulary.presets);
  if (preset) return { kind: 'preset', preset };
  const layer = findLayer(named, vocabulary.switches);
  if (layer) return { kind: 'layer', layer, on: true };
  return { kind: 'unknown', heard: phrase };
}

/** The first of the recognizer's guesses that is a command; else the top guess, unknown. */
export function bestCommand(alternatives: readonly string[], vocabulary: Vocabulary, context: SpeechContext = {}): VoiceCommand {
  for (const heard of alternatives) {
    const command = parseCommand(heard, vocabulary, context);
    if (command.kind !== 'unknown') return command;
  }
  return { kind: 'unknown', heard: normalizeSpeech(alternatives[0] ?? '') };
}

/**
 * The title among `titles` that the spoken words name: every word heard is in it, and of several, the one with the
 * fewest other words. -1 for none.
 */
export function findTitle(heard: string, titles: readonly string[]): number {
  const wanted = wordsOf(heard).filter((w) => !FILLER.has(w));
  if (wanted.length === 0) return -1;
  let best = -1;
  let bestScore = 0;
  titles.forEach((title, i) => {
    const words = wordsOf(title);
    if (!wanted.every((w) => words.includes(w))) return;
    const score = wanted.length / words.length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}
