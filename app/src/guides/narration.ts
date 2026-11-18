/**
 * Narration through the one audio element (spec/guides.md §4, §5.1): the
 * player's loadNarration and the StepClock it plays a step by.
 *
 * A narration is fetched whole and handed to the element as a blob, never
 * streamed by it. A failed download is then a fetch error with a status to
 * show, and it happens while the step loads, not mid-sentence. Loading a
 * step early is the same fetch, which works on iOS too, where the
 * element's own preload is ignored. Audio and captions both have to arrive:
 * there is no text-to-speech stand-in and no playing without captions.
 *
 * The clock reads the element's own time, so anything that stops the sound
 * (a pause, a decoder falling behind) stops the cues with it. No timers.
 * The element, fetch and object URLs come in as deps: jsdom plays nothing.
 */

import type { Guide } from './format';
import type { Narration, StepClock, StepMedia } from './player';
import { parseVtt, type CaptionCue } from './vtt';

/** What narration.ts uses of an HTMLAudioElement, so a test can stand in for one: jsdom plays nothing. */
export type NarrationAudio = Pick<
  HTMLAudioElement,
  'src' | 'currentTime' | 'ended' | 'paused' | 'readyState' | 'error' | 'play' | 'pause' | 'addEventListener' | 'removeEventListener'
>;

export interface NarrationDeps {
  /** The one audio element every narration plays through: the tap that starts a guide unlocks this one. */
  readonly audio: NarrationAudio;
  /** As the browser's fetch. */
  fetch(url: string): Promise<Response>;
  /** The URL of a file in a guide's folder, e.g. `${BASE_URL}guides/${guide.id}/${path}`. */
  fileUrl(guide: Guide, path: string): string;
  /** As URL.createObjectURL and URL.revokeObjectURL. */
  readonly objectUrl: { create(blob: Blob): string; revoke(url: string): void };
  /** The browser stopped the narration without being asked: a call, another app, the headphones pulled. */
  onInterrupted(): void;
}

export interface NarrationPlayer {
  /** PlayerDeps.loadNarration: the step's audio in the element and its captions read. Never throws: it rejects. */
  loadNarration(guide: Guide, narration: Narration): Promise<StepMedia>;
  /** Stop, let go of the element's listeners and every object URL. */
  dispose(): void;
}

/** HTMLMediaElement.HAVE_METADATA: from here the element takes a currentTime. */
const HAVE_METADATA = 1;

/** A step's clock and what the element's events tell it while its narration is in the element. */
interface AudioClock extends StepClock {
  /** Another narration has taken the element: from now on this clock touches nothing and stands where it was. */
  retire(): void;
  mediaFailed(): void;
  metadataLoaded(): void;
  pausedByBrowser(): void;
}

