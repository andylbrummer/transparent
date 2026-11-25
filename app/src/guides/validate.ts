/**
 * What the guide schema cannot say: whether an id exists in the app, whether
 * a name is used once, whether the cues keep time. These read the app's own
 * switches, presets and labels, and a label is resolved by the same code the
 * view control uses, so the validator and the app cannot disagree about a
 * name. `npm test` runs them over every guide; the app does not.
 */

import { paramProblems } from '../layers/params';
import type { LayerParamValues } from '../layers/types';
import type { SurfacePosition } from '../sensors';
import { canFade, type LayerSwitch } from '../ui/layers-panel';
import type { LayerPreset } from '../ui/presets';
import type { FoldedView, Target, TimeSetting } from '../view/actions';
import { foldAction } from '../view/fold';
import { TIME_LAPSE_ABOVE_RATE } from '../view/view-control';
import { targetDirection, type LabelIndex } from '../view/targets';
import { sceneView, type Guide, type Hotspot } from './format';
import { MEDIA_ORIGIN } from './media-origin';

/** Something wrong with a guide: where, as a JSON pointer into guide.json, and why. */
export interface GuideProblem {
  readonly path: string;
  readonly reason: string;
}

/** What the app knows that a guide refers to. */
export interface GuideWorld {
  /** Every layer switch: switchesWithLazyLayers(LAYER_DEFINITIONS). */
  readonly switches: readonly LayerSwitch[];
  /** Every preset a guide may name: the default one and LAYER_PRESETS. */
  readonly presets: readonly LayerPreset[];
  /** The baked labels by name: indexLabels of geo/labels.json, geology.json and quakes.json. */
  readonly labels: LabelIndex;
}

// A label resolves to the same place from anywhere at any time; the direction is not used.
const ANYWHERE: SurfacePosition = { lat: 0, lon: 0 };
const ANY_TIME = new Date(0);

/**
 * Everything wrong with a guide that its schema cannot say. The guide has
 * passed the schema already. Every problem is reported, not only the first.
 */
