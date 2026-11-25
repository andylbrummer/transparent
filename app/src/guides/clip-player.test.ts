import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clipControl, createClipPlayer, LOOK_AWAY_MS, type ClipPlayerDeps } from './clip-player';
import { FakeAudio, fakeVideo } from './fake-audio.testdata';
import type { Clip, Hotspot } from './format';
import type { FieldHotspot } from './hotspot-field';
import { silentWav } from './narration';

const CREDIT = { what: 'Diagram', source: 'USGS', licence: 'public domain', url: 'https://www.usgs.gov/' };
const IMAGE: Clip = { kind: 'image', src: 'images/prem.webp', alt: 'Rays through the mantle', caption: 'Waves bend at each boundary.', credit: CREDIT };
const AUDIO: Clip = { kind: 'audio', src: 'audio/prem.m4a', captions: 'audio/prem.vtt', credit: CREDIT };
const FILM = 'https://media.transparent.sbdev.io/guides/g/prem.0123abcd.mp4';
const VIDEO: Clip = {
  kind: 'video',
  src: FILM,
  captions: 'video/prem.vtt',
  poster: 'images/prem-poster.webp',
  video: { bytes: 1000, sha256: '0123abcd'.padEnd(64, '0'), durationS: 30, width: 1280, height: 720 },
  credit: CREDIT,
};
const VTT = 'WEBVTT\n\n00:00.000 --> 00:02.000\nListen.\n';
const AHEAD = new THREE.Vector3(1, 0, 0);

const hit = (clip: Clip, id = 'prem'): FieldHotspot => ({
  hotspot: { id, title: 'How we know', anchor: { kind: 'horizon', azDeg: 90, altDeg: 0 }, clip } as Hotspot,
  source: { hotspots: [], fileUrl: (path) => `/g/${path}`, language: 'en-GB' },
  direction: AHEAD.clone(),
});

let parent: HTMLElement;
const disposals: (() => void)[] = [];
beforeEach(() => {
  parent = document.createElement('div');
  document.body.appendChild(parent);
});
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  parent.remove();
});

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup(options: { captions?: string | Error; captionsShown?: boolean } = {}) {
  const audio = new FakeAudio();
  const video = fakeVideo();
  const cues: unknown[] = [];
  const fetched: string[] = [];
  const scene: string[] = [];
  const deps: ClipPlayerDeps = {
    parent,
    audio,
    video,
    fetch(url) {
      fetched.push(url);
      const answer = options.captions ?? VTT;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(new Response(answer));
    },
    captions: { setCues: (next) => cues.push(next && { lang: next.lang, texts: next.cues.map((cue) => cue.lines.join(' ')) }), update() {} },
    captionsShown: () => options.captionsShown ?? true,
    scenePanel: { showImage: (url, direction) => scene.push(`show ${url} ${direction.x}`), hide: () => scene.push('hide') },
    objectUrl: { create: () => 'blob:silence', revoke() {} },
    silence: silentWav,
  };
  const player = createClipPlayer(deps);
  disposals.push(() => player.dispose());
  return { player, audio, video, cues, fetched, scene };
}

const panel = (): HTMLElement => parent.querySelector<HTMLElement>('.clip')!;
const image = (): HTMLImageElement => panel().querySelector('img')!;
const text = (selector: string): string => panel().querySelector(selector)!.textContent!;

