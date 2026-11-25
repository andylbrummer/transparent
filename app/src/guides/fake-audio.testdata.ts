/**
 * An audio element that plays nothing, and the promise it hands back from
 * play(), for the tests: the narration's and the guide session's share one
 * fake, to keep true to the browser in one place.
 */

/** A promise the test settles. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * A video element that plays nothing: a real one, so that it can stand in the panel, its playing FakeAudio's. `fake`
 * is that FakeAudio, for the test to set and read; `loads` counts load(), which a close calls to stop the fetch.
 */
export function fakeVideo(): HTMLVideoElement & { readonly fake: FakeAudio; loads: number } {
  const fake = new FakeAudio();
  const element = Object.assign(document.createElement('video'), { fake, loads: 0 });
  Object.defineProperties(element, {
    src: { get: () => fake.src, set: (value: string) => (fake.src = value) },
    currentTime: { get: () => fake.currentTime, set: (value: number) => (fake.currentTime = value) },
    duration: { get: () => fake.duration },
    ended: { get: () => fake.ended },
    paused: { get: () => fake.paused },
  });
  element.play = () => fake.play();
  element.pause = () => fake.pause();
  element.load = () => void element.loads++;
  return element;
}

/**
 * An audio element that plays nothing. The test sets its time, whether it
 * has ended, how far it has loaded and its error; it records every src and
 * every currentTime set, and each play() hands back a promise the test
 * settles. Setting currentTime makes it not ended, as a seek before the
 * end does.
 */
export class FakeAudio extends EventTarget {
  readonly srcs: string[] = [];
  readonly timeSets: number[] = [];
  readonly plays: ReturnType<typeof deferred<void>>[] = [];
  pauses = 0;
  ended = false;
  paused = true;
  /** Unknown until the test says: NaN, as an element before its metadata. */
  duration = NaN;
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