export function guideProblems(guide: Guide, world: GuideWorld): GuideProblem[] {
  const problems: GuideProblem[] = [];
  const problem = (path: string, reason: string): void => {
    problems.push({ path, reason });
  };
  const presetIds = new Set(world.presets.map((preset) => preset.id));
  const switches = new Map(world.switches.map((layer) => [layer.id, layer]));

  const checkPreset = (path: string, id: string): void => {
    // The words of view-control.ts, which refuses the same preset at run time.
    if (!presetIds.has(id)) problem(path, `no preset ${id}`);
  };

  /** Switches turned on together: each must exist, and an exclusive group may have only one of them. */
  const checkOn = (path: string, ids: readonly string[], off: readonly string[] = []): void => {
    const groupHolder = new Map<string, string>();
    ids.forEach((id, i) => {
      const layer = switches.get(id);
      if (!layer) problem(`${path}/${i}`, `no layer switch ${id}`);
      else if (layer.exclusiveGroup !== undefined) {
        const other = groupHolder.get(layer.exclusiveGroup);
        if (other === undefined) groupHolder.set(layer.exclusiveGroup, id);
        else problem(`${path}/${i}`, `${id} and ${other} are both on, and only one of ${layer.exclusiveGroup} can be`);
      }
      if (off.includes(id)) problem(`${path}/${i}`, `${id} is turned both on and off`);
    });
  };

  const checkOff = (path: string, ids: readonly string[]): void => {
    ids.forEach((id, i) => {
      if (!switches.has(id)) problem(`${path}/${i}`, `no layer switch ${id}`);
    });
  };

  /** A cue's settings: each for a switch the cue turns on, and one that switch's layer takes (layers/params.ts, as at run time). */
  const checkParams = (path: string, params: Readonly<Record<string, LayerParamValues>> | undefined, on: readonly string[]): void => {
    for (const [id, values] of Object.entries(params ?? {})) {
      const layer = switches.get(id);
      // JSON pointer escaping: a switch id is kebab-case, so it has no "~" or "/" to escape.
      const at = `${path}/${id}`;
      if (!layer) problem(at, `no layer switch ${id}`);
      else if (!on.includes(id)) problem(at, `settings for ${id}, which this cue does not turn on`);
      else for (const reason of paramProblems(id, layer.params, values)) problem(at, reason);
    }
  };

  /** Switches a cue fades: each must be one that can (ui/layers-panel.ts canFade, as at run time). Unknown ones are reported already. */
  const checkFade = (path: string, ids: readonly string[]): void => {
    ids.forEach((id, i) => {
      const layer = switches.get(id);
      if (layer && !canFade(layer)) problem(`${path}/${i}`, `${id} cannot fade`);
    });
  };

  const checkTarget = (path: string, target: Target): void => {
    // Other kinds are bounded by the schema; only a label's name needs the app to say what it means.
    if (target.kind !== 'label') return;
    const resolved = targetDirection(target, ANYWHERE, ANY_TIME, world.labels);
    if (!resolved.ok) problem(path, resolved.message);
  };

  const checkTime = (path: string, time: TimeSetting): void => {
    const rate = time.rate ?? 1;
    // A time-lapse needs a stop: under reduced motion it is a jump there instead (spec/guides.md §7.3).
    if (Math.abs(rate) > TIME_LAPSE_ABOVE_RATE && time.until === undefined) {
      problem(path, `a rate of ${rate} needs an until: with reduced motion the clock jumps there instead`);
    }
    if (time.until === undefined) return;
    if (rate === 0) problem(`${path}/until`, 'a clock standing still never reaches its until');
    // From 'now' the view control checks it when it plays: the present moves.
    else if (time.to !== 'now') {
      const ahead = rate > 0 ? Date.parse(time.until) > Date.parse(time.to) : Date.parse(time.until) < Date.parse(time.to);
      if (!ahead) problem(`${path}/until`, `the clock does not reach ${time.until} from ${time.to} at a rate of ${rate}`);
    }
  };

  const presetsById = new Map(world.presets.map((preset) => [preset.id, preset]));
  /** The switches a folded view has on. An unknown preset is reported where it is named, so it counts as none here. */
  const switchesOn = (layers: FoldedView['layers']): readonly string[] => {
    if ('only' in layers) return layers.only;
    return [...(presetsById.get(layers.preset)?.on ?? []).filter((id) => !layers.off.includes(id)), ...layers.on];
  };
  /**
   * The live switches on while the clock is away from the present, which show today's data over another day's sky
   * (spec/guides.md §12, gap 9); none while it is live. Real time from another instant is away too.
   */
  const liveAway = (view: FoldedView): string[] => {
    if (view.time.to === 'now' && (view.time.rate ?? 1) === 1) return [];
    return switchesOn(view.layers).filter((id) => switches.get(id)?.live === true);
  };
  /** Report where a live switch and a time away first meet, not again at every cue after while they stay together. */
  const checkLiveAway = (path: string, view: FoldedView, before: readonly string[]): string[] => {
    const now = liveAway(view);
    const fresh = now.filter((id) => !before.includes(id));
    if (fresh.length > 0) {
      const when = view.time.to === 'now' ? `now at ${view.time.rate}×` : view.time.to;
      problem(path, `${fresh.join(', ')} ${fresh.length === 1 ? 'shows' : 'show'} today's data, and the clock is at ${when}`);
    }
    return now;
  };

  const hotspots = hotspotChecker(world, `guides/${guide.id}/`, problem);
  const chapterIds = new Set<string>();
  guide.chapters.forEach((chapter, c) => {
    const chapterPath = `/chapters/${c}`;
    if (chapterIds.has(chapter.id)) problem(`${chapterPath}/id`, `chapter id ${chapter.id} is used twice`);
    chapterIds.add(chapter.id);

    const { scene } = chapter;
    if ('preset' in scene) checkPreset(`${chapterPath}/scene/preset`, scene.preset);
    else checkOn(`${chapterPath}/scene/layers`, scene.layers);
    checkTarget(`${chapterPath}/scene/look/target`, scene.look.target);
    if (scene.time) checkTime(`${chapterPath}/scene/time`, scene.time);

    let view = sceneView(scene);
    let away = checkLiveAway(`${chapterPath}/scene`, view, []);

    const stepIds = new Set<string>();
    chapter.steps.forEach((step, s) => {
      const stepPath = `${chapterPath}/steps/${s}`;
      if (stepIds.has(step.id)) problem(`${stepPath}/id`, `step id ${step.id} is used twice in chapter ${chapter.id}`);
      stepIds.add(step.id);

      step.cues.forEach((cue, k) => {
        const cuePath = `${stepPath}/cues/${k}`;
        const previous = step.cues[k - 1];
        if (previous !== undefined && cue.at < previous.at) problem(`${cuePath}/at`, `cue at ${cue.at} comes after one at ${previous.at}`);
        view = foldAction(view, cue);
        away = checkLiveAway(cuePath, view, away);
        switch (cue.do) {
          case 'preset':
            checkPreset(`${cuePath}/id`, cue.id);
            break;
          case 'layers':
            checkOn(`${cuePath}/on`, cue.on ?? [], cue.off);
            checkOff(`${cuePath}/off`, cue.off ?? []);
            checkParams(`${cuePath}/params`, cue.params, cue.on ?? []);
            if (cue.fadeS !== undefined) {
              checkFade(`${cuePath}/on`, cue.on ?? []);
              checkFade(`${cuePath}/off`, cue.off ?? []);
            }
            break;
          case 'look':
          case 'mark':
            checkTarget(`${cuePath}/target`, cue.target);
            break;
          case 'time':
            checkTime(cuePath, cue);
            break;
          case 'fov':
          case 'stand':
            break;
          case 'clip':
            // The hotspots shown when the cue fires: this step's and the chapter's earlier steps' (guide-session.ts).
            if (cue.hotspot !== null && !chapter.steps.slice(0, s + 1).some((shown) => shown.hotspots?.some((h) => h.id === cue.hotspot))) {
              problem(`${cuePath}/hotspot`, `no hotspot ${cue.hotspot} in this step or an earlier one of chapter ${chapter.id}`);
            }
            break;
        }
      });

      if (step.advance === 'gaze' && !step.cues.some((cue) => cue.do === 'look')) {
        problem(`${stepPath}/advance`, 'advance is gaze but the step has no look cue to wait for');
      }
      step.hotspots?.forEach((hotspot, h) => hotspots.check(`${stepPath}/hotspots/${h}`, hotspot));
    });
  });
  return problems;
}

