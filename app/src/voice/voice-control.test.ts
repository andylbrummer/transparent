import { describe, it, expect, vi } from 'vitest';
import {
  ECHO_GUARD_MS,
  MAX_FAILED_RESTARTS,
  VoiceControl,
  WAKE_ARMED_MS,
  type SpeechRecognitionLike,
  type SpeechResultEventLike,
  type VoiceStatus,
} from './voice-control';

/** A recognizer driven by the test: what it "hears", and when its session ends. */
class FakeRecognizer implements SpeechRecognitionLike {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((event: SpeechResultEventLike) => void) | null = null;
  onerror: ((event: { readonly error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  running = false;
  starts = 0;
  private results: { alternatives: string[]; isFinal: boolean }[] = [];

  start(): void {
    // As the browser does: a second start of a running session throws.
    if (this.running) throw new Error('InvalidStateError: already started');
    this.running = true;
    this.starts++;
    this.results = [];
  }
  stop(): void {
    this.end();
  }
  abort(): void {
    this.end();
  }
  /** The session ends, as after stop() or a silence. */
  end(): void {
    if (!this.running) return;
    this.running = false;
    this.onend?.();
  }
  fail(error: string): void {
    this.onerror?.({ error });
    this.end();
  }
  /** Hear a phrase: interim replaces the phrase in progress, final closes it. */
  hear(alternatives: string[], isFinal = true): void {
    const last = this.results.at(-1);
    const index = last && !last.isFinal ? this.results.length - 1 : this.results.length;
    this.results[index] = { alternatives, isFinal };
    const results = this.results.map((r) => Object.assign(r.alternatives.map((transcript) => ({ transcript })), { isFinal: r.isFinal }));
    this.onresult?.({ resultIndex: index, results });
  }
}

function setup() {
  const recognizer = new FakeRecognizer();
  let clock = 0;
  const statuses: VoiceStatus[] = [];
  const heard: string[][] = [];
  const spoken: string[] = [];
  let finishSpeaking: () => void = () => undefined;
  const cancelSpeech = vi.fn();
  const voice = new VoiceControl({
    createRecognizer: () => recognizer,
    speak: (text) => {
      spoken.push(text);
      return new Promise<void>((resolve) => (finishSpeaking = resolve));
    },
    cancelSpeech,
    respond: (alternatives) => {
      heard.push([...alternatives]);
      return `did ${alternatives[0]}`;
    },
    onStatus: (status) => statuses.push(status),
    lang: 'en-GB',
    now: () => clock,
  });
  const advance = (ms: number): void => {
    clock += ms;
  };
  /** The reply finishes speaking, and the echo guard after it passes. */
  const replyDone = async (): Promise<void> => {
    finishSpeaking();
    await Promise.resolve();
    await Promise.resolve();
    advance(ECHO_GUARD_MS + 1);
  };
  return { voice, recognizer, statuses, heard, spoken, cancelSpeech, advance, replyDone };
}

describe('VoiceControl push to talk', () => {
  it('listens while held, shows what it hears, and acts on the phrase once let go', () => {
    const { voice, recognizer, statuses, heard, spoken, cancelSpeech } = setup();
    voice.pushStart();
    expect(recognizer.lang).toBe('en-GB');
    expect(recognizer.running).toBe(true);
    expect(cancelSpeech).toHaveBeenCalled();
    recognizer.hear(['show'], false);
    expect(statuses.at(-1)).toEqual({ state: 'listening', heard: 'show' });
    recognizer.hear(['show stars', 'show stairs']);
    expect(heard).toEqual([]);

    voice.pushEnd();
    expect(heard).toEqual([['show stars', 'show stairs']]);
    expect(spoken).toEqual(['did show stars']);
    expect(statuses.at(-1)).toEqual({ state: 'reply', text: 'did show stars' });
    expect(voice.getMode()).toBe('off');
  });

  it('joins a phrase that arrives in pieces, best guesses together', () => {
    const { voice, recognizer, heard } = setup();
    voice.pushStart();
    recognizer.hear(['turn', 'term']);
    recognizer.hear(['stars off']);
    voice.pushEnd();
    expect(heard).toEqual([['turn stars off', 'term stars off']]);
  });

  it('goes quiet when let go having heard nothing', () => {
    const { voice, statuses, heard } = setup();
    voice.pushStart();
    voice.pushEnd();
    expect(heard).toEqual([]);
    expect(statuses.at(-1)).toEqual({ state: 'idle' });
  });

  it('asks for the microphone when it is refused, and stops', () => {
    const { voice, recognizer, statuses, spoken } = setup();
    voice.pushStart();
    recognizer.fail('not-allowed');
    expect(statuses.at(-1)).toMatchObject({ state: 'error' });
    expect(spoken.at(-1)).toMatch(/microphone/);
    expect(voice.getMode()).toBe('off');
  });

  it('shows a quiet reply without speaking it, and makes no reply at all of an empty one', () => {
    const statuses: VoiceStatus[] = [];
    const spoken: string[] = [];
    const recognizer = new FakeRecognizer();
    let answer: string | { text: string; quiet: true } = { text: 'Next.', quiet: true };
    const voice = new VoiceControl({
      createRecognizer: () => recognizer,
      speak: async (text) => void spoken.push(text),
      cancelSpeech: () => undefined,
      respond: () => answer,
      onStatus: (status) => statuses.push(status),
      lang: 'en',
    });
    voice.pushStart();
    recognizer.hear(['next']);
    voice.pushEnd();
    expect(statuses.at(-1)).toEqual({ state: 'reply', text: 'Next.' });
    answer = '';
    voice.pushStart();
    recognizer.hear(['earth is the third planet']);
    voice.pushEnd();
    expect(statuses.at(-1)).toEqual({ state: 'idle' });
    expect(spoken).toEqual([]);
  });

  it('says what came of a command that had to wait', () => {
    const { voice, statuses, spoken } = setup();
    voice.say('No guide called "the moon".');
    expect(statuses.at(-1)).toEqual({ state: 'reply', text: 'No guide called "the moon".' });
    expect(spoken).toEqual(['No guide called "the moon".']);
  });

  it('reports a browser without recognition', () => {
    const statuses: VoiceStatus[] = [];
    const voice = new VoiceControl({
      createRecognizer: () => null,
      speak: async () => undefined,
      cancelSpeech: () => undefined,
      respond: () => '',
      onStatus: (status) => statuses.push(status),
      lang: 'en',
    });
    expect(voice.isSupported()).toBe(false);
    voice.pushStart();
    expect(statuses).toEqual([{ state: 'error', text: 'This browser has no speech recognition.' }]);
  });
});

describe('VoiceControl wake word', () => {
  it('acts only on phrases starting with the wake word, and only on what follows it', () => {
    const { voice, recognizer, heard } = setup();
    voice.setWakeListening(true);
    expect(voice.getMode()).toBe('wake');
    recognizer.hear(['show stars']);
    expect(heard).toEqual([]);
    recognizer.hear(['Earth, show stars', 'earth show stairs']);
    expect(heard).toEqual([['show stars', 'show stairs']]);
  });

  it('shows what is being said to it, and not other talk in the room', () => {
    const { voice, recognizer, statuses } = setup();
    voice.setWakeListening(true);
    recognizer.hear(['pass the salt'], false);
    expect(statuses).toEqual([]);
    recognizer.hear(['earth show'], false);
    expect(statuses.at(-1)).toEqual({ state: 'listening', heard: 'show' });
  });

  it('waits a while for the command after the wake word alone', async () => {
    const { voice, recognizer, heard, advance, replyDone } = setup();
    voice.setWakeListening(true);
    recognizer.hear(['Earth']);
    advance(WAKE_ARMED_MS - 1);
    recognizer.hear(['tectonics']);
    expect(heard).toEqual([['tectonics']]);

    // Too late: the next phrase is just talk.
    await replyDone();
    recognizer.hear(['Earth']);
    advance(WAKE_ARMED_MS + 1);
    recognizer.hear(['deep space']);
    expect(heard).toEqual([['tectonics']]);
  });

  it('does not hear itself: nothing acts while it speaks, nor just after', async () => {
    const { voice, recognizer, heard, advance, replyDone } = setup();
    voice.setWakeListening(true);
    recognizer.hear(['earth help']);
    recognizer.hear(['earth say earth help']);
    expect(heard).toEqual([['help']]);
    await replyDone();
    advance(-ECHO_GUARD_MS);
    recognizer.hear(['earth stars']);
    expect(heard).toHaveLength(1);
    advance(ECHO_GUARD_MS);
    recognizer.hear(['earth stars']);
    expect(heard).toEqual([['help'], ['stars']]);
  });

  it('opens a new session when the browser ends one after a silence', () => {
    const { voice, recognizer } = setup();
    voice.setWakeListening(true);
    recognizer.fail('no-speech');
    recognizer.end();
    expect(recognizer.running).toBe(true);
    expect(recognizer.starts).toBe(3);
  });

  it('gives up after failing again and again, saying so', () => {
    const { voice, recognizer, statuses } = setup();
    voice.setWakeListening(true);
    for (let i = 0; i < MAX_FAILED_RESTARTS; i++) recognizer.fail('audio-capture');
    expect(recognizer.running).toBe(false);
    expect(voice.getMode()).toBe('off');
    expect(statuses.at(-1)).toEqual({ state: 'error', text: 'Voice stopped: recognition kept failing.' });
  });

  it('closes the microphone on leaving Cardboard', () => {
    const { voice, recognizer, statuses } = setup();
    voice.setWakeListening(true);
    voice.setWakeListening(false);
    expect(recognizer.running).toBe(false);
    expect(voice.getMode()).toBe('off');
    expect(statuses.at(-1)).toEqual({ state: 'idle' });
  });

  it('moves a push session still open into the wake session', () => {
    const { voice, recognizer, heard } = setup();
    voice.pushStart();
    voice.setWakeListening(true);
    expect(voice.getMode()).toBe('wake');
    expect(recognizer.running).toBe(true);
    recognizer.hear(['earth stars']);
    expect(heard).toEqual([['stars']]);
  });

  it('leaves the button alone while the wake session runs', () => {
    const { voice, recognizer } = setup();
    voice.setWakeListening(true);
    voice.pushStart();
    expect(voice.getMode()).toBe('wake');
    expect(recognizer.starts).toBe(1);
  });
});
