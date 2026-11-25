/**
 * Does the view's actions (actions.ts). It is the one implementation:
 * guides, voice commands and later the voice AI all come through here, so
 * they cannot drift apart. Its collaborators are passed in, so it is
 * tested without the renderer.
 */

import * as THREE from 'three';
import { MAX_FOV_DEG, MIN_FOV_DEG, type LookController, type LookState } from '../input/look';
import type { LayerManager } from '../layers/manager';
import { paramProblems } from '../layers/params';
import type { LayerParamValues } from '../layers/types';
import { SKY_RADIUS_M } from '../layers/types';
import type { GlobeRenderer } from '../render/globe';
import type { LabelGroup, LabelGroupSpec, LabelStyle } from '../render/labels';
import type { AppClock } from '../clock';
import type { DeviceAttitude } from '../sensors';
import { canFade, type LayerSwitch, type LayersPanel } from '../ui/layers-panel';
import type { LayerPreset } from '../ui/presets';
import { CAPTURE_DEG, FRAME_MARGIN, type SpyglassTarget } from '../ui/spyglass';
import type { ActionOutcome, AimMode, AwaitedGaze, ClipControl, FoldedView, Located, Target, TargetUnresolved, TimeSetting, ViewAction, ViewBorrow, ViewControl } from './actions';
import { easeAim, type Aim, type AimEase } from './aim-ease';
import { samePlace, type StandingPlace } from './standing-place';
import { horizonOf, loadBodyPositions, needsBodyPositions, targetDirection, targetKey, targetName, type LabelIndex, type LoadedLabels } from './targets';

export interface ViewControlDeps {
  /** Every preset an action may name. */
  readonly presets: readonly LayerPreset[];
  /** Every switch an action may name. */
  readonly switches: readonly LayerSwitch[];
  /** Switches are flipped through the panel, so its rows, the save and the scene stay in step. */
  readonly layersPanel: Pick<LayersPanel, 'applyPreset' | 'setLayer' | 'showOnly' | 'borrow' | 'isOn'>;
  /** The lazy layers: a switch-on is not done until its layer has loaded. */
  readonly lazyLayers: Pick<LayerManager, 'preload' | 'setParams' | 'setOpacity'>;
  /** The globe, whose shells fade. */
  readonly shells: Pick<GlobeRenderer, 'setShellOpacity'>;
  /** The view's camera: its forward is the view's centre, in a pose as in a drag. */
  readonly camera: THREE.Camera;
  /** Where the view stands: its position is null until there is one. */
  readonly standing: Pick<StandingPlace, 'place' | 'position' | 'set' | 'positionOf'>;
  /** The app clock: targets are found at its time. */
  readonly clock: AppClock;
  /** The baked labels by name; null until the label files have loaded. */
  getLabels(): LabelIndex | null;
  /** The names the lazy layers have added, where a label the baked files lack is looked for: the label layer. */
  readonly loadedLabels: LoadedLabels;
  /** The manual aim and field of view. */
  readonly look: Pick<LookController, 'getState' | 'setAim'>;
  /** The device's pose, or null when a drag aims the view: this decides the aim mode. */
  getAttitude(): DeviceAttitude | null;
  /** The user asked the system for less motion: no eases. */
  prefersReducedMotion(): boolean;
  /** Add a group of names to the view: a mark is one. */
  addLabels(spec: LabelGroupSpec): LabelGroup;
  /**
   * Cardboard's spyglass, where a look narrower than FOV_NEEDS_TARGET_BELOW_DEG opens: the viewer cannot narrow its
   * own field of view. Absent, or not in stereo, such a look narrows the view as anywhere else.
   */
  readonly spyglass?: {
    inStereo(): boolean;
    openOn(target: SpyglassTarget): void;
  };
  /**
   * Fade the view to dark, make `change` and wait for it, then fade back (render/dip.ts): every hard change to the
   * whole view goes through it. Resolves with the change's result once it is made.
   */
  dip<T>(change: () => T | Promise<T>): Promise<T>;
  /** The clip player, where the app has one: without it every clip names an unknown hotspot. */
  readonly clips?: ClipControl;
}

/** Narrower than this, a field of view needs a target: Cardboard can only magnify through the spyglass, which opens on something. */
export const FOV_NEEDS_TARGET_BELOW_DEG = 30;

/** The longest fade a `layers` action may ask for: longer is a layer left half-drawn while the guide talks on. */
export const MAX_FADE_S = 10;
/** The fastest a guide may run the app clock, either way: a year a second. */
export const MAX_TIME_RATE = 31_557_600;
/**
 * The fastest the app clock runs in Cardboard, either way (spec/guides.md §7.3): the sky turns 15° an hour, so this is
 * 10° a second. A whole sky turning faster in a headset makes people ill. A first guess, to be tried in a viewer.
 */
export const CARDBOARD_MAX_TIME_RATE = 2400;
/** Faster than this, a clock is a time-lapse: a sky turning past more than a degree every four seconds. */
export const TIME_LAPSE_ABOVE_RATE = 60;
/** A time setting this near where the clock stands is no jump, and no reason to go dark. */
const TIME_JUMP_MS = 60_000;

/** A target is centred when it has stayed this near the view's centre for ARRIVE_MS. Looser and quicker than the spyglass's stare: arriving only lets a guide move on. */
export const ARRIVE_DEG = 8;
export const ARRIVE_MS = 600;
/** In a pose a look narrows no further than this: a hand cannot hold a narrower view still. */
export const POSE_MIN_FOV_DEG = 5;

