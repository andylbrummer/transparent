/**
 * The clip player (spec/guides.md §8.4): a hotspot's clip opened, played and closed, through one audio element kept
 * for clips alone. One thing speaks at a time: while a clip is open the guide waits (guide-session reads isOpen), and
 * a clip never plays under the narration.
 *
 * On a phone and a desktop a clip opens in a panel: audio with its title, a progress bar and captions near the foot of
 * the screen; an image over the lower half, with its caption, its alt text on the image and its credit under it. In
 * Cardboard the page is hidden, so an image goes to the scene panel (clip-scene-panel.ts), hung where its marker was
 * when it opened; the captions per eye are phase 3's.
 *
 * Audio is not fetched as a blob, as narration is. The element is handed the file's URL and played in the same tap
 * that opened it: a fetch first would put the play outside the tap, and Safari would refuse it. Its captions are
 * fetched beside it; a clip whose captions do not come stops, as narration does not play without them.
 */

import * as THREE from 'three';
import type { ClipControl } from '../view/actions';
import type { CaptionOverlay } from './captions';
import type { Clip } from './format';
import type { FieldHotspot, HotspotField } from './hotspot-field';
import { parseVtt } from './vtt';

/** What the clip player uses of an HTMLAudioElement, so a test can stand in for one. */
export type ClipAudio = Pick<HTMLAudioElement, 'src' | 'currentTime' | 'duration' | 'ended' | 'paused' | 'play' | 'pause' | 'addEventListener' | 'removeEventListener'>;

/** Where an image is drawn in Cardboard: a flat panel in the scene. */
export interface ClipScenePanel {
  /** Show the image at `url` on a panel along `direction`, a world unit vector; taken as it is now. */
  showImage(url: string, direction: THREE.Vector3): void;
  hide(): void;
}

export interface ClipPlayerDeps {
  readonly parent: HTMLElement;
  /** The one element every audio clip plays through: not the narration's, which keeps its place while a clip plays. */
  readonly audio: ClipAudio;
  /** As the browser's fetch: for a clip's captions. */
  fetch(url: string): Promise<Response>;
  /** A caption overlay of the clip's own: the narration's is the guide session's. */
  readonly captions: Pick<CaptionOverlay, 'setCues' | 'update'>;
  /** The guide's captions switch: off there is off for a clip too. */
  captionsShown(): boolean;
  readonly scenePanel: ClipScenePanel;
  /** As URL.createObjectURL and URL.revokeObjectURL: for the unlock's silence. */
  readonly objectUrl: { create(blob: Blob): string; revoke(url: string): void };
  /** The unlock's sound: narration's silentWav. */
  silence(): Uint8Array<ArrayBuffer>;
}

/** What came of opening a clip: it is playing or showing, or why not. */
export type ClipOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** What the browser harness reads of the clip. */
export interface ClipStatus {
  readonly id: string | null;
  readonly kind: Clip['kind'] | null;
  readonly state: 'closed' | 'loading' | 'playing' | 'paused' | 'showing' | 'failed';
  readonly message: string | null;
}

export interface ClipPlayer {
  /** Inside a tap that starts a guide or enters the viewer: one play of silence, so a clip opened by a stare may play. */
  unlock(): void;
  /** Open a hotspot's clip in place of any open; the same one paused goes on from where it was. */
  open(hit: FieldHotspot): Promise<ClipOutcome>;
  close(): void;
  /** Pause or go on with an audio clip. False when no clip is open to take it. */
  toggle(): boolean;
  isOpen(): boolean;
  /**
   * Once a frame. `forward` is the view's direction in the viewer, null outside it: there, looking LOOK_AWAY_DEG from
   * the clip for LOOK_AWAY_MS pauses audio and puts an image away, so the wearer is never stuck behind one.
   */
  update(deltaMs: number, forward: THREE.Vector3 | null, stereo: boolean): void;
  getClip(): ClipStatus;
  dispose(): void;
}

/** The `clip` action (spec/guides.md §2): a hotspot found in the view by id and played, its failure an action's outcome. */
export function clipControl(field: Pick<HotspotField, 'find'>, player: Pick<ClipPlayer, 'open' | 'close'>): ClipControl {
  return {
    async play(id) {
      const hit = field.find(id);
      if (!hit) return { ok: false, code: 'unknown-hotspot', message: `no hotspot ${id} in the view` };
      const outcome = await player.open(hit);
      return outcome.ok ? outcome : { ok: false, code: 'media-failed', message: outcome.message };
    },
    stop: () => player.close(),
  };
}

export const LOOK_AWAY_DEG = 40;
export const LOOK_AWAY_MS = 3000;

type State =
  | { readonly kind: 'closed' }
  | { readonly kind: 'loading' | 'playing' | 'paused' | 'showing' | 'failed'; readonly hit: FieldHotspot; readonly message: string | null };

const CLOSED: State = { kind: 'closed' };
const LOOK_AWAY_COS = Math.cos(THREE.MathUtils.degToRad(LOOK_AWAY_DEG));

