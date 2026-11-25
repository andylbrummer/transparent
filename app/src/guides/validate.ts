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
import type { Target } from '../view/actions';
import { targetDirection, type LabelIndex } from '../view/targets';
import type { Guide } from './format';

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

  const chapterIds = new Set<string>();
  guide.chapters.forEach((chapter, c) => {
    const chapterPath = `/chapters/${c}`;
    if (chapterIds.has(chapter.id)) problem(`${chapterPath}/id`, `chapter id ${chapter.id} is used twice`);
    chapterIds.add(chapter.id);

    const { scene } = chapter;
    if ('preset' in scene) checkPreset(`${chapterPath}/scene/preset`, scene.preset);
    else checkOn(`${chapterPath}/scene/layers`, scene.layers);
    checkTarget(`${chapterPath}/scene/look/target`, scene.look.target);

    const stepIds = new Set<string>();
    chapter.steps.forEach((step, s) => {
      const stepPath = `${chapterPath}/steps/${s}`;
      if (stepIds.has(step.id)) problem(`${stepPath}/id`, `step id ${step.id} is used twice in chapter ${chapter.id}`);
      stepIds.add(step.id);

      step.cues.forEach((cue, k) => {
        const cuePath = `${stepPath}/cues/${k}`;
        const previous = step.cues[k - 1];
        if (previous !== undefined && cue.at < previous.at) problem(`${cuePath}/at`, `cue at ${cue.at} comes after one at ${previous.at}`);
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
          case 'fov':
            break;
        }
      });

      if (step.advance === 'gaze' && !step.cues.some((cue) => cue.do === 'look')) {
        problem(`${stepPath}/advance`, 'advance is gaze but the step has no look cue to wait for');
      }
    });
  });
  return problems;
}