/** What a target other than a label is resolved with before the label files arrive: it needs none. */
const NO_LABELS: LabelIndex = new Map();

/** Before every name, countries (rank 0) included: a guide's mark wins any overlap. */
const MARK_RANK = -1;
const MARK_STYLE: LabelStyle = { fontPx: 13, color: '#ffffff', bold: true, ring: true };

/** A time setting the view control has checked: in milliseconds, and whether it is live time. */
interface CheckedTime {
  readonly ok: true;
  readonly fromMs: number;
  readonly rate: number;
  readonly untilMs: number | undefined;
  readonly live: boolean;
  /** Starting from 'now': the wall time when it is made, not when it was checked. */
  readonly fromNow: boolean;
}

/** A mark on the view, and the target it is found on again each frame. */
interface Mark {
  readonly target: Target;
  /** Read by the label layer every frame, so it is moved in place. */
  readonly position: THREE.Vector3;
  readonly group: LabelGroup;
}

/** A look waiting on the user to turn: what AwaitedGaze shows, the field of view to apply on arrival, and the time spent centred. */
interface Gaze {
  readonly target: Target;
  readonly name: string | null;
  /** Found again every frame, in place, so a pointer can hold on to it. */
  readonly direction: THREE.Vector3;
  readonly fovDeg: number | undefined;
  withinMs: number;
}

/** An ease under way, and the action waiting on it. */
interface Easing {
  readonly ease: AimEase;
  /** A look's wait, should the user take the view over before it ends; null for a field of view alone. */
  readonly gaze: Gaze | null;
  readonly resolve: (outcome: ActionOutcome) => void;
  elapsedMs: number;
  /** The look state as the ease last left it: any other means the user has moved the view. */
  seen: LookState;
}

/** A switch fading in or out (a `layers` action's fadeS), and the action waiting on it. */
interface Fade {
  readonly layer: LayerSwitch;
  readonly from: number;
  readonly to: 0 | 1;
  readonly durationMs: number;
  elapsedMs: number;
  /** The opacity last written: where a fade that takes over this one starts. */
  opacity: number;
  /** A lazy layer still loading: the fade starts once it has, so it is not spent on nothing. */
  held: boolean;
  readonly done: Promise<ActionOutcome>;
  readonly resolve: (outcome: ActionOutcome) => void;
}