/** Everything wrong with a file of hotspots that its schema cannot say: public/media/hotspots.json. */
export function hotspotsProblems(list: readonly Hotspot[], world: GuideWorld): GuideProblem[] {
  const problems: GuideProblem[] = [];
  const hotspots = hotspotChecker(world, 'media/', (path, reason) => problems.push({ path, reason }));
  list.forEach((hotspot, h) => hotspots.check(`/hotspots/${h}`, hotspot));
  return problems;
}

/**
 * A check of each hotspot of one file, in order: its id is the file's only one, since a clip cue names it; its
 * switch exists; its anchor's label is one name; a video is in the file's folder on the media host, `videoFolder`,
 * named by its declared hash, and at most 1080p either way up.
 */
function hotspotChecker(
  world: GuideWorld,
  videoFolder: string,
  problem: (path: string, reason: string) => void
): { check(path: string, hotspot: Hotspot): void } {
  const ids = new Set<string>();
  const switches = new Set(world.switches.map((layer) => layer.id));
  return {
    check(path, hotspot) {
      if (ids.has(hotspot.id)) problem(`${path}/id`, `hotspot id ${hotspot.id} is used twice`);
      ids.add(hotspot.id);
      if (hotspot.layer !== undefined && !switches.has(hotspot.layer)) problem(`${path}/layer`, `no layer switch ${hotspot.layer}`);
      if (hotspot.anchor.kind === 'label') {
        const resolved = targetDirection(hotspot.anchor, ANYWHERE, ANY_TIME, world.labels);
        if (!resolved.ok) problem(`${path}/anchor`, resolved.message);
      }
      const { clip } = hotspot;
      if (clip.kind !== 'video') return;
      const folder = `${MEDIA_ORIGIN}/${videoFolder}`;
      if (!clip.src.startsWith(folder)) problem(`${path}/clip/src`, `${clip.src} is not in ${folder}`);
      // The schema has the name end in .<8 hex>.mp4.
      const named = clip.src.slice(-12, -4);
      if (named !== clip.video.sha256.slice(0, 8)) problem(`${path}/clip/src`, `${clip.src} is named for a hash that starts ${named}, not ${clip.video.sha256.slice(0, 8)}`);
      if (Math.min(clip.video.width, clip.video.height) > 1080) problem(`${path}/clip/video`, `${clip.video.width} × ${clip.video.height} is over 1080p`);
    },
  };
}