export function createNarration(deps: NarrationDeps): NarrationPlayer {
  const { audio } = deps;
  // Every call is numbered; only the newest may take the element, so a slow earlier load cannot replace a later one.
  let calls = 0;
  /** The clock whose narration is in the element. */
  let current: AudioClock | null = null;
  let objectUrl: string | null = null;

  const onError = (): void => current?.mediaFailed();
  const onLoadedMetadata = (): void => current?.metadataLoaded();
  const onPause = (): void => current?.pausedByBrowser();
  audio.addEventListener('error', onError);
  audio.addEventListener('loadedmetadata', onLoadedMetadata);
  audio.addEventListener('pause', onPause);

  async function loadNarration(guide: Guide, narration: Narration): Promise<StepMedia> {
    const call = ++calls;
    // Both at once, and both must arrive. The audio's failure is the one told when both fail, so the message is fixed.
    const [sound, captions] = await Promise.allSettled([
      fetchFile(guide, narration.audio, (response) => response.blob()),
      fetchFile(guide, narration.captions, async (response): Promise<CaptionCue[]> => parseVtt(await response.text())),
    ]);
    if (sound.status === 'rejected') throw sound.reason;
    if (captions.status === 'rejected') throw captions.reason;
    // A later call has come since: it owns the element. This one is a step the player has already left.
    if (call !== calls) return { clock: NEVER_IN_THE_ELEMENT, captions: captions.value };
    const clock = audioClock();
    current?.retire();
    if (objectUrl !== null) deps.objectUrl.revoke(objectUrl);
    objectUrl = deps.objectUrl.create(sound.value);
    audio.src = objectUrl;
    current = clock;
    // Not waiting for loadedmetadata or canplay: iOS may send neither before the first play. A decoder failure shows
    // as failure() instead.
    return { clock, captions: captions.value };
  }

  /** A file of the guide, read by `read`. Every failure names the file. */
  async function fetchFile<T>(guide: Guide, path: string, read: (response: Response) => Promise<T>): Promise<T> {
    const url = deps.fileUrl(guide, path);
    let response: Response;
    try {
      response = await deps.fetch(url);
    } catch (error) {
      throw new Error(`${path}: could not be fetched: ${message(error)}`);
    }
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    try {
      return await read(response);
    } catch (error) {
      throw new Error(`${path}: ${message(error)}`);
    }
  }

  function audioClock(): AudioClock {
    // A seek asked for before the element has the metadata: older Safari drops a currentTime set that early.
    let pendingSeekS: number | null = null;
    let failure: string | null = null;
    /** What the player last asked for: a pause event after play() and before the end is the browser's own. */
    let asked: 'play' | 'pause' | null = null;
    /** Where the clock stood when it was retired; null while its narration is in the element. */
    let retiredAt: { readonly timeS: number; readonly isOver: boolean } | null = null;
    // The first failure is kept: what follows it is most likely its consequence.
    const fail = (why: string): void => {
      failure ??= why;
    };
    const timeS = (): number => pendingSeekS ?? audio.currentTime;

    return {
      timeS: () => (retiredAt ? retiredAt.timeS : timeS()),
      isOver: () => (retiredAt ? retiredAt.isOver : audio.ended),
      failure: () => failure,
      play() {
        // Over means over (StepClock.play): the element would start again from the top.
        if (retiredAt || audio.ended) return;
        asked = 'play';
        audio.play().catch((error: unknown) => {
          if (retiredAt) return;
          const name = errorName(error);
          // A pause() or a new src cut the play short: asked for, so not a failure.
          if (name === 'AbortError') return;
          // Not swallowed: the player halts on it, and its Retry is a tap, which lets the element play.
          if (name === 'NotAllowedError') return fail('the browser blocked the narration from playing');
          fail(`the narration could not play: ${message(error)}`);
        });
      },
      pause() {
        if (retiredAt) return;
        asked = 'pause';
        audio.pause();
      },
      seek(tS) {
        if (retiredAt) return;
        // The element clamps to its length itself, and a time before the end makes it not ended again.
        if (audio.readyState >= HAVE_METADATA) {
          pendingSeekS = null;
          audio.currentTime = tS;
        } else pendingSeekS = tS;
      },
      retire() {
        retiredAt = { timeS: timeS(), isOver: audio.ended };
      },
      mediaFailed() {
        fail(`the narration could not be decoded (media error ${audio.error?.code ?? 'unknown'})`);
      },
      metadataLoaded() {
        if (pendingSeekS === null) return;
        audio.currentTime = pendingSeekS;
        pendingSeekS = null;
      },
      pausedByBrowser() {
        // Judged from the element as the event arrives, not by counting our own pauses: setting a new src throws away
        // events still to come, so a count would stick. Our pause() leaves asked at 'pause'; a pause and a quick play()
        // since leaves the element playing; at the end some browsers send a pause too.
        if (asked === 'play' && audio.paused && !audio.ended) deps.onInterrupted();
      },
    };
  }

  function dispose(): void {
    audio.removeEventListener('error', onError);
    audio.removeEventListener('loadedmetadata', onLoadedMetadata);
    audio.removeEventListener('pause', onPause);
    audio.pause();
    current?.retire();
    current = null;
    // A load still on its way lands retired, so it takes neither the element nor an object URL.
    calls++;
    if (objectUrl !== null) deps.objectUrl.revoke(objectUrl);
    objectUrl = null;
  }

  return { loadNarration, dispose };
}

/** The clock of a narration a later one beat to the element: it never had it, so it stands at its start and moves nothing. */
const NEVER_IN_THE_ELEMENT: StepClock = {
  timeS: () => 0,
  isOver: () => false,
  failure: () => null,
  play() {},
  pause() {},
  seek() {},
};

/**
 * An error's message as a failure shows it. Read off any object that has one, not only an Error: play() rejects with
 * a DOMException, which is an Error in browsers but need not be elsewhere.
 */
const message = (error: unknown): string => stringField(error, 'message') ?? String(error);

/** A DOMException's name, as play() rejects with: AbortError, NotAllowedError, NotSupportedError. */
const errorName = (error: unknown): string | null => stringField(error, 'name');

function stringField(error: unknown, field: 'name' | 'message'): string | null {
  if (typeof error !== 'object' || error === null || !(field in error)) return null;
  const value = (error as Record<typeof field, unknown>)[field];
  return typeof value === 'string' ? value : null;
}
