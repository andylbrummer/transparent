/**
 * Voice control over the browser's own speech recognition, two ways:
 *
 * - push: on the phone, the mic button held down is the microphone open;
 *   letting go ends the phrase.
 * - wake: in Cardboard, where nothing can be pressed, the microphone stays
 *   open and only a phrase starting with the wake word acts ("Earth, show
 *   stars"). The wake word alone waits WAKE_ARMED_MS for the command.
 *
 * Replies are spoken, and anything heard while the app is speaking is
 * ignored - it would be the app hearing itself.
 *
 * Recognition is the browser's: Chrome sends the audio to Google's
 * servers, Safari may do it on the device. Chrome ends a session after a
 * few seconds of silence; in wake mode it is started again, which Android
 * may mark with a system tone.
 */

import { stripWakeWord } from './commands';

/** The parts of the Web Speech API used here (not in TypeScript's DOM library). */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
}

export interface SpeechResultEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<ArrayLike<{ readonly transcript: string }> & { readonly isFinal: boolean }>;
}

/** The browser's recognizer, or null where there is none (Firefox). */
export function createBrowserRecognizer(): SpeechRecognitionLike | null {
  const scope = window as unknown as Record<string, (new () => SpeechRecognitionLike) | undefined>;
  const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  return Recognition ? new Recognition() : null;
}

/**
 * Speak `text`; resolves when done, or at once where the browser cannot
 * speak. Chrome on Android sometimes never reports the end, so it also
 * resolves after the longest the text could take (SPEECH_MS_PER_CHAR).
 */
export function speakWithBrowser(text: string, lang: string): Promise<void> {
  if (!('speechSynthesis' in window)) return Promise.resolve();
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    setTimeout(resolve, 1500 + text.length * SPEECH_MS_PER_CHAR);
    speechSynthesis.speak(utterance);
  });
}

/** Slower than any voice speaks: about 8 characters a second. */
export const SPEECH_MS_PER_CHAR = 120;

export function cancelBrowserSpeech(): void {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

export type VoiceMode = 'off' | 'push' | 'wake';

export type VoiceStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'listening'; readonly heard: string }
  | { readonly state: 'reply'; readonly text: string }
  | { readonly state: 'error'; readonly text: string };

export interface VoiceControlOptions {
  createRecognizer(): SpeechRecognitionLike | null;
  speak(text: string): Promise<void>;
  /** Stop speaking: the user is about to talk. */
  cancelSpeech(): void;
  /**
   * Act on a phrase - the recognizer's guesses, best first - and say what was done: a string is shown and spoken, a
   * quiet reply only shown, and '' is no reply at all.
   */
  respond(alternatives: readonly string[]): string | { readonly text: string; readonly quiet: true };
  onStatus(status: VoiceStatus): void;
  lang: string;
  now?: () => number;
}

/** How long the wake word alone holds the microphone for the command that follows it. */
export const WAKE_ARMED_MS = 6000;
/** Heard this soon after the app stops speaking, it is still the app's own voice. */
export const ECHO_GUARD_MS = 400;
/** Wake-mode restarts that end in an error, in a row, before giving up. */
export const MAX_FAILED_RESTARTS = 5;

const PERMISSION_ERRORS = new Set(['not-allowed', 'service-not-allowed']);

export class VoiceControl {
  private recognizer: SpeechRecognitionLike | null = null;
  private mode: VoiceMode = 'off';
  private armedUntil = 0;
  private speakingUntil = 0;
  private failedRestarts = 0;
  private lastError: string | null = null;
  private pushFinals: string[][] = [];
  private readonly now: () => number;

  constructor(private readonly options: VoiceControlOptions) {
    this.now = options.now ?? (() => performance.now());
  }

  /** Whether the browser can recognise speech at all. */
  isSupported(): boolean {
    return this.ensureRecognizer() !== null;
  }

  getMode(): VoiceMode {
    return this.mode;
  }

  /** The mic button went down: listen until pushEnd. */
  pushStart(): void {
    // A session still running (wake, or a push still finishing) is left to end on its own.
    if (this.mode !== 'off') return;
    const recognizer = this.ensureRecognizer();
    if (!recognizer) return this.fail('This browser has no speech recognition.');
    this.options.cancelSpeech();
    this.speakingUntil = 0;
    this.mode = 'push';
    this.pushFinals = [];
    recognizer.continuous = true;
    recognizer.interimResults = true;
    this.startRecognizer();
    this.options.onStatus({ state: 'listening', heard: '' });
  }

  /** The mic button came up: the phrase is over; what was heard is acted on when the recognizer finishes. */
  pushEnd(): void {
    if (this.mode !== 'push') return;
    this.recognizer?.stop();
  }

  /** Open the microphone for the wake word (entering Cardboard), or close it. */
  setWakeListening(on: boolean): void {
    if (on === (this.mode === 'wake')) return;
    if (!on) {
      this.mode = 'off';
      this.recognizer?.abort();
      this.options.onStatus({ state: 'idle' });
      return;
    }
    const recognizer = this.ensureRecognizer();
    if (!recognizer) return;
    this.failedRestarts = 0;
    if (this.mode === 'push') {
      // The push session's end opens the wake session (onEnd).
      this.mode = 'wake';
      recognizer.stop();
      return;
    }
    this.mode = 'wake';
    recognizer.continuous = true;
    recognizer.interimResults = true;
    this.startRecognizer();
  }

