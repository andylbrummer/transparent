/**
 * Does the view's actions (actions.ts). It is the one implementation:
 * guides, voice commands and later the voice AI all come through here, so
 * they cannot drift apart. Its collaborators are passed in, so it is
 * tested without the renderer.
 */

import * as THREE from 'three';
import { MAX_FOV_DEG, MIN_FOV_DEG, type LookController, type LookState } from '../input/look';
import type { LayerManager } from '../layers/manager';
import { SKY_RADIUS_M } from '../layers/types';
import type { LabelGroup, LabelGroupSpec, LabelStyle } from '../render/labels';
import type { DeviceAttitude, SurfacePosition } from '../sensors';
import type { LayerSwitch, LayersPanel } from '../ui/layers-panel';
import type { LayerPreset } from '../ui/presets';
import type { ActionOutcome, AimMode, AwaitedGaze, FoldedView, Located, Target, TargetUnresolved, ViewAction, ViewControl } from './actions';
import { easeAim, type Aim, type AimEase } from './aim-ease';
import { horizonOf, targetDirection, targetKey, targetName, type LabelIndex } from './targets';

export interface ViewControlDeps {
  /** Every preset an action may name. */
  readonly presets: readonly LayerPreset[];
  /** Every switch an action may name. */
  readonly switches: readonly LayerSwitch[];
  /** Switches are flipped through the panel, so its rows, the save and the scene stay in step. */
  readonly layersPanel: Pick<LayersPanel, 'applyPreset' | 'setLayer' | 'showOnly' | 'borrow'>;
  /** The lazy layers: a switch-on is not done until its layer has loaded. */
  readonly lazyLayers: Pick<LayerManager, 'preload'>;
  /** The view's camera: its forward is the view's centre, in a pose as in a drag. */
  readonly camera: THREE.Camera;
  /** Where the view stands; null until there is a position. */
  getPosition(): SurfacePosition | null;
  /** The app clock. */
  now(): Date;
  /** The baked labels by name; null until the label files have loaded. */
  getLabels(): LabelIndex | null;
  /** The manual aim and field of view. */
  readonly look: Pick<LookController, 'getState' | 'setAim'>;
  /** The device's pose, or null when a drag aims the view: this decides the aim mode. */
  getAttitude(): DeviceAttitude | null;
  /** The user asked the system for less motion: no eases. */
  prefersReducedMotion(): boolean;
  /** Add a group of names to the view: a mark is one. */
  addLabels(spec: LabelGroupSpec): LabelGroup;
}