export function createClipPlayer(deps: ClipPlayerDeps): ClipPlayer {
  const { audio } = deps;
  let state: State = CLOSED;
  // Every open is numbered: an image or captions that arrive after another open, or a close, are dropped.
  let opens = 0;
  let unlocked = false;
  let awayMs = 0;
  /** The direction the clip opened toward, kept: the hotspot's own moves with the sky. */
  const openedToward = new THREE.Vector3();
  /** The progress bar's width as set, so a frame that would set the same leaves the page alone. */
  let barPercent = -1;
  let stereoShown = false;

  const panel = new ClipPanel(deps.parent, { close: () => close(), toggle: () => toggle() });

  const onEnded = (): void => {
    // An audio clip over is a clip closed: the guide goes on.
    if (state.kind === 'playing') close();
  };
  audio.addEventListener('ended', onEnded);

  function unlock(): void {
    if (unlocked || state.kind !== 'closed') return;
    const url = deps.objectUrl.create(new Blob([deps.silence()], { type: 'audio/wav' }));
    // Set and played inside the tap itself: the browser allows the first play nowhere else.
    audio.src = url;
    audio
      .play()
      .then(
        () => {
          unlocked = true;
          if (audio.src === url) audio.pause();
        },
        // A refusal is not reported: the clip's own play will be refused too, and say so in its panel.
        () => {}
      )
      .finally(() => deps.objectUrl.revoke(url));
  }

  async function open(hit: FieldHotspot): Promise<ClipOutcome> {
    if (state.kind === 'paused' && state.hit.hotspot.id === hit.hotspot.id) {
      toggle();
      return { ok: true };
    }
    close();
    const thisOpen = ++opens;
    const { clip } = hit.hotspot;
    openedToward.copy(hit.direction);
    awayMs = 0;
    state = { kind: 'loading', hit, message: null };
    panel.show(hit, clip);
    let outcome: ClipOutcome;
    try {
      outcome = clip.kind === 'image' ? await openImage(hit, clip, thisOpen) : await openAudio(hit, clip, thisOpen);
    } catch (error) {
      outcome = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    if (thisOpen !== opens) return { ok: false, message: 'another clip was opened' };
    if (!outcome.ok) fail(hit, outcome.message);
    return outcome;
  }

  async function openImage(hit: FieldHotspot, clip: Extract<Clip, { kind: 'image' }>, thisOpen: number): Promise<ClipOutcome> {
    const url = hit.source.fileUrl(clip.src);
    await panel.loadImage(url, clip.alt);
    if (thisOpen === opens) {
      state = { kind: 'showing', hit, message: null };
      stereoShown = false;
    }
    return { ok: true };
  }

  async function openAudio(hit: FieldHotspot, clip: Extract<Clip, { kind: 'audio' }>, thisOpen: number): Promise<ClipOutcome> {
    // Both before anything is awaited: the play has to be inside the tap that opened the clip.
    audio.src = hit.source.fileUrl(clip.src);
    const playing = audio.play();
    const captions = fetchCaptions(hit.source.fileUrl(clip.captions));
    const [cues] = await Promise.all([captions, playing]);
    if (thisOpen !== opens) return { ok: true };
    deps.captions.setCues(deps.captionsShown() ? { cues, lang: hit.source.language } : null);
    state = { kind: 'playing', hit, message: null };
    panel.setPaused(false);
    return { ok: true };
  }

  async function fetchCaptions(url: string) {
    const response = await deps.fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return parseVtt(await response.text());
  }

  function fail(hit: FieldHotspot, message: string): void {
    audio.pause();
    deps.captions.setCues(null);
    state = { kind: 'failed', hit, message };
    panel.showMessage(`This clip did not load: ${message}`);
  }

  function close(): void {
    if (state.kind === 'closed') return;
    opens++;
    if (state.hit.hotspot.clip.kind === 'audio') audio.pause();
    deps.captions.setCues(null);
    deps.scenePanel.hide();
    stereoShown = false;
    barPercent = -1;
    state = CLOSED;
    panel.hide();
  }

  function toggle(): boolean {
    if (state.kind === 'closed') return false;
    if (state.kind === 'playing') {
      audio.pause();
      state = { ...state, kind: 'paused' };
      panel.setPaused(true);
    } else if (state.kind === 'paused') {
      awayMs = 0;
      // A refused play shows as the clip failing: the user can open it again with a tap.
      audio.play().catch((error: unknown) => {
        if (state.kind !== 'closed') fail(state.hit, error instanceof Error ? error.message : String(error));
      });
      state = { ...state, kind: 'playing' };
      panel.setPaused(false);
    }
    return true;
  }

  function update(deltaMs: number, forward: THREE.Vector3 | null, stereo: boolean): void {
    if (state.kind === 'closed') return;
    if (state.kind === 'playing' || state.kind === 'paused') {
      const tS = audio.currentTime;
      deps.captions.update(tS);
      const duration = audio.duration;
      const percent = Number.isFinite(duration) && duration > 0 ? Math.round((1000 * tS) / duration) / 10 : 0;
      if (percent !== barPercent) {
        barPercent = percent;
        panel.setProgress(percent);
      }
    }
    // The scene panel follows the viewer in and out; the page's panel is hidden with the page in the viewer.
    if (state.kind === 'showing' && stereo !== stereoShown) {
      stereoShown = stereo;
      const clip = state.hit.hotspot.clip;
      if (stereo && clip.kind === 'image') deps.scenePanel.showImage(state.hit.source.fileUrl(clip.src), openedToward);
      else deps.scenePanel.hide();
    }
    if (!stereo || forward === null) {
      awayMs = 0;
      return;
    }
    awayMs = forward.dot(openedToward) < LOOK_AWAY_COS ? awayMs + deltaMs : 0;
    if (awayMs < LOOK_AWAY_MS) return;
    awayMs = 0;
    if (state.kind === 'playing') toggle();
    else if (state.kind !== 'paused') close();
  }

  function getClip(): ClipStatus {
    if (state.kind === 'closed') return { id: null, kind: null, state: 'closed', message: null };
    return { id: state.hit.hotspot.id, kind: state.hit.hotspot.clip.kind, state: state.kind, message: state.message };
  }

  return {
    unlock,
    open,
    close,
    toggle,
    isOpen: () => state.kind !== 'closed',
    update,
    getClip,
    dispose() {
      close();
      audio.removeEventListener('ended', onEnded);
      panel.dispose();
    },
  };
}

/** The clip's panel on the page. */
class ClipPanel {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly figure: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly caption: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly bar: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly credit: HTMLElement;
  private readonly message: HTMLElement;

  constructor(parent: HTMLElement, actions: { close(): void; toggle(): void }) {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, into: HTMLElement): HTMLElementTagNameMap[K] => {
      const made = document.createElement(tag);
      made.className = className;
      into.appendChild(made);
      return made;
    };
    this.root = document.createElement('section');
    this.root.className = 'clip';
    this.root.hidden = true;
    this.root.setAttribute('aria-labelledby', 'clip-title');
    const head = el('div', 'clip__head', this.root);
    this.title = el('h2', 'clip__title', head);
    this.title.id = 'clip-title';
    const closeButton = el('button', 'clip__close', head);
    closeButton.type = 'button';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Close the clip');
    closeButton.addEventListener('click', actions.close);
    this.figure = el('figure', 'clip__figure', this.root);
    this.image = el('img', 'clip__image', this.figure);
    this.caption = el('figcaption', 'clip__caption', this.figure);
    this.controls = el('div', 'clip__controls', this.root);
    this.toggleButton = el('button', 'clip__toggle', this.controls);
    this.toggleButton.type = 'button';
    this.toggleButton.addEventListener('click', actions.toggle);
    this.progress = el('div', 'clip__progress', this.controls);
    this.progress.setAttribute('role', 'progressbar');
    this.progress.setAttribute('aria-label', 'How far the clip has played');
    this.progress.setAttribute('aria-valuemin', '0');
    this.progress.setAttribute('aria-valuemax', '100');
    this.bar = el('div', 'clip__bar', this.progress);
    this.credit = el('p', 'clip__credit', this.root);
    this.message = el('p', 'clip__message', this.root);
    this.message.setAttribute('role', 'status');
    parent.appendChild(this.root);
  }

  show(hit: FieldHotspot, clip: Clip): void {
    this.root.hidden = false;
    this.root.dataset.kind = clip.kind;
    this.root.lang = hit.source.language;
    this.title.textContent = hit.hotspot.title;
    this.figure.hidden = clip.kind !== 'image';
    this.controls.hidden = clip.kind !== 'audio';
    this.caption.textContent = clip.kind === 'image' ? clip.caption : '';
    this.image.removeAttribute('src');
    this.image.alt = '';
    const { what, source, licence } = clip.credit;
    this.credit.replaceChildren(`${what}: `);
    const link = document.createElement('a');
    link.href = clip.credit.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = source;
    this.credit.append(link, `, ${licence}`);
    this.setPaused(false);
    this.setProgress(0);
    this.message.textContent = clip.kind === 'image' ? '' : 'Loading…';
  }

  /** Resolves when the image has loaded, rejects when it cannot. */
  loadImage(url: string, alt: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = (): void => {
        this.image.removeEventListener('load', onLoad);
        this.image.removeEventListener('error', onError);
      };
      const onLoad = (): void => {
        done();
        resolve();
      };
      const onError = (): void => {
        done();
        reject(new Error(`${url} could not be shown`));
      };
      this.image.addEventListener('load', onLoad);
      this.image.addEventListener('error', onError);
      this.image.alt = alt;
      this.image.src = url;
    });
  }

  setPaused(paused: boolean): void {
    this.toggleButton.textContent = paused ? 'Play' : 'Pause';
    if (!paused) this.message.textContent = '';
  }

  setProgress(percent: number): void {
    this.bar.style.width = `${percent}%`;
    this.progress.setAttribute('aria-valuenow', String(Math.round(percent)));
  }

  showMessage(text: string): void {
    this.message.textContent = text;
  }

  hide(): void {
    this.root.hidden = true;
    this.image.removeAttribute('src');
  }

  dispose(): void {
    this.root.remove();
  }
}