  dispose(): void {
    this.mode = 'off';
    if (this.recognizer) {
      this.recognizer.onresult = null;
      this.recognizer.onerror = null;
      this.recognizer.onend = null;
      this.recognizer.abort();
    }
  }

  private ensureRecognizer(): SpeechRecognitionLike | null {
    if (this.recognizer) return this.recognizer;
    const recognizer = this.options.createRecognizer();
    if (!recognizer) return null;
    recognizer.lang = this.options.lang;
    recognizer.maxAlternatives = 3;
    recognizer.onresult = (event) => this.onResult(event);
    recognizer.onerror = (event) => this.onError(event.error);
    recognizer.onend = () => this.onEnd();
    this.recognizer = recognizer;
    return recognizer;
  }

  private startRecognizer(): void {
    this.lastError = null;
    try {
      this.recognizer!.start();
    } catch (error) {
      // Started twice (an end and a restart crossing): the session already running serves.
      console.error('voice: recognizer start failed', error);
    }
  }

  private onResult(event: SpeechResultEventLike): void {
    if (this.now() < this.speakingUntil) return;
    this.failedRestarts = 0;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const alternatives = Array.from({ length: result.length }, (_, j) => result[j].transcript.trim()).filter(Boolean);
      if (alternatives.length === 0) continue;
      if (this.mode === 'push') {
        if (result.isFinal) this.pushFinals.push(alternatives);
        else this.options.onStatus({ state: 'listening', heard: [...this.pushFinals.map((a) => a[0]), alternatives[0]].join(' ') });
      } else if (this.mode === 'wake') {
        this.onWakeResult(alternatives, result.isFinal);
      }
    }
  }

  private onWakeResult(alternatives: readonly string[], isFinal: boolean): void {
    const commands = alternatives.map(stripWakeWord);
    const woken = commands.findIndex((c) => c !== null);
    const armed = this.now() < this.armedUntil;
    if (!isFinal) {
      // Only what was said to the app is shown: other talk in the room is not.
      if (woken >= 0) this.options.onStatus({ state: 'listening', heard: commands[woken]! });
      else if (armed) this.options.onStatus({ state: 'listening', heard: alternatives[0] });
      return;
    }
    if (woken >= 0) {
      const spoken = commands.filter((c): c is string => c !== null && c !== '');
      if (spoken.length === 0) {
        this.armedUntil = this.now() + WAKE_ARMED_MS;
        this.options.onStatus({ state: 'listening', heard: '' });
        return;
      }
      this.armedUntil = 0;
      this.act(spoken);
    } else if (armed) {
      this.armedUntil = 0;
      this.act(alternatives);
    }
  }

  private act(alternatives: readonly string[]): void {
    const answer = this.options.respond(alternatives);
    const reply = typeof answer === 'string' ? answer : answer.text;
    if (reply === '') {
      this.options.onStatus({ state: 'idle' });
      return;
    }
    this.options.onStatus({ state: 'reply', text: reply });
    if (typeof answer !== 'string') return;
    // Long enough to cover the speaking, refreshed when it actually ends.
    this.speakingUntil = Number.POSITIVE_INFINITY;
    void this.options.speak(reply).then(() => {
      this.speakingUntil = this.now() + ECHO_GUARD_MS;
    });
  }

  private onError(error: string): void {
    this.lastError = error;
    // Silence and a cut-off are ordinary ends; everything else is reported.
    if (error === 'no-speech' || error === 'aborted') return;
    console.error('voice: recognition error', error);
    if (PERMISSION_ERRORS.has(error)) {
      this.mode = 'off';
      this.fail('Voice needs the microphone: allow it for this site, then try again.');
    } else if (error === 'network') {
      this.fail('Voice recognition needs a network connection.');
    }
  }

  private onEnd(): void {
    if (this.mode === 'push') {
      this.mode = 'off';
      if (this.pushFinals.length === 0) {
        this.options.onStatus({ state: 'idle' });
        return;
      }
      // One phrase may arrive in pieces: join each guess across them, best guesses together.
      const count = Math.max(...this.pushFinals.map((a) => a.length));
      const joined = Array.from({ length: count }, (_, j) => this.pushFinals.map((a) => a[Math.min(j, a.length - 1)]).join(' '));
      this.pushFinals = [];
      this.act(joined);
      return;
    }
    if (this.mode !== 'wake') return;
    // Chrome ends a session after a silence: open another, unless it keeps failing.
    if (this.lastError !== null && this.lastError !== 'no-speech') this.failedRestarts++;
    if (this.failedRestarts >= MAX_FAILED_RESTARTS) {
      this.mode = 'off';
      this.fail('Voice stopped: recognition kept failing.');
      return;
    }
    this.startRecognizer();
  }

  /** Say something not in answer to a phrase just heard: what came of a command that had to wait, say for a fetch. */
  say(text: string): void {
    this.options.onStatus({ state: 'reply', text });
    this.speakingUntil = Number.POSITIVE_INFINITY;
    void this.options.speak(text).then(() => {
      this.speakingUntil = this.now() + ECHO_GUARD_MS;
    });
  }

  private fail(text: string): void {
    this.options.onStatus({ state: 'error', text });
    void this.options.speak(text);
  }
}