/** Narrower than this, a field of view needs a target: Cardboard can only magnify through the spyglass, which opens on something. */
export const FOV_NEEDS_TARGET_BELOW_DEG = 30;

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
  const marks = new Map<string, Mark>();
  let borrowed = false;

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
    if (deps.prefersReducedMotion() || ease.durationMs === 0) {
      setAim(ease.at(ease.durationMs));
      return Promise.resolve({ ok: true });
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
        deps.layersPanel.applyPreset(preset);
        const on = new Set(preset.on);
        return lazyLayersLoaded(deps.switches.filter((s) => on.has(s.id)));
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
        // Off before on, as applyPreset does: an exclusive group never has two on.
        for (const id of off) deps.layersPanel.setLayer(id, false);
        for (const id of on) deps.layersPanel.setLayer(id, true);
        return lazyLayersLoaded([...new Set(on)].map((id) => switchesById.get(id)!));
      }
      case 'look': {
        const badFov = fovOutOfRange(action.fovDeg);
        if (badFov) return badFov;
        const located = locate(action.target);
        if (!located.ok) return { ok: false, code: 'target-unresolved', message: located.message };
        const gaze = gazeOn(action.target, located, action.fovDeg);
        // The guide cannot turn someone holding the phone: the pointer shows them the way.
        if (aimMode() === 'pose') {
          awaiting = gaze;
          return { ok: true, awaitingGaze: true };
        }
        awaiting = null;
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
        const located = locate(action.target);
        if (!located.ok) return { ok: false, code: 'target-unresolved', message: located.message };
        putMark(action.target, action.text, located.direction);
        return { ok: true };
      }
    }
  }

  // Like perform, every change is made before the first await, so it is all in place by the time restore returns.
  async function restore(view: FoldedView): Promise<ActionOutcome> {
    const { look } = view;
    // Check everything before changing anything, so a mistake leaves the user where they were.
    const switches = switchesOn(view.layers);
    if (!switches.ok) return switches;
    const badFov = fovOutOfRange(look.fovDeg);
    if (badFov) return badFov;
    const located = locate(look.target);
    if (!located.ok) return { ok: false, code: 'target-unresolved', message: located.message };
    const placed: { readonly target: Target; readonly text: string; readonly direction: THREE.Vector3 }[] = [];
    for (const mark of view.marks) {
      if (mark.text === '') return { ok: false, code: 'bad-value', message: 'mark text is empty' };
      const found = locate(mark.target);
      if (!found.ok) return { ok: false, code: 'target-unresolved', message: found.message };
      placed.push({ target: mark.target, text: mark.text, direction: found.direction });
    }

    deps.layersPanel.showOnly(switches.on);
    endEase({ ok: true });
    const posed = aimMode() === 'pose';
    // The guide cannot turn someone holding the phone, at a cut any more than in an ease: the pointer shows the way.
    if (posed) awaiting = gazeOn(look.target, located, look.fovDeg);
    else {
      awaiting = null;
      setAim({ azDeg: located.azDeg, altDeg: located.altDeg, fovDeg: look.fovDeg });
    }
    takeMarksDown();
    for (const mark of placed) putMark(mark.target, mark.text, mark.direction);

    const loaded = await lazyLayersLoaded(switches.on.map((id) => switchesById.get(id)!));
    if (!loaded.ok) return loaded;
    return posed ? { ok: true, awaitingGaze: true } : { ok: true };
  }

  async function preload(view: FoldedView): Promise<ActionOutcome> {
    // The switches alone: the look and the marks load nothing, and may not resolve until the view gets there.
    const switches = switchesOn(view.layers);
    if (!switches.ok) return switches;
    return lazyLayersLoaded(switches.on.map((id) => switchesById.get(id)!));
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

  function borrow(): { end(): void } {
    if (borrowed) throw new Error('the view is already borrowed');
    const fovDeg = deps.look.getState().fovDeg;
    const panel = deps.layersPanel.borrow();
    borrowed = true;
    let ended = false;
    return {
      end: () => {
        if (ended) throw new Error('the view borrow has already ended');
        ended = true;
        endEase({ ok: true });
        awaiting = null;
        takeMarksDown();
        // The width goes back at once and exactly, not through setFov: it is the user's own, neither eased nor held
        // to a pose's limit. The aim is left alone: the user is looking there now.
        const state = deps.look.getState();
        deps.look.setAim(state.yawRad, state.pitchRad, fovDeg);
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
    const group = deps.addLabels({ rank: MARK_RANK, style: MARK_STYLE, frame: 'earth', labels: [{ text, priority: 0, position }] });
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
    followGaze(deltaMs);
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
    const { fovDeg } = awaiting;
    awaiting = null;
    // Nothing to wait for or report: the value was checked when the look was performed, and setFov never refuses.
    if (fovDeg !== undefined) void setFov(fovDeg);
  }

  function awaitedGaze(): AwaitedGaze | null {
    if (!awaiting) return null;
    const { target, name, direction, withinMs } = awaiting;
    return { target, name, direction, arriving: Math.min(1, withinMs / ARRIVE_MS) };
  }

  function stopAwaitingGaze(): void {
    awaiting = null;
  }

  const forward = new THREE.Vector3();

  function locate(target: Target): Located | TargetUnresolved {
    const position = deps.getPosition();
    if (!position) return { ok: false, code: 'target-unresolved', message: 'no position yet' };
    const labels = deps.getLabels();
    // Not yet loaded is not unknown: say which, rather than "no label named".
    if (target.kind === 'label' && !labels) return { ok: false, code: 'target-unresolved', message: 'the label files have not loaded' };
    const found = targetDirection(target, position, deps.now(), labels ?? NO_LABELS);
    if (!found.ok) return found;
    // The camera as it is now, so the answer holds in a pose as well as in a drag.
    const offCentreDeg = THREE.MathUtils.radToDeg(found.direction.angleTo(deps.camera.getWorldDirection(forward)));
    return { ok: true, direction: found.direction, ...horizonOf(found.direction, position), offCentreDeg };
  }

  return { perform, restore, preload, borrow, locate, awaitedGaze, stopAwaitingGaze, update };
}
