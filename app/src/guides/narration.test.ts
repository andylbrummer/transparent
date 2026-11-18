import { describe, it, expect } from 'vitest';
import { EXAMPLE_GUIDE } from './example-guide.testdata';
import type { Guide } from './format';
import { createNarration, type NarrationDeps } from './narration';
import type { Narration, StepMedia } from './player';
import { parseVtt } from './vtt';

const FIRST: Narration = { audio: 'audio/01-look-down.m4a', captions: 'audio/01-look-down.vtt' };
const SECOND: Narration = { audio: 'audio/02-shells.m4a', captions: 'audio/02-shells.vtt' };
const VTT = 'WEBVTT\n\n00:00.000 --> 00:02.000\nLook down.\n';
const url = (path: string): string => `/guides/${EXAMPLE_GUIDE.id}/${path}`;

/** A promise the test settles. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * An audio element that plays nothing. The test sets its time, whether it
 * has ended, how far it has loaded and its error; it records every src and
 * every currentTime set, and each play() hands back a promise the test
 * settles. Setting currentTime makes it not ended, as a seek before the
 * end does.
 */
class FakeAudio extends EventTarget {
  readonly srcs: string[] = [];
  readonly timeSets: number[] = [];
  readonly plays: ReturnType<typeof deferred<void>>[] = [];
  pauses = 0;
  ended = false;
  paused = true;
  readyState = 0;
  error: MediaError | null = null;
  private time = 0;

  get src(): string {
    return this.srcs.at(-1) ?? '';
  }
  set src(value: string) {
    this.srcs.push(value);
  }
  get currentTime(): number {
    return this.time;
  }
  set currentTime(value: number) {
    this.timeSets.push(value);
    this.time = value;
    this.ended = false;
  }
  play(): Promise<void> {
    this.paused = false;
    const played = deferred<void>();
    this.plays.push(played);
    return played.promise;
  }
  pause(): void {
    this.pauses++;
    this.paused = true;
  }
}

/** Each file a function, since a Response is read once: an Error is a fetch that rejects. */
type Files = Record<string, () => Response | Error>;
const FILES: Files = {
  [url(FIRST.audio)]: () => new Response('first audio'),
  [url(FIRST.captions)]: () => new Response(VTT),
  [url(SECOND.audio)]: () => new Response('second audio'),
  [url(SECOND.captions)]: () => new Response(VTT),
};

/**
 * A narration over a fake audio element, serving `files` (or `fetch`), recording what was fetched, which object URLs
 * were made and let go, and each interruption.
 */
function setup(options: { files?: Files; fetch?: NarrationDeps['fetch']; fileUrl?: NarrationDeps['fileUrl'] } = {}) {
  const files = { ...FILES, ...options.files };
  const audio = new FakeAudio();
  const fetched: string[] = [];
  const created: Blob[] = [];
  const revoked: string[] = [];
  const counts = { interrupted: 0 };
  const narration = createNarration({
    audio,
    fetch(requested) {
      fetched.push(requested);
      if (options.fetch) return options.fetch(requested);
      const file = files[requested]?.() ?? new Error(`no file ${requested}`);
      return file instanceof Error ? Promise.reject(file) : Promise.resolve(file);
    },
    fileUrl: options.fileUrl ?? ((guide: Guide, path: string) => `/guides/${guide.id}/${path}`),
    objectUrl: {
      create(blob) {
        created.push(blob);
        return `blob:${created.length}`;
      },
      revoke(objectUrl) {
        revoked.push(objectUrl);
      },
    },
    onInterrupted() {
      counts.interrupted++;
    },
  });
  return { narration, audio, fetched, created, revoked, counts };
}