describe('the clip player', () => {
  it('shows an image in its panel, with its caption, alt text and credit, once it has loaded', async () => {
    const t = setup();
    const opening = t.player.open(hit(IMAGE));
    expect(panel().hidden).toBe(false);
    expect(t.player.getClip()).toEqual({ id: 'prem', kind: 'image', state: 'loading', message: null });
    expect(image().getAttribute('src')).toBe('/g/images/prem.webp');
    image().dispatchEvent(new Event('load'));
    expect(await opening).toEqual({ ok: true });
    expect(t.player.getClip().state).toBe('showing');
    expect(text('.clip__title')).toBe('How we know');
    expect(image().alt).toBe(IMAGE.alt);
    expect(text('.clip__caption')).toBe('Waves bend at each boundary.');
    expect(text('.clip__credit')).toBe('Diagram: USGS, public domain');
    expect(panel().querySelector<HTMLElement>('.clip__controls')!.hidden).toBe(true);
    panel().querySelector<HTMLButtonElement>('.clip__close')!.click();
    expect(panel().hidden).toBe(true);
    expect(t.player.isOpen()).toBe(false);
  });

  it('says so when an image does not load', async () => {
    const t = setup();
    const opening = t.player.open(hit(IMAGE));
    image().dispatchEvent(new Event('error'));
    expect(await opening).toEqual({ ok: false, message: '/g/images/prem.webp could not be shown' });
    expect(t.player.getClip().state).toBe('failed');
    expect(text('.clip__message')).toBe('This clip did not load: /g/images/prem.webp could not be shown');
  });

  it('plays audio in the tap that opened it, with its captions, and closes at its end', async () => {
    const t = setup();
    const opening = t.player.open(hit(AUDIO));
    // Before anything is awaited: a play after a fetch would be outside the tap.
    expect(t.audio.src).toBe('/g/audio/prem.m4a');
    expect(t.audio.plays).toHaveLength(1);
    expect(t.fetched).toEqual(['/g/audio/prem.vtt']);
    t.audio.plays[0].resolve();
    expect(await opening).toEqual({ ok: true });
    expect(t.cues.at(-1)).toEqual({ lang: 'en-GB', texts: ['Listen.'] });
    expect(t.player.getClip().state).toBe('playing');
    t.audio.duration = 10;
    t.audio.currentTime = 2.5;
    t.player.update(16, null, false);
    expect(panel().querySelector<HTMLElement>('.clip__bar')!.style.width).toBe('25%');
    t.audio.dispatchEvent(new Event('ended'));
    expect(t.player.isOpen()).toBe(false);
    expect(t.cues.at(-1)).toBeNull();
  });

  it('stops an audio clip whose captions do not come', async () => {
    const t = setup({ captions: new Error('offline') });
    const opening = t.player.open(hit(AUDIO));
    t.audio.plays[0].resolve();
    expect(await opening).toEqual({ ok: false, message: 'offline' });
    expect(t.audio.paused).toBe(true);
    expect(t.player.getClip()).toMatchObject({ state: 'failed', message: 'offline' });
  });

  it('keeps an audio clip’s captions down while the guide’s switch is off', async () => {
    const t = setup({ captionsShown: false });
    const opening = t.player.open(hit(AUDIO));
    t.audio.plays[0].resolve();
    await opening;
    expect(t.cues).toEqual([null]);
  });

  it('pauses and goes on, and goes on when the same clip is opened again', async () => {
    const t = setup();
    const opening = t.player.open(hit(AUDIO));
    t.audio.plays[0].resolve();
    await opening;
    expect(t.player.toggle()).toBe(true);
    expect(t.audio.paused).toBe(true);
    expect(t.player.getClip().state).toBe('paused');
    expect(await t.player.open(hit(AUDIO))).toEqual({ ok: true });
    expect(t.player.getClip().state).toBe('playing');
    expect(t.audio.srcs).toEqual(['/g/audio/prem.m4a']);
    t.player.close();
    expect(t.player.toggle()).toBe(false);
  });

  it('keeps the clip opened last when an earlier one loads after it', async () => {
    const t = setup();
    const first = t.player.open(hit(IMAGE, 'first'));
    const second = t.player.open(hit(AUDIO, 'second'));
    t.audio.plays[0].resolve();
    expect(await second).toEqual({ ok: true });
    image().dispatchEvent(new Event('load'));
    await first;
    expect(t.player.getClip()).toMatchObject({ id: 'second', state: 'playing' });
  });

  it('plays silence once to unlock both elements, and lets go of it', async () => {
    const t = setup();
    t.player.unlock();
    expect(t.audio.srcs).toEqual(['blob:silence']);
    expect(t.video.fake.srcs).toEqual(['blob:silence']);
    t.audio.plays[0].resolve();
    t.video.fake.plays[0].resolve();
    await settle();
    expect([t.audio.paused, t.video.paused]).toEqual([true, true]);
    t.player.unlock();
    expect([t.audio.plays.length, t.video.fake.plays.length]).toEqual([1, 1]);
  });

  it('tries the unlock again at the next tap when one element was refused', async () => {
    const t = setup();
    t.player.unlock();
    t.audio.plays[0].resolve();
    t.video.fake.plays[0].reject(new Error('not allowed'));
    await settle();
    t.player.unlock();
    expect(t.video.fake.plays).toHaveLength(2);
  });

  describe('in the viewer', () => {
    const away = new THREE.Vector3(0, 1, 0);
    const look = (t: ReturnType<typeof setup>, forward: THREE.Vector3, ms: number): void => {
      for (let elapsed = 0; elapsed < ms; elapsed += 100) t.player.update(100, forward, true);
    };

    it('hangs an image in the scene where its marker was, and takes it down on close', async () => {
      const t = setup();
      const opening = t.player.open(hit(IMAGE));
      image().dispatchEvent(new Event('load'));
      await opening;
      t.player.update(16, AHEAD, false);
      expect(t.scene).toEqual([]);
      t.player.update(16, AHEAD, true);
      expect(t.scene).toEqual(['show /g/images/prem.webp 1']);
      t.player.update(16, AHEAD, false);
      t.player.close();
      expect(t.scene).toEqual(['show /g/images/prem.webp 1', 'hide', 'hide']);
    });

    it('pauses audio looked away from for 3 s, and puts an image away', async () => {
      const t = setup();
      const opening = t.player.open(hit(AUDIO));
      t.audio.plays[0].resolve();
      await opening;
      look(t, away, LOOK_AWAY_MS - 200);
      expect(t.player.getClip().state).toBe('playing');
      look(t, away, 300);
      expect(t.player.getClip().state).toBe('paused');
      const showing = t.player.open(hit(IMAGE, 'pic'));
      image().dispatchEvent(new Event('load'));
      await showing;
      look(t, away, LOOK_AWAY_MS + 100);
      expect(t.player.isOpen()).toBe(false);
    });

    it('takes no notice of where the view looks outside the viewer', async () => {
      const t = setup();
      const opening = t.player.open(hit(AUDIO));
      t.audio.plays[0].resolve();
      await opening;
      for (let elapsed = 0; elapsed < 2 * LOOK_AWAY_MS; elapsed += 100) t.player.update(100, away, false);
      expect(t.player.getClip().state).toBe('playing');
    });
  });
});