export function createViewControl(deps: ViewControlDeps): ViewControl & {
  /**
   * Advance an ease by a frame's time, keep the marks on their targets and see whether the user has turned to a look
   * that waits. Call once a frame, before the camera is aimed.
   */
  update(deltaMs: number): void;
} {
  const switchesById = new Map(deps.switches.map((s) => [s.id, s]));
  let easing: Easing | null = null;
  let awaiting: Gaze | null = null;
  /** In Cardboard, a narrow look that has arrived and waits for its target within CAPTURE_DEG to open the spyglass. */
  let spyglassWait: { readonly target: Target; readonly spyglass: SpyglassTarget } | null = null;
  const marks = new Map<string, Mark>();
  const fades = new Map<string, Fade>();
  let borrowed = false;
  // Counts borrows begun and ended. A change waiting for the dark belongs to the borrow it was asked for in: one that
  // has ended since must not have its view put back after it.
  let borrowEpoch = 0;

  /**
   * Make `change` in the dark, unless the borrow it was asked in has ended or begun while the view went dark: then
   * the view is no longer the asker's, and nothing is done.
   */
  function inTheDark(change: () => ActionOutcome | Promise<ActionOutcome>): Promise<ActionOutcome> {
    const epoch = borrowEpoch;
    return deps.dip((): ActionOutcome | Promise<ActionOutcome> => (epoch === borrowEpoch ? change() : { ok: true }));
  }

  /**
   * Wait for the lazy layers among `switches` to load; the rest are drawn
   * already. A failed load leaves its switch on with its chip, as a failed
   * tap does: putting the view back is the borrow's job. The preloads all
   * start before the first await, so one that throws for an unknown id
   * rejects perform rather than turning into an outcome.
   */
  async function lazyLayersLoaded(switches: readonly LayerSwitch[]): Promise<ActionOutcome> {
    const waits: { readonly id: string; readonly loading: Promise<void> }[] = [];
    for (const layer of switches) {
      if ('lazy' in layer.target) waits.push({ id: layer.id, loading: deps.lazyLayers.preload(layer.target.lazy) });
    }
    const results = await Promise.allSettled(waits.map((wait) => wait.loading));
    const failed = waits.filter((_, i) => results[i].status === 'rejected').map((wait) => wait.id);
    if (failed.length > 0) return { ok: false, code: 'layer-unavailable', message: `layer failed to load: ${failed.join(', ')}` };
    return { ok: true };
  }

  /**
   * Wait for the Sun, Moon and planet positions (targets.ts loadBodyPositions). Callers ask only when a target needs
   * them, so an action on anything else, or on a body once they are in, keeps every change before its first await.
   */
  async function bodiesLoaded(): Promise<ActionOutcome> {
    try {
      await loadBodyPositions();
      return { ok: true };
    } catch {
      return { ok: false, code: 'target-unresolved', message: 'the Sun, Moon and planet positions failed to load' };
    }
  }

  /** Same test as look.ts updateCamera: an attitude, when there is one, aims the camera. */
  function aimMode(): AimMode {
    return deps.getAttitude() === null ? 'manual' : 'pose';
  }

  /** A field of view the camera cannot take, refused rather than clamped. */
  function fovOutOfRange(fovDeg: number | undefined): ActionOutcome | null {
    if (fovDeg === undefined || (Number.isFinite(fovDeg) && fovDeg >= MIN_FOV_DEG && fovDeg <= MAX_FOV_DEG)) return null;
    return { ok: false, code: 'bad-value', message: `fovDeg ${fovDeg} is outside ${MIN_FOV_DEG} to ${MAX_FOV_DEG}` };
  }

  /**
   * The manual aim. Azimuth is clockwise and yaw counter-clockwise; the
   * yaw is not wrapped, so neither is the azimuth, and an ease ends on a
   * yaw continuous with where it began.
   */
  function currentAim(): Aim {
    const state = deps.look.getState();
    return { azDeg: -THREE.MathUtils.radToDeg(state.yawRad), altDeg: THREE.MathUtils.radToDeg(state.pitchRad), fovDeg: state.fovDeg };
  }

  function setAim(aim: Aim): void {
    deps.look.setAim(-THREE.MathUtils.degToRad(aim.azDeg), THREE.MathUtils.degToRad(aim.altDeg), aim.fovDeg);
  }

  function endEase(outcome: ActionOutcome): void {
    const ending = easing;
    easing = null;
    ending?.resolve(outcome);
  }

  /** Turn the manual view to `to`: with an ease, or at once when motion is to be kept down or there is nothing to turn. */
  function easeTo(to: Aim, gaze: Gaze | null): Promise<ActionOutcome> {
    // A new action takes over from an ease still under way, from where it has got to.
    endEase({ ok: true });
    const ease = easeAim(currentAim(), to);
    if (ease.durationMs === 0) {
      setAim(ease.at(0));
      return Promise.resolve({ ok: true });
    }
    // No camera moves with reduced motion, nor a jump the eye cannot follow: a dip to dark and a cut. The dip is a
    // fade, not movement (spec/guides.md §11).
    if (deps.prefersReducedMotion()) {
      return inTheDark(() => {
        setAim(ease.at(ease.durationMs));
        return { ok: true };
      });
    }
    return new Promise((resolve) => {
      easing = { ease, gaze, resolve, elapsedMs: 0, seen: deps.look.getState() };
    });
  }

  /** The field of view, keeping the aim: set at once in a pose, eased in a drag. */
  function setFov(fovDeg: number): Promise<ActionOutcome> {
    if (aimMode() === 'pose') {
      const state = deps.look.getState();
      deps.look.setAim(state.yawRad, state.pitchRad, Math.max(fovDeg, POSE_MIN_FOV_DEG));
      return Promise.resolve({ ok: true });
    }
    return easeTo({ ...currentAim(), fovDeg }, null);
  }

  // The switches flip before the first await, so they have flipped by the
  // time perform returns; its promise then waits for the layers to load
  // or the ease to finish.
  async function perform(action: ViewAction): Promise<ActionOutcome> {
    switch (action.do) {
      case 'preset': {
        const preset = deps.presets.find((p) => p.id === action.id);
        if (!preset) return { ok: false, code: 'unknown-preset', message: `no preset ${action.id}` };
        dropAllFades();
        // Every switch at once is a hard change: in the dark, which lasts until its layers are in.
        return inTheDark(() => {
          deps.layersPanel.applyPreset(preset);
          const on = new Set(preset.on);
          return lazyLayersLoaded(deps.switches.filter((s) => on.has(s.id)));
        });
      }
      case 'layers': {
        const on = action.on ?? [];
        const off = action.off ?? [];
        // Check everything before flipping anything, so a mistake leaves the view untouched.
        if (on.length === 0 && off.length === 0) return { ok: false, code: 'bad-value', message: 'layers names no switch' };
        const unknown = [...new Set([...off, ...on].filter((id) => !switchesById.has(id)))];
        if (unknown.length > 0) return { ok: false, code: 'unknown-layer', message: `no layer switch ${unknown.join(', ')}` };
        const both = [...new Set(on.filter((id) => off.includes(id)))];
        if (both.length > 0) return { ok: false, code: 'bad-value', message: `layers turns ${both.join(', ')} both on and off` };
        const badParams = paramsProblem(action.params, on);
        if (badParams) return badParams;
        const badFade = fadeProblem(action.fadeS, [...off, ...on]);
        if (badFade) return badFade;
        if (action.fadeS !== undefined) return fadeLayers(on, off, action.params, action.fadeS * 1000);
        // A fade under way on a switch flipped at once stops: this action has the last word on it.
        for (const id of [...off, ...on]) dropFade(id);
        // Off before on, as applyPreset does: an exclusive group never has two on.
        for (const id of off) deps.layersPanel.setLayer(id, false);
        // Settings before the switch, so a layer already loaded never shows a frame as it was.
        const setting = giveParams(action.params);
        if (setting) return setting;
        for (const id of on) deps.layersPanel.setLayer(id, true);
        return lazyLayersLoaded([...new Set(on)].map((id) => switchesById.get(id)!));
      }
      case 'look': {
        const badFov = fovOutOfRange(action.fovDeg);
        if (badFov) return badFov;
        if (needsBodyPositions(action.target)) {
          const loaded = await bodiesLoaded();
          if (!loaded.ok) return loaded;
        }
        const located = locate(action.target);
        if (!located.ok) return { ok: false, code: 'target-unresolved', message: located.message };
        const gaze = gazeOn(action.target, located, action.fovDeg);
        // The guide cannot turn someone holding the phone: the pointer shows them the way.
        if (aimMode() === 'pose') {
          awaiting = gaze;
          spyglassWait = null;
          return { ok: true, awaitingGaze: true };
        }
        awaiting = null;
        spyglassWait = null;
        return easeTo({ azDeg: located.azDeg, altDeg: located.altDeg, fovDeg: action.fovDeg ?? deps.look.getState().fovDeg }, gaze);
      }
      case 'fov': {
        const badFov = fovOutOfRange(action.fovDeg);
        if (badFov) return badFov;
        if (action.fovDeg < FOV_NEEDS_TARGET_BELOW_DEG) {
          return { ok: false, code: 'bad-value', message: `a field of view under ${FOV_NEEDS_TARGET_BELOW_DEG} needs a target: use look` };
        }
        return setFov(action.fovDeg);
      }
      case 'mark': {
        const key = targetKey(action.target);
        if (action.text === null) {
          // Not there is not a mistake: a guide that has jumped has cleared its marks already.
          // Nor is a target that does not resolve now, so it is not looked for.
          marks.get(key)?.group.remove();
          marks.delete(key);
          return { ok: true };
        }
        if (action.text === '') return { ok: false, code: 'bad-value', message: 'mark text is empty' };
        if (needsBodyPositions(action.target)) {
          const loaded = await bodiesLoaded();
          if (!loaded.ok) return loaded;
        }
        const located = locate(action.target);
        if (!located.ok) return { ok: false, code: 'target-unresolved', message: located.message };
        putMark(action.target, action.text, located.direction);
        return { ok: true };
      }
      case 'time': {
        const checked = checkTime(action);
        if (!checked.ok) return checked;
        const time = withoutTimeLapse(checked);
        // Live already, and asked for live: nothing to do.
        if (time.live && deps.clock.isLive()) return { ok: true };
        // A change of rate where the clock stands is not a jump: it just runs on faster, and seeing it is the point.
        if (Math.abs(time.fromMs - deps.clock.now().getTime()) < TIME_JUMP_MS) return applyTime(time);
        return inTheDark(() => applyTime(time));
      }
      case 'stand': {
        const { place } = action;
        if (place.kind === 'at' && !(Math.abs(place.lat) <= 90 && Math.abs(place.lon) <= 180)) {
          return { ok: false, code: 'bad-value', message: `no place at ${place.lat}, ${place.lon}` };
        }
        // Standing where it stands already is no change, and no reason to go dark.
        if (samePlace(place, deps.standing.place())) return { ok: true };
        // The whole view moves: in the dark. The aim stays, as a direction in the new place's own frame.
        return inTheDark(() => {
          deps.standing.set(place);
          return { ok: true };
        });
      }
      case 'clip': {
        if (action.hotspot === null) {
          deps.clips?.stop();
          return { ok: true };
        }
        if (!deps.clips) return { ok: false, code: 'unknown-hotspot', message: `no hotspot ${action.hotspot}` };
        return deps.clips.play(action.hotspot);
      }
    }
  }

  // Everything is checked first, then every change is made at once in the dark. The one wait before the dark is for
  // the body positions, the first time a view needs them; preload asks for them ahead.
  async function restore(view: FoldedView): Promise<ActionOutcome> {
    const { look } = view;
    // Check everything before changing anything, so a mistake leaves the user where they were.
    const switches = switchesOn(view.layers);
    if (!switches.ok) return switches;
    // Only the settings of the layers that will be on: one switched off since keeps them, unused, as a layer does.
    const params = view.params && Object.fromEntries(Object.entries(view.params).filter(([id]) => switches.on.includes(id)));
    const badParams = paramsProblem(params, switches.on);
    if (badParams) return badParams;
    const badFov = fovOutOfRange(look.fovDeg);
    if (badFov) return badFov;
    if (viewTargets(view).some(needsBodyPositions)) {
      const loaded = await bodiesLoaded();
      if (!loaded.ok) return loaded;
    }
    if (view.place.kind === 'at' && !(Math.abs(view.place.lat) <= 90 && Math.abs(view.place.lon) <= 180)) {
      return { ok: false, code: 'bad-value', message: `no place at ${view.place.lat}, ${view.place.lon}` };
    }
    const checkedTime = checkTime(view.time);
    if (!checkedTime.ok) return checkedTime;
    const time = withoutTimeLapse(checkedTime);
    // Found from where the view will stand, which is not yet where it stands.
    const destination = deps.standing.positionOf(view.place);
    const located = locate(look.target, destination);
    if (!located.ok) return { ok: false, code: 'target-unresolved', message: located.message };
    const placed: { readonly target: Target; readonly text: string; readonly direction: THREE.Vector3 }[] = [];
    for (const mark of view.marks) {
      if (mark.text === '') return { ok: false, code: 'bad-value', message: 'mark text is empty' };
      const found = locate(mark.target, destination);
      if (!found.ok) return { ok: false, code: 'target-unresolved', message: found.message };
      placed.push({ target: mark.target, text: mark.text, direction: found.direction });
    }

    const setting = giveParams(params);
    if (setting) return setting;
    dropAllFades();
    // An ease under way stops now, not in the dark: it would go on turning the view toward the old look meanwhile.
    endEase({ ok: true });
    spyglassWait = null;
    return inTheDark(async () => {
      // First, so the look and the marks below are found from there.
      if (!samePlace(view.place, deps.standing.place())) deps.standing.set(view.place);
      if (!(time.live && deps.clock.isLive())) applyTime(time);
      deps.layersPanel.showOnly(switches.on);
      const posed = aimMode() === 'pose';
      // Found again in the dark, where the view now stands and when; it resolved before, so it is not refused here.
      const relocated = locate(look.target);
      const lookAt = relocated.ok ? relocated : located;
      // The guide cannot turn someone holding the phone, at a cut any more than in an ease: the pointer shows the way.
      if (posed) awaiting = gazeOn(look.target, lookAt, look.fovDeg);
      else {
        awaiting = null;
        setAim({ azDeg: lookAt.azDeg, altDeg: lookAt.altDeg, fovDeg: look.fovDeg });
      }
      // Found again: the view may have moved on while it went dark, and a mark's direction is where it is drawn.
      takeMarksDown();
      for (const mark of placed) {
        const found = locate(mark.target);
        putMark(mark.target, mark.text, found.ok ? found.direction : mark.direction);
      }

      const loaded = await lazyLayersLoaded(switches.on.map((id) => switchesById.get(id)!));
      if (!loaded.ok) return loaded;
      return posed ? { ok: true, awaitingGaze: true } : { ok: true };
    });
  }

  async function preload(view: FoldedView): Promise<ActionOutcome> {
    // The switches, and the body positions if the look or a mark is a body. The targets are not located: they may
    // not resolve until the view gets there.
    const switches = switchesOn(view.layers);
    if (!switches.ok) return switches;
    const bodies = viewTargets(view).some(needsBodyPositions) ? bodiesLoaded() : Promise.resolve<ActionOutcome>({ ok: true });
    const [layers, positions] = await Promise.all([lazyLayersLoaded(switches.on.map((id) => switchesById.get(id)!)), bodies]);
    return layers.ok ? positions : layers;
  }

  /**
   * Why `params` cannot be given, or null: a setting goes to a layer this action turns on (`on`), with its switch
   * named, and is one that layer takes (layers/params.ts, the words the guide validator uses too).
   */
  function paramsProblem(params: Readonly<Record<string, LayerParamValues>> | undefined, on: readonly string[]): ActionOutcome | null {
    if (!params) return null;
    const problems: string[] = [];
    for (const [id, values] of Object.entries(params)) {
      const layer = switchesById.get(id);
      if (!layer) problems.push(`no layer switch ${id}`);
      else if (!on.includes(id)) problems.push(`settings for ${id}, which this action does not turn on`);
      else problems.push(...paramProblems(id, layer.params, values));
    }
    if (problems.length === 0) return null;
    return { ok: false, code: problems[0].startsWith('no layer switch') ? 'unknown-layer' : 'bad-value', message: problems.join('; ') };
  }

  /** Hand checked settings to their layers; a value the layer itself refuses comes back as an outcome. */
  function giveParams(params: Readonly<Record<string, LayerParamValues>> | undefined): ActionOutcome | null {
    if (!params) return null;
    for (const [id, values] of Object.entries(params)) {
      const { target } = switchesById.get(id)!;
      // A switch with params is a lazy layer's: switchesWithLazyLayers gives them only there.
      if (!('lazy' in target)) return { ok: false, code: 'bad-value', message: `${id} takes no settings` };
      try {
        deps.lazyLayers.setParams(target.lazy, values);
      } catch (error) {
        return { ok: false, code: 'bad-value', message: error instanceof Error ? error.message : String(error) };
      }
    }
    return null;
  }

  /** The targets a folded view locates: its look's and its marks'. */
  function viewTargets(view: FoldedView): Target[] {
    return [view.look.target, ...view.marks.map((mark) => mark.target)];
  }

  /**
   * The switches `layers` leaves on, in the order they were turned on, or why it cannot be shown. Restore and preload
   * both work it out here, so what is loaded ahead is what restore turns on.
   */
  function switchesOn(layers: FoldedView['layers']): { readonly ok: true; readonly on: string[] } | Extract<ActionOutcome, { ok: false }> {
    // What the preset turns on, before what was flipped since: none for a listed scene.
    let presetOn: readonly string[] = [];
    if ('preset' in layers) {
      const preset = deps.presets.find((p) => p.id === layers.preset);
      if (!preset) return { ok: false, code: 'unknown-preset', message: `no preset ${layers.preset}` };
      presetOn = preset.on;
    }
    const named = 'only' in layers ? layers.only : [...layers.off, ...layers.on];
    const unknown = [...new Set(named.filter((id) => !switchesById.has(id)))];
    if (unknown.length > 0) return { ok: false, code: 'unknown-layer', message: `no layer switch ${unknown.join(', ')}` };
    const on = 'only' in layers ? turnOnInOrder([], layers.only) : turnOnInOrder(presetOn.filter((id) => !layers.off.includes(id)), layers.on);
    return { ok: true, on };
  }

  function borrow(): ViewBorrow {
    if (borrowed) throw new Error('the view is already borrowed');
    const fovDeg = deps.look.getState().fovDeg;
    const place = deps.standing.place();
    const clock = deps.clock.save();
    const panel = deps.layersPanel.borrow();
    borrowed = true;
    borrowEpoch++;
    let ended = false;
    let holding = false;
    return {
      hold(held) {
        if (ended) throw new Error('the view borrow has already ended');
        // A live clock is the present, which does not wait; a guide's clock that goes live meanwhile lets go itself.
        if (held === holding || (held && deps.clock.isLive())) return;
        holding = held;
        deps.clock.hold(held);
      },
      end: () => {
        if (ended) throw new Error('the view borrow has already ended');
        ended = true;
        borrowEpoch++;
        endEase({ ok: true });
        dropAllFades();
        awaiting = null;
        spyglassWait = null;
        takeMarksDown();
        // The width goes back at once and exactly, not through setFov: it is the user's own, neither eased nor held
        // to a pose's limit. The aim is left alone: the user is looking there now.
        const state = deps.look.getState();
        deps.look.setAim(state.yawRad, state.pitchRad, fovDeg);
        // Back where the user stood, at once: leaving the guide is the user's own move, made in their own time.
        deps.standing.set(place);
        // The clock as the user left it, run on through the guide: a live clock is live again, a pinned one has moved on.
        // Let go first: a hold outlasts a restore, and the user's clock was never held.
        if (holding) deps.clock.hold(false);
        deps.clock.restore(clock);
        panel.end();
        borrowed = false;
      },
    };
  }

  /**
   * The switches on after turning on each of `ids` in order, from `start`, as taps would: one of an exclusive group
   * turns the rest of the group off, so the last one turned on wins, as it does playing through.
   */
  function turnOnInOrder(start: readonly string[], ids: readonly string[]): string[] {
    let on = [...start];
    for (const id of ids) {
      const group = switchesById.get(id)!.exclusiveGroup;
      on = on.filter((other) => other !== id && (group === undefined || switchesById.get(other)!.exclusiveGroup !== group));
      on.push(id);
    }
    return on;
  }

  /** A look's wait on the user, its target found at `located`; `fovDeg` is applied on arrival. */
  function gazeOn(target: Target, located: Located, fovDeg: number | undefined): Gaze {
    return { target, name: targetName(target), direction: located.direction.clone(), fovDeg, withinMs: 0 };
  }

  function takeMarksDown(): void {
    for (const mark of marks.values()) mark.group.remove();
    marks.clear();
  }

  /** Put a mark with `text` on `target`, found along `direction`, in place of any mark already on it. */
  function putMark(target: Target, text: string, direction: THREE.Vector3): void {
    const key = targetKey(target);
    marks.get(key)?.group.remove();
    const position = markPosition(direction, new THREE.Vector3());
    // Not findable: a mark is a name put on a thing, not a second thing of that name for a label target to stumble on.
    const group = deps.addLabels({ rank: MARK_RANK, style: MARK_STYLE, frame: 'earth', findable: false, labels: [{ text, priority: 0, position }] });
    marks.set(key, { target, position, group });
  }

  /**
   * Where a mark is drawn: along its target's direction from the camera, as
   * far off as the sky, so both eyes in Cardboard see it the same way. The
   * 'earth' frame, because the label layer dims and rations names below the
   * horizon in the others, and a mark on something underground is usual.
   */
  function markPosition(direction: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(deps.camera.position).addScaledVector(direction, SKY_RADIUS_M);
  }

  function update(deltaMs: number): void {
    followMarks();
    stepEase(deltaMs);
    stepFades(deltaMs);
    followGaze(deltaMs);
    followSpyglass();
  }

  /** A fade's length out of range, or a switch named that cannot fade; null when there is no fade or it is sound. */
  function fadeProblem(fadeS: number | undefined, ids: readonly string[]): ActionOutcome | null {
    if (fadeS === undefined) return null;
    if (!(Number.isFinite(fadeS) && fadeS > 0 && fadeS <= MAX_FADE_S)) return { ok: false, code: 'bad-value', message: `fadeS ${fadeS} is outside 0 to ${MAX_FADE_S}` };
    const fixed = [...new Set(ids.filter((id) => !canFade(switchesById.get(id)!)))];
    return fixed.length > 0 ? { ok: false, code: 'bad-value', message: `${fixed.join(', ')} cannot fade` } : null;
  }

  /**
   * Fade switches out and in over `durationMs`, checked already. One going off stays on until it has faded out; one
   * coming on is switched on at nothing and fades up once its layer has loaded. A switch already as asked is left
   * alone, and one fading the other way turns back from where it has got to. Resolves when every fade has ended, or
   * with the first failure: a layer that failed to load is left on, at full strength, with its chip.
   */
  async function fadeLayers(
    on: readonly string[],
    off: readonly string[],
    params: Readonly<Record<string, LayerParamValues>> | undefined,
    durationMs: number
  ): Promise<ActionOutcome> {
    const started: Fade[] = [];
    for (const id of new Set(off)) {
      if (fades.has(id) || deps.layersPanel.isOn(id)) started.push(startFade(switchesById.get(id)!, 0, durationMs));
    }
    // Settings before the switch, as without a fade.
    const setting = giveParams(params);
    if (setting) return setting;
    const coming: Fade[] = [];
    for (const id of new Set(on)) {
      const running = fades.get(id);
      if (running) started.push(startFade(running.layer, 1, durationMs));
      else if (!deps.layersPanel.isOn(id)) {
        const fade = startFade(switchesById.get(id)!, 1, durationMs);
        // A shell is drawn already; a lazy layer may have to load first.
        fade.held = 'lazy' in fade.layer.target;
        started.push(fade);
        coming.push(fade);
        deps.layersPanel.setLayer(id, true);
      }
    }
    const loaded = await lazyLayersLoaded(coming.map((fade) => fade.layer));
    for (const fade of coming) {
      // Taken over or dropped while it loaded: whoever did that has the switch now.
      if (fades.get(fade.layer.id) !== fade) continue;
      if (loaded.ok) fade.held = false;
      else dropFade(fade.layer.id);
    }
    if (!loaded.ok) return loaded;
    const outcomes = await Promise.all(started.map((fade) => fade.done));
    return outcomes.find((outcome) => !outcome.ok) ?? { ok: true };
  }

  /** Start fading `layer` to `to`, from where a fade under way on it has got to, else from the other end. */
  function startFade(layer: LayerSwitch, to: 0 | 1, durationMs: number): Fade {
    const running = fades.get(layer.id);
    const from = running ? running.opacity : 1 - to;
    // The fade it takes over has done its part: its action goes on.
    running?.resolve({ ok: true });
    let resolve!: (outcome: ActionOutcome) => void;
    const done = new Promise<ActionOutcome>((r) => (resolve = r));
    const fade: Fade = { layer, from, to, durationMs, elapsedMs: 0, opacity: from, held: false, done, resolve };
    fades.set(layer.id, fade);
    writeOpacity(layer, from);
    return fade;
  }

  /** Stop a fade where it is, its switch left as it stands and drawn in full: what comes next decides from there. */
  function dropFade(id: string): void {
    const fade = fades.get(id);
    if (!fade) return;
    fades.delete(id);
    writeOpacity(fade.layer, 1);
    fade.resolve({ ok: true });
  }

  function dropAllFades(): void {
    for (const id of [...fades.keys()]) dropFade(id);
  }

  function writeOpacity(layer: LayerSwitch, opacity: number): void {
    const { target } = layer;
    if ('shell' in target) deps.shells.setShellOpacity(target.shell, opacity);
    else if ('lazy' in target) deps.lazyLayers.setOpacity(target.lazy, opacity);
  }

  // The frame's time, for stepFade: forEach with a function made once, so a frame of fading allocates nothing.
  let fadeDeltaMs = 0;
  function stepFades(deltaMs: number): void {
    if (fades.size === 0) return;
    fadeDeltaMs = deltaMs;
    fades.forEach(stepFade);
  }

  function stepFade(fade: Fade, id: string): void {
    if (fade.held) return;
    fade.elapsedMs += fadeDeltaMs;
    const t = Math.min(1, fade.elapsedMs / fade.durationMs);
    // Smoothstep: no jolt at either end, which a linear fade has where it starts and stops.
    fade.opacity = fade.from + (fade.to - fade.from) * t * t * (3 - 2 * t);
    writeOpacity(fade.layer, fade.opacity);
    if (t < 1) return;
    // Deleting the entry being visited is allowed in a Map's forEach.
    fades.delete(id);
    if (fade.to === 0) {
      deps.layersPanel.setLayer(id, false);
      // Off now, so full strength shows nothing; it is ready for a later switch-on at once.
      writeOpacity(fade.layer, 1);
    }
    fade.resolve({ ok: true });
  }

  /**
   * Find each mark's target again: the sky turns, the Sun, Moon and planets
   * move, and a horizon follows where the view stands. A target that does
   * not resolve for now leaves its mark where it was; it goes back on its
   * target once that resolves again.
   */
  function followMarks(): void {
    for (const mark of marks.values()) {
      const located = locate(mark.target);
      if (located.ok) markPosition(located.direction, mark.position);
    }
  }

  function stepEase(deltaMs: number): void {
    if (!easing) return;
    // The user wins: a drag, pinch, key or reset since the last frame stops the ease where they left it.
    // LookState is replaced, never changed in place, so a different object means something moved the view.
    // A compass that has just come on aims the view from now, so the ease stops for it too.
    // A look then waits for the user to turn to its target, as one in a pose does.
    if (deps.look.getState() !== easing.seen || aimMode() === 'pose') {
      const { gaze } = easing;
      if (gaze) awaiting = gaze;
      endEase(gaze ? { ok: true, awaitingGaze: true } : { ok: true });
      return;
    }
    easing.elapsedMs += deltaMs;
    setAim(easing.ease.at(easing.elapsedMs));
    if (easing.elapsedMs >= easing.ease.durationMs) endEase({ ok: true });
    else easing.seen = deps.look.getState();
  }

  /**
   * Whether the user has turned to the look that waits: its target has to
   * stay within ARRIVE_DEG of the view's centre for ARRIVE_MS. The camera is
   * as the last frame aimed it, since update comes first; a frame late is
   * nothing at this size and time. A target lost for now (no position)
   * leaves the wait as it stands.
   */
  function followGaze(deltaMs: number): void {
    if (!awaiting) return;
    const located = locate(awaiting.target);
    if (!located.ok) return;
    awaiting.direction.copy(located.direction);
    awaiting.withinMs = located.offCentreDeg <= ARRIVE_DEG ? awaiting.withinMs + deltaMs : 0;
    if (awaiting.withinMs < ARRIVE_MS) return;
    const { fovDeg, target, name } = awaiting;
    awaiting = null;
    // Cardboard cannot narrow its view: a narrow look opens the spyglass, by the spyglass's own rule, once the target
    // is within its capture (spec/guides.md §6.3). Framed at the look's width: framingDeg is extent × FRAME_MARGIN.
    if (fovDeg !== undefined && fovDeg < FOV_NEEDS_TARGET_BELOW_DEG && deps.spyglass?.inStereo()) {
      spyglassWait = {
        target,
        spyglass: {
          key: targetKey(target),
          name: name ?? 'target',
          extentDeg: fovDeg / FRAME_MARGIN,
          directionInto: (out) => {
            const found = locate(target);
            return found.ok ? out.copy(found.direction) : out;
          },
        },
      };
      return;
    }
    // Nothing to wait for or report: the value was checked when the look was performed, and setFov never refuses.
    if (fovDeg !== undefined) void setFov(fovDeg);
  }

  /** Open the spyglass on a narrow look's target once it is within CAPTURE_DEG; left Cardboard, forget it. */
  function followSpyglass(): void {
    if (!spyglassWait) return;
    if (!deps.spyglass?.inStereo()) {
      spyglassWait = null;
      return;
    }
    const located = locate(spyglassWait.target);
    if (!located.ok || located.offCentreDeg > CAPTURE_DEG) return;
    deps.spyglass.openOn(spyglassWait.spyglass);
    spyglassWait = null;
  }

  function awaitedGaze(): AwaitedGaze | null {
    if (!awaiting) return null;
    const { target, name, direction, withinMs } = awaiting;
    return { target, name, direction, arriving: Math.min(1, withinMs / ARRIVE_MS) };
  }

  function stopAwaitingGaze(): void {
    awaiting = null;
    spyglassWait = null;
  }

  const forward = new THREE.Vector3();

  /**
   * A time setting, checked against the clock before anything changes: the instant it starts from and whether it is
   * live time, or why it cannot be. The schema bounds the rate; this reads the instants, which a pattern cannot.
   */
  function checkTime(setting: TimeSetting): CheckedTime | { readonly ok: false; readonly code: 'bad-value'; readonly message: string } {
    const bad = (message: string) => ({ ok: false, code: 'bad-value', message }) as const;
    const rate = setting.rate ?? 1;
    if (!(Math.abs(rate) <= MAX_TIME_RATE)) return bad(`a clock rate of ${rate} is not between ${-MAX_TIME_RATE} and ${MAX_TIME_RATE}`);
    const now = setting.to === 'now';
    const fromMs = now ? deps.clock.liveMs() : Date.parse(setting.to);
    if (Number.isNaN(fromMs)) return bad(`${setting.to} is not an instant`);
    if (setting.until === undefined) return { ok: true, fromMs, fromNow: now, rate, untilMs: undefined, live: now && rate === 1 };
    const untilMs = Date.parse(setting.until);
    if (Number.isNaN(untilMs)) return bad(`${setting.until} is not an instant`);
    if (!(rate > 0 ? untilMs > fromMs : rate < 0 ? untilMs < fromMs : false)) {
      return bad(`the clock does not reach ${setting.until} from ${new Date(fromMs).toISOString()} at a rate of ${rate}`);
    }
    return { ok: true, fromMs, fromNow: now, rate, untilMs, live: false };
  }

  /**
   * With reduced motion there is no time-lapse: the clock goes straight to where it would stop, and stands there. A
   * guide's fast run always has a stop (the validator holds it to one); one without is held where it starts.
   */
  function withoutTimeLapse(time: CheckedTime): CheckedTime {
    if (Math.abs(time.rate) <= TIME_LAPSE_ABOVE_RATE || !deps.prefersReducedMotion()) return time;
    return { ok: true, fromMs: time.untilMs ?? time.fromMs, fromNow: false, rate: 0, untilMs: undefined, live: false };
  }

  function applyTime(time: CheckedTime): ActionOutcome {
    // Live time is the wall clock's, read when it is made: the check's instant is a moment old by now.
    if (time.fromNow) deps.clock.goLive();
    else deps.clock.set(time.fromMs);
    if (!time.live) deps.clock.setRate(time.rate, time.untilMs);
    return { ok: true };
  }

  /** `position`: where the view stands, unless the question is about where it is about to. */
  function locate(target: Target, position = deps.standing.position()): Located | TargetUnresolved {
    if (!position) return { ok: false, code: 'target-unresolved', message: 'no position yet' };
    const labels = deps.getLabels();
    // Not yet loaded is not unknown: say which, rather than "no label named".
    if (target.kind === 'label' && !labels) return { ok: false, code: 'target-unresolved', message: 'the label files have not loaded' };
    const found = targetDirection(target, position, deps.clock.now(), labels ?? NO_LABELS, deps.loadedLabels);
    if (!found.ok) return found;
    // The camera as it is now, so the answer holds in a pose as well as in a drag.
    const offCentreDeg = THREE.MathUtils.radToDeg(found.direction.angleTo(deps.camera.getWorldDirection(forward)));
    return { ok: true, direction: found.direction, ...horizonOf(found.direction, position), offCentreDeg };
  }

  return { perform, restore, preload, borrow, locate, awaitedGaze, stopAwaitingGaze, update };
}