/** Lets every pending callback run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createNarration', () => {
  it('fetches the audio and the captions together, puts the audio in the element and reads the captions', async () => {
    const t = setup();
    const loading = t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
    // Both asked for before either has answered.
    expect(t.fetched).toEqual([url(FIRST.audio), url(FIRST.captions)]);
    const media = await loading;
    expect(media.captions).toEqual(parseVtt(VTT));
    expect(t.created.length).toBe(1);
    expect(await t.created[0].text()).toBe('first audio');
    expect(t.audio.srcs).toEqual(['blob:1']);
  });

  it.each<[string, Files, string]>([
    ['the audio is not found', { [url(FIRST.audio)]: () => new Response('', { status: 404 }) }, 'audio/01-look-down.m4a: HTTP 404'],
    ['the captions are not found', { [url(FIRST.captions)]: () => new Response('', { status: 404 }) }, 'audio/01-look-down.vtt: HTTP 404'],
    ['the audio cannot be fetched', { [url(FIRST.audio)]: () => new TypeError('Failed to fetch') }, 'audio/01-look-down.m4a: could not be fetched: Failed to fetch'],
    [
      'the captions are not WebVTT the overlay draws',
      { [url(FIRST.captions)]: () => new Response('WEBVTT\nLook down.\n') },
      'audio/01-look-down.vtt: line 2: a blank line must follow the WEBVTT line',
    ],
    [
      'both fail',
      { [url(FIRST.audio)]: () => new Response('', { status: 500 }), [url(FIRST.captions)]: () => new Response('', { status: 404 }) },
      'audio/01-look-down.m4a: HTTP 500',
    ],
  ])('rejects naming the file when %s, and leaves the element alone', async (_, files, message) => {
    const t = setup({ files });
    await expect(t.narration.loadNarration(EXAMPLE_GUIDE, FIRST)).rejects.toThrow(new Error(message));
    expect(t.audio.srcs).toEqual([]);
    expect(t.created).toEqual([]);
  });

  it('rejects rather than throws when even the URL cannot be made', async () => {
    const t = setup({
      fileUrl: () => {
        throw new Error('no folder for the guide');
      },
    });
    let loading: Promise<StepMedia> | undefined;
    expect(() => (loading = t.narration.loadNarration(EXAMPLE_GUIDE, FIRST))).not.toThrow();
    await expect(loading).rejects.toThrow(new Error('no folder for the guide'));
  });

  it('reads the time and the end from the element', async () => {
    const t = setup();
    const { clock } = await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
    t.audio.currentTime = 4.25;
    expect(clock.timeS()).toBe(4.25);
    expect(clock.isOver()).toBe(false);
    t.audio.ended = true;
    expect(clock.isOver()).toBe(true);
  });

  it('plays the element, and not once it has ended', async () => {
    const t = setup();
    const { clock } = await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
    clock.play();
    expect(t.audio.plays.length).toBe(1);
    t.audio.ended = true;
    clock.play();
    expect(t.audio.plays.length).toBe(1);
  });

  it.each<[string, Error, string | null]>([
    ['a play cut short by a pause or a new src is not a failure', new DOMException('The play() request was interrupted', 'AbortError'), null],
    ['a play the browser blocks is', new DOMException('play() failed because the user did not interact', 'NotAllowedError'), 'the browser blocked the narration from playing'],
    ['so is any other', new DOMException('The element has no supported sources.', 'NotSupportedError'), 'the narration could not play: The element has no supported sources.'],
  ])('%s', async (_, error, failure) => {
    const t = setup();
    const { clock } = await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
    clock.play();
    t.audio.plays[0].reject(error);
    await settle();
    expect(clock.failure()).toBe(failure);
  });

  it('seeks the element once it has the metadata, and holds the seek until then', async () => {
    const t = setup();
    const { clock } = await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
    clock.seek(3);
    expect(clock.timeS()).toBe(3);
    expect(t.audio.timeSets).toEqual([]);
    t.audio.readyState = 1;
    t.audio.dispatchEvent(new Event('loadedmetadata'));
    expect(t.audio.timeSets).toEqual([3]);
    // Played to the end, then seeked back: not ended, so play goes on from there.
    t.audio.ended = true;
    clock.seek(1.5);
    expect(t.audio.timeSets).toEqual([3, 1.5]);
    expect(clock.timeS()).toBe(1.5);
    clock.play();
    expect(t.audio.plays.length).toBe(1);
  });

  it('fails when the element cannot decode the audio, keeping the first failure', async () => {
    const t = setup();
    const { clock } = await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
    t.audio.error = { code: 4 } as MediaError;
    t.audio.dispatchEvent(new Event('error'));
    expect(clock.failure()).toBe('the narration could not be decoded (media error 4)');
    clock.play();
    t.audio.plays[0].reject(new DOMException('blocked', 'NotAllowedError'));
    await settle();
    expect(clock.failure()).toBe('the narration could not be decoded (media error 4)');
  });

  it('says the media error is unknown when the element gives none', async () => {
    const t = setup();
    const { clock } = await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
    t.audio.dispatchEvent(new Event('error'));
    expect(clock.failure()).toBe('the narration could not be decoded (media error unknown)');
  });

  it('lets go of the last object URL for the next, and the clock left behind touches nothing', async () => {
    const t = setup();
    const first = await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
    t.audio.readyState = 1;
    t.audio.currentTime = 7;
    first.clock.play();
    await t.narration.loadNarration(EXAMPLE_GUIDE, SECOND);
    expect(t.revoked).toEqual(['blob:1']);
    expect(t.audio.srcs).toEqual(['blob:1', 'blob:2']);
    t.audio.currentTime = 0;
    t.audio.ended = true;
    const timeSets = t.audio.timeSets.length;
    first.clock.play();
    first.clock.pause();
    first.clock.seek(2);
    expect(t.audio.plays.length).toBe(1);
    expect(t.audio.pauses).toBe(0);
    expect(t.audio.timeSets.length).toBe(timeSets);
    expect(first.clock.timeS()).toBe(7);
    expect(first.clock.isOver()).toBe(false);
  });

  it('gives the element to the later of two loads, whichever arrives first', async () => {
    const held = new Map<string, ReturnType<typeof deferred<Response>>>();
    const t = setup({
      fetch(requested) {
        const response = deferred<Response>();
        held.set(requested, response);
        return response.promise;
      },
    });
    const earlier = t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
    const later = t.narration.loadNarration(EXAMPLE_GUIDE, SECOND);
    held.get(url(SECOND.audio))!.resolve(new Response('second audio'));
    held.get(url(SECOND.captions))!.resolve(new Response(VTT));
    await later;
    held.get(url(FIRST.audio))!.resolve(new Response('first audio'));
    held.get(url(FIRST.captions))!.resolve(new Response(VTT));
    const { clock } = await earlier;
    expect(t.audio.srcs).toEqual(['blob:1']);
    expect(await t.created[0].text()).toBe('second audio');
    t.audio.currentTime = 9;
    clock.play();
    expect(t.audio.plays.length).toBe(0);
    expect(clock.timeS()).toBe(0);
  });

  it('passes on a pause the browser makes, and not one asked for, at the end, or after another load', async () => {
    const t = setup();
    const first = await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
    first.clock.play();
    t.audio.paused = true;
    t.audio.dispatchEvent(new Event('pause'));
    expect(t.counts.interrupted).toBe(1);

    first.clock.play();
    first.clock.pause();
    t.audio.dispatchEvent(new Event('pause'));
    expect(t.counts.interrupted).toBe(1);

    // Paused and played again before the pause event comes: that event is still ours.
    first.clock.play();
    first.clock.pause();
    first.clock.play();
    t.audio.dispatchEvent(new Event('pause'));
    expect(t.counts.interrupted).toBe(1);

    t.audio.ended = true;
    t.audio.dispatchEvent(new Event('pause'));
    expect(t.counts.interrupted).toBe(1);

    t.audio.ended = false;
    await t.narration.loadNarration(EXAMPLE_GUIDE, SECOND);
    t.audio.dispatchEvent(new Event('pause'));
    expect(t.counts.interrupted).toBe(1);
  });

  it('still passes on the browser’s pause after one of ours whose event a new src threw away', async () => {
    const t = setup();
    const first = await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
    first.clock.play();
    // Paused, then the next narration's src set before the pause event was sent: the browser drops it.
    first.clock.pause();
    const second = await t.narration.loadNarration(EXAMPLE_GUIDE, SECOND);
    second.clock.play();
    t.audio.paused = true;
    t.audio.dispatchEvent(new Event('pause'));
    expect(t.counts.interrupted).toBe(1);
  });

  it('lets go of the element on dispose: its events, its sound and its object URL', async () => {
    const t = setup();
    const { clock } = await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
    clock.play();
    const loading = t.narration.loadNarration(EXAMPLE_GUIDE, SECOND);
    t.narration.dispose();
    expect(t.audio.pauses).toBe(1);
    expect(t.revoked).toEqual(['blob:1']);
    t.audio.error = { code: 3 } as MediaError;
    t.audio.dispatchEvent(new Event('error'));
    t.audio.dispatchEvent(new Event('pause'));
    expect(clock.failure()).toBeNull();
    expect(t.counts.interrupted).toBe(0);
    // A load still on its way lands without taking the element.
    await loading;
    expect(t.audio.srcs).toEqual(['blob:1']);
    expect(t.created.length).toBe(1);
  });

  describe('preload', () => {
    const THIRD: Narration = { audio: 'audio/03-sea.m4a', captions: 'audio/03-sea.vtt' };

    /** A file that answers each fetch with the next of `answers`, the last for every fetch after. */
    const answering =
      (...answers: (() => Response)[]): (() => Response) =>
      () =>
        (answers.length > 1 ? answers.shift()! : answers[0])();
    const ok = (body: string) => () => new Response(body);
    const status = (code: number) => () => new Response('', { status: code });

    it('hands a load the fetch a preload made, without asking the network again', async () => {
      const t = setup();
      t.narration.preload(EXAMPLE_GUIDE, FIRST);
      await settle();
      let media: StepMedia | undefined;
      void t.narration.loadNarration(EXAMPLE_GUIDE, FIRST).then((loaded) => (media = loaded));
      await settle();
      expect(media?.captions).toEqual(parseVtt(VTT));
      expect(t.fetched).toEqual([url(FIRST.audio), url(FIRST.captions)]);
      expect(await t.created[0].text()).toBe('first audio');
    });

    it('shares a preload still on its way with the load that comes for it', async () => {
      const answers = new Map<string, ReturnType<typeof deferred<Response>>>();
      const t = setup({
        fetch(requested) {
          const answer = deferred<Response>();
          answers.set(requested, answer);
          return answer.promise;
        },
      });
      t.narration.preload(EXAMPLE_GUIDE, FIRST);
      const loading = t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
      expect(t.fetched).toEqual([url(FIRST.audio), url(FIRST.captions)]);
      answers.get(url(FIRST.audio))!.resolve(new Response('first audio'));
      answers.get(url(FIRST.captions))!.resolve(new Response(VTT));
      expect((await loading).captions).toEqual(parseVtt(VTT));
      expect(t.audio.srcs).toEqual(['blob:1']);
    });

    // An unhandled rejection from the preload would fail the run.
    it.each<[string, () => Response, string | null]>([
      ['plays when the fetch then works', ok('first audio'), null],
      ['rejects with its own failure when the fetch fails again', status(404), 'audio/01-look-down.m4a: HTTP 404'],
    ])('says nothing when a preload fails, and the load fetches again: %s', async (_, second, failure) => {
      const t = setup({ files: { [url(FIRST.audio)]: answering(status(503), second) } });
      t.narration.preload(EXAMPLE_GUIDE, FIRST);
      await settle();
      const loading = t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
      if (failure === null) await expect(loading).resolves.toMatchObject({ captions: parseVtt(VTT) });
      else await expect(loading).rejects.toThrow(new Error(failure));
      expect(t.fetched.filter((fetched) => fetched === url(FIRST.audio)).length).toBe(2);
    });

    it('forgets a load that failed, so the retry fetches again', async () => {
      const t = setup({ files: { [url(FIRST.audio)]: answering(status(503), ok('first audio')) } });
      await expect(t.narration.loadNarration(EXAMPLE_GUIDE, FIRST)).rejects.toThrow(new Error('audio/01-look-down.m4a: HTTP 503'));
      await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
      expect(t.fetched.filter((fetched) => fetched === url(FIRST.audio)).length).toBe(2);
      expect(t.audio.srcs).toEqual(['blob:1']);
    });

    it('keeps only the latest load and the latest preload', async () => {
      const t = setup({ files: { [url(THIRD.audio)]: ok('third audio'), [url(THIRD.captions)]: ok(VTT) } });
      await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
      t.narration.preload(EXAMPLE_GUIDE, SECOND);
      await t.narration.loadNarration(EXAMPLE_GUIDE, SECOND);
      t.narration.preload(EXAMPLE_GUIDE, THIRD);
      await settle();
      expect(t.fetched.length).toBe(6);
      // The step playing and the step after it are still in hand.
      await t.narration.loadNarration(EXAMPLE_GUIDE, SECOND);
      t.narration.preload(EXAMPLE_GUIDE, THIRD);
      await settle();
      expect(t.fetched.length).toBe(6);
      // The step before is fetched again.
      await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
      expect(t.fetched.slice(6)).toEqual([url(FIRST.audio), url(FIRST.captions)]);
    });

    it('never touches the element', async () => {
      const t = setup();
      t.narration.preload(EXAMPLE_GUIDE, FIRST);
      await settle();
      expect(t.audio.srcs).toEqual([]);
      expect(t.audio.plays).toEqual([]);
      expect(t.created).toEqual([]);
    });

    it('forgets every fetch on dispose', async () => {
      const t = setup();
      t.narration.preload(EXAMPLE_GUIDE, FIRST);
      await settle();
      t.narration.dispose();
      t.narration.preload(EXAMPLE_GUIDE, FIRST);
      expect(t.fetched).toEqual([url(FIRST.audio), url(FIRST.captions), url(FIRST.audio), url(FIRST.captions)]);
    });
  });

  describe('unlock', () => {
    it('sets the silence and plays it before returning, inside the tap', () => {
      const t = setup();
      const unlocking = t.narration.unlock();
      expect(t.audio.srcs).toEqual(['blob:1']);
      expect(t.audio.plays.length).toBe(1);
      // A second tap while it starts waits on the same play.
      expect(t.narration.unlock()).toBe(unlocking);
      expect(t.audio.plays.length).toBe(1);
    });

    it('pauses the silence and lets go of it once played, and then never plays it again', async () => {
      const t = setup();
      const unlocking = t.narration.unlock();
      t.audio.plays[0].resolve();
      await unlocking;
      expect(t.audio.pauses).toBe(1);
      expect(t.revoked).toEqual(['blob:1']);
      await t.narration.unlock();
      expect(t.audio.plays.length).toBe(1);
      expect(t.audio.srcs).toEqual(['blob:1']);
    });

    it('rejects when the browser refuses even the silence, lets go of it, and tries again on the next tap', async () => {
      const t = setup();
      const unlocking = t.narration.unlock();
      t.audio.plays[0].reject(new DOMException('play() failed because the user did not interact', 'NotAllowedError'));
      await expect(unlocking).rejects.toThrow(new Error('the browser did not allow sound: play() failed because the user did not interact'));
      expect(t.revoked).toEqual(['blob:1']);
      void t.narration.unlock();
      expect(t.audio.plays.length).toBe(2);
    });

    it('leaves a narration that took the element while the silence started: no pause, its src kept', async () => {
      const t = setup();
      const unlocking = t.narration.unlock();
      await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
      expect(t.audio.srcs).toEqual(['blob:1', 'blob:2']);
      t.audio.plays[0].resolve();
      await unlocking;
      expect(t.audio.pauses).toBe(0);
      expect(t.audio.srcs).toEqual(['blob:1', 'blob:2']);
    });

    it('takes a silence cut short by a narration’s src as neither refused nor unlocked: the next tap plays again', async () => {
      const t = setup();
      const unlocking = t.narration.unlock();
      await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
      t.audio.plays[0].reject(new DOMException('The play() request was interrupted by a new load request.', 'AbortError'));
      await unlocking;
      void t.narration.unlock();
      expect(t.audio.plays.length).toBe(2);
    });

    it('plays the silence again on the tap after the browser blocks a narration, though an earlier tap had unlocked', async () => {
      const t = setup();
      const unlocking = t.narration.unlock();
      t.audio.plays[0].resolve();
      await unlocking;
      const { clock } = await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
      clock.play();
      t.audio.plays[1].reject(new DOMException('blocked', 'NotAllowedError'));
      await settle();
      expect(clock.failure()).toBe('the browser blocked the narration from playing');
      void t.narration.unlock();
      expect(t.audio.plays.length).toBe(3);
    });

    it('never takes the silence’s pause for the browser’s, even with a blocked step’s clock in the element', async () => {
      const t = setup();
      const { clock } = await t.narration.loadNarration(EXAMPLE_GUIDE, FIRST);
      clock.play();
      t.audio.plays[0].reject(new DOMException('blocked', 'NotAllowedError'));
      await settle();
      expect(clock.failure()).toBe('the browser blocked the narration from playing');
      // Retry's tap.
      const unlocking = t.narration.unlock();
      t.audio.plays[1].resolve();
      await unlocking;
      t.audio.dispatchEvent(new Event('pause'));
      expect(t.counts.interrupted).toBe(0);
      // The clock it took the element from touches it no more.
      clock.play();
      expect(t.audio.plays.length).toBe(2);
    });

    it('plays a WAV of silence whose every size field matches what follows it', async () => {
      const t = setup();
      void t.narration.unlock();
      const wav = t.created[0];
      expect(wav.type).toBe('audio/wav');
      const bytes = new Uint8Array(await wav.arrayBuffer());
      const view = new DataView(bytes.buffer);
      const tag = (offset: number): string => String.fromCharCode(...bytes.subarray(offset, offset + 4));
      expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
      expect(view.getUint32(4, true)).toBe(bytes.length - 8);
      expect(view.getUint32(16, true)).toBe(16);
      // PCM, one channel, 8000 samples and so 8000 bytes a second, one byte a frame, 8 bits a sample.
      expect([view.getUint16(20, true), view.getUint16(22, true)]).toEqual([1, 1]);
      expect([view.getUint32(24, true), view.getUint32(28, true)]).toEqual([8000, 8000]);
      expect([view.getUint16(32, true), view.getUint16(34, true)]).toEqual([1, 8]);
      expect(view.getUint32(40, true)).toBe(bytes.length - 44);
      expect(bytes.length - 44).toBe(400);
      expect(bytes.subarray(44).every((sample) => sample === 0x80)).toBe(true);
    });
  });
});