describe('the clip player, with a video', () => {
  const shown = (selector: string): boolean => !panel().querySelector<HTMLElement>(selector)!.hidden;

  it('plays it in the panel from the media host, inside the tap, with its poster, its captions and the browser controls', async () => {
    const t = setup();
    const opening = t.player.open(hit(VIDEO));
    // Asked to play before anything was awaited: inside the tap.
    expect(t.video.fake.plays).toHaveLength(1);
    expect(t.video.src).toBe(FILM);
    expect(t.video.poster).toContain('/g/images/prem-poster.webp');
    expect(t.video.controls && t.video.playsInline).toBe(true);
    expect(t.video.crossOrigin).toBe('anonymous');
    expect(t.video.preload).toBe('none');
    expect(t.fetched).toEqual(['/g/video/prem.vtt']);
    t.video.fake.plays[0].resolve();
    expect(await opening).toEqual({ ok: true });
    expect(t.player.getClip()).toEqual({ id: 'prem', kind: 'video', state: 'playing', message: null });
    expect([shown('.clip__video'), shown('.clip__image'), shown('.clip__caption'), shown('.clip__controls')]).toEqual([true, false, false, false]);
    expect(t.cues.at(-1)).toEqual({ lang: 'en-GB', texts: ['Listen.'] });
    expect(t.audio.plays).toHaveLength(0);
  });

  it('follows the browser controls, so Space and the look-away act on what is so', async () => {
    const t = setup();
    const opening = t.player.open(hit(VIDEO));
    t.video.fake.plays[0].resolve();
    await opening;
    t.video.fake.pause();
    t.player.update(16, null, false);
    expect(t.player.getClip().state).toBe('paused');
    expect(t.player.toggle()).toBe(true);
    expect(t.video.fake.plays).toHaveLength(2);
    expect(t.player.getClip().state).toBe('playing');
  });

  it('stops fetching once closed, and closes at its end', async () => {
    const t = setup();
    let opening = t.player.open(hit(VIDEO));
    t.video.fake.plays[0].resolve();
    await opening;
    t.player.close();
    expect(t.video.fake.paused).toBe(true);
    expect(t.video.loads).toBe(1);
    expect(t.video.hasAttribute('poster')).toBe(false);
    opening = t.player.open(hit(VIDEO));
    t.video.fake.plays[1].resolve();
    await opening;
    t.video.dispatchEvent(new Event('ended'));
    expect(t.player.isOpen()).toBe(false);
  });

  it('says so when the film does not play', async () => {
    const t = setup();
    const opening = t.player.open(hit(VIDEO));
    t.video.fake.plays[0].reject(new Error('the media host refused it'));
    expect(await opening).toEqual({ ok: false, message: 'the media host refused it' });
    expect(t.player.getClip().state).toBe('failed');
    expect(text('.clip__message')).toBe('This clip did not load: the media host refused it');
  });
});

describe('clipControl', () => {
  it('plays a hotspot found in the view, and names what went wrong as an action does', async () => {
    const opened: string[] = [];
    let closed = 0;
    const field = { find: (id: string) => (id === 'prem' || id === 'broken' ? hit(IMAGE, id) : null) };
    const player = {
      open: (found: FieldHotspot) => (
        opened.push(found.hotspot.id),
        Promise.resolve(found.hotspot.id === 'prem' ? { ok: true as const } : { ok: false as const, message: 'the image did not load' })
      ),
      close: () => void closed++,
    };
    const control = clipControl(field, player);
    expect(await control.play('prem')).toEqual({ ok: true });
    expect(await control.play('broken')).toEqual({ ok: false, code: 'media-failed', message: 'the image did not load' });
    expect(await control.play('nothing')).toEqual({ ok: false, code: 'unknown-hotspot', message: 'no hotspot nothing in the view' });
    control.stop();
    expect(opened).toEqual(['prem', 'broken']);
    expect(closed).toBe(1);
  });
});
