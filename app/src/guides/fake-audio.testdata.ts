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
