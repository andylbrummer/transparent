/**
 * Names through the see-through Earth, the way a sky map names stars:
 * places on the far-side surface, and geology - plates, hotspots,
 * subduction zones, volcanoes, and deep structures and great earthquakes
 * at their depth.
 *
 * Labels are screen-aligned DOM text, so they stay readable however
 * foreshortened the land beneath them is. Each frame they are placed in
 * rank order - by kind (LABEL_KIND_ORDER), then by each source's own
 * priority - and a label overlapping one already placed is hidden, so the
 * broader names win wherever the view is crowded.
 *
 * Lazy layers add their own names later with addGroup: a group carries its
 * rank among the kinds, its style, and whether its points are Earth-fixed
 * or directions on the sky.
 *
 * In stereo (setStereo) each label has a twin in a right-eye container:
 * the left eye declutters, and the right shows the same names at its own
 * projection of the same points, so each name fuses at its feature's depth.
 */

import * as THREE from 'three';
import { earthPoint } from './earth-point';

export type LabelKind =
  | 'country'
  | 'state'
  | 'city'
  | 'plate'
  | 'deep'
  | 'hotspot'
  | 'quake'
  | 'subduction'
  | 'volcano';

/**
 * Declutter rank by kind: earlier kinds win overlaps. Geology outranks
 * states and cities - this is a map of the Earth's structure - but
 * countries stay first so the view keeps its bearings.
 */
export const LABEL_KIND_ORDER: readonly LabelKind[] = [
  'country',
  'plate',
  'deep',
  'hotspot',
  'quake',
  'subduction',
  'state',
  'volcano',
  'city',
];

export interface PlaceLabel {
  readonly kind: LabelKind;
  readonly name: string;
  readonly lon: number;
  readonly lat: number;
  /** Rank within its kind, from the pipeline: lower is more important. */
  readonly priority: number;
  /** Below the surface, in km; absent for surface features. */
  readonly depthKm?: number;
}

/** The labels of app/public/geo/labels.json, geology.json and quakes.json. */
export interface LabelData {
  readonly labels: readonly PlaceLabel[];
}

/** Font size per kind, in CSS pixels; width is estimated from it. */
const FONT_PX: Readonly<Record<LabelKind, number>> = {
  country: 12,
  state: 11,
  city: 11,
  plate: 12,
  deep: 11,
  hotspot: 11,
  quake: 10,
  subduction: 10,
  volcano: 10,
};
/** Kinds drawn uppercase and letter-spaced, so wider glyphs. */
const WIDE_KINDS: ReadonlySet<LabelKind> = new Set(['country', 'plate']);
/** Average glyph advance as a fraction of font size, for the overlap boxes. */
const GLYPH_WIDTH_EM = 0.62;
/** Uppercase, letter-spaced names (WIDE_KINDS): wider glyphs. */
const COUNTRY_GLYPH_WIDTH_EM = 0.78;
const LABEL_PADDING_PX = 4;
/** Bounds per-frame DOM writes; past this the view is unreadable anyway. */
export const MAX_VISIBLE_LABELS = 48;
/**
 * Sky names have their own allowance: looking down, the ground alone fills
 * MAX_VISIBLE_LABELS, and the Sun or Moon behind the planet would go unnamed.
 */
export const MAX_VISIBLE_SKY_LABELS = 32;
/**
 * Of those, how many may sit below the horizon, seen through the planet,
 * in a wide view: looking down is looking at the Earth, and the sky behind
 * it gets a handful of names - Sun, Moon, planets first - not a chart.
 */
export const MAX_SKY_LABELS_THROUGH_EARTH = 6;
/** Narrower than this, the view is a study of one patch: the sky below the horizon is named in full. */
export const SKY_ZOOMED_FOV_DEG = 30;
/** Opacity of a sky name below the horizon, echoing the dimmed sky it names. */
const THROUGH_EARTH_OPACITY = 0.62;

/** How a group of labels added by a lazy layer is drawn. */
export interface LabelStyle {
  /** CSS pixels. */
  readonly fontPx: number;
  /** CSS colour. */
  readonly color: string;
  readonly italic?: boolean;
  readonly bold?: boolean;
  /** Uppercase and letter-spaced, like country names. */
  readonly wide?: boolean;
  /** Shift the text down from its point, CSS px, so it sits under a marker instead of on it. */
  readonly offsetYPx?: number;
  /** Draw a ring on the point and hang the text under it: a guide's mark. */
  readonly ring?: boolean;
}

export interface GroupLabel {
  /** The text shown, markers included. */
  readonly text: string;
  /** Rank within the group: lower is more important. */
  readonly priority: number;
  /**
   * 'earth' and 'space': ECEF metres. 'sky': a unit direction in ICRS, at
   * infinity. Read every frame, so a layer may move it (a satellite, a planet).
   */
  readonly position: THREE.Vector3;
  /** Its size on the sky, degrees, for one with a size (a galaxy, a nebula): what the spyglass frames. */
  readonly extentDeg?: number;
}

/** A name on the sky near the view's centre: what the spyglass can open on. */
export interface SkyTarget {
  /** The same object every frame for the same name. */
  readonly key: unknown;
  readonly name: string;
  readonly extentDeg: number | null;
  /** Where it is now, a world unit vector, written into `out`. */
  directionInto(out: THREE.Vector3): THREE.Vector3;
}

export interface LabelGroupSpec {
  /**
   * Declutter rank among the kinds: the index a kind would have in
   * LABEL_KIND_ORDER, fractions allowed (0.5 sits between country and plate).
   */
  readonly rank: number;
  readonly style: LabelStyle;
  /**
   * 'earth': on or in the planet. 'sky': on the celestial sphere. 'space':
   * a place above the ground - a satellite, the magnetopause - given like
   * 'earth' in ECEF metres, so each eye of a stereo pair sees it where it
   * is, but counted and thinned with the sky's names, which is what it is
   * to someone looking up.
   */
  readonly frame: LabelFrame;
  /**
   * What happens below the horizon, where the name is seen through the
   * planet. 'few' (default): it competes for MAX_SKY_LABELS_THROUGH_EARTH.
   * 'zoomed': it waits until the view is narrower than SKY_ZOOMED_FOV_DEG -
   * for a layer that is on from the start and would otherwise put star
   * names over the default view of the Earth. Ignored for 'earth'.
   */
  readonly belowHorizon?: 'few' | 'zoomed';
  /**
   * Whether find() may answer with these labels (default true). False for a
   * guide's own marks: a mark put on M31 is not a second M31 to choose from.
   */
  readonly findable?: boolean;
  readonly labels: readonly GroupLabel[];
}

/**
 * What find() made of a name among the groups' labels. One place, given
 * as the group gave it: the layer may go on moving it.
 */
export type FoundLabel =
  | { readonly found: 'one'; readonly frame: LabelFrame; readonly position: THREE.Vector3 }
  | { readonly found: 'none' }
  /** More than one place answers to it: never guessed between. */
  | { readonly found: 'many'; readonly count: number };

export type LabelFrame = 'earth' | 'sky' | 'space';

/** A group added with LabelLayer.addGroup. */
export interface LabelGroup {
  setVisible(visible: boolean): void;
  remove(): void;
}

interface GroupState {
  readonly frame: LabelFrame;
  readonly zoomedOnlyBelowHorizon: boolean;
  readonly findable: boolean;
  visible: boolean;
}

interface PlacedLabel {
  /** Absent for a group's labels. */
  readonly label: PlaceLabel | null;
  readonly group: GroupState | null;
  readonly name: string;
  /** What find() matches: a group label's text with any leading marker ("▲ ", "• ") taken off. Worked out once, not per lookup. */
  readonly findName: string;
  readonly rank: number;
  readonly priority: number;
  readonly element: HTMLElement;
  readonly position: THREE.Vector3;
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** Added to the projected y: the text's offset from its point. */
  readonly offsetY: number;
  /** A group label's size on the sky, degrees; null without one. */
  readonly extentDeg: number | null;
  /** This label as a spyglass target, made the first time it is one. */
  target: SkyTarget | null;
  /** The offset in use this frame: offsetY, or its opposite where that side was taken. */
  shownOffsetY: number;
  /** Where the element was last put, in tenths of a CSS pixel; NaN before the first time. */
  shownX: number;
  shownY: number;
  twinX: number;
  twinY: number;
  visible: boolean;
  /** Drawn faint: a sky name below the horizon. */
  dimmed: boolean;
  /** The right eye's copy, created on the first setStereo(true). */
  twin: HTMLElement | null;
  twinVisible: boolean;
}

/** The text a label shows: its name, with a marker or depth for its kind. */
export function labelText(label: PlaceLabel): string {
  switch (label.kind) {
    case 'city':
      return `• ${label.name}`;
    case 'volcano':
      return `▲ ${label.name}`;
    case 'hotspot':
      return `◉ ${label.name}`;
    case 'deep':
    case 'quake':
      return label.depthKm === undefined ? label.name : `${label.name} · ${label.depthKm} km`;
    default:
      return label.name;
  }
}

/** Estimated on-screen box, so placement never forces a layout read. */
export function estimateLabelSize(label: PlaceLabel): { width: number; height: number } {
  const font = FONT_PX[label.kind];
  const em = WIDE_KINDS.has(label.kind) ? COUNTRY_GLYPH_WIDTH_EM : GLYPH_WIDTH_EM;
  return { width: labelText(label).length * font * em + LABEL_PADDING_PX, height: font * 1.3 + LABEL_PADDING_PX };
}

/** Stable rank order: by kind, then the source's priority, then source order. */
export function rankLabels(labels: readonly PlaceLabel[]): PlaceLabel[] {
  const rank = (kind: LabelKind): number => LABEL_KIND_ORDER.indexOf(kind);
  return [...labels].sort((a, b) => rank(a.kind) - rank(b.kind) || a.priority - b.priority);
}

/** A marker before a group label's name: a symbol and a space, as "▲ Etna" or "• Lima". */
const LEADING_MARKER = /^[^\p{L}\p{N}]+\s+/u;
const SPACE = 0x20;
const NOT_FOUND: FoundLabel = { found: 'none' };
/** Two answers to a name nearer than this are one thing: a hundredth of a degree on the sky, a kilometre on the Earth. */
const SAME_SKY_COS = Math.cos(THREE.MathUtils.degToRad(0.01));
const SAME_PLACE_M = 1000;

/** Whether two group labels stand at one place: the same thing named twice, by two catalogues or two layers. */
function samePlace(a: PlacedLabel, b: PlacedLabel): boolean {
  const frame = a.group!.frame;
  if (frame !== b.group!.frame) return false;
  if (frame === 'sky') return a.position.dot(b.position) / (a.position.length() * b.position.length()) >= SAME_SKY_COS;
  return a.position.distanceTo(b.position) <= SAME_PLACE_M;
}

/** Sky labels are projected from this far out along their direction: effectively infinity. */
const SKY_LABEL_DISTANCE_M = 1e12;

export class LabelLayer {
  private readonly container: HTMLElement;
  private placed: PlacedLabel[];
  private readonly skyRotation = new THREE.Matrix4();
  private readonly view = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly hole = new THREE.Vector3();
  private readonly toPoint = new THREE.Vector3();
  /** Cosine of the spyglass hole's radius; 2 (no direction that close) with none. */
  private holeCos = 2;
  private skyThroughEarth = true;
  private readonly boxes: number[] = [];
  private readonly hiddenKinds = new Set<LabelKind>();
  private rightEyeContainer: HTMLElement | null = null;
  private stereo = false;
  private shown = true;

  /** Takes label sources up front; more can follow with addLabels. All rank together by LABEL_KIND_ORDER. */
  constructor(parent: HTMLElement, sources: readonly LabelData[]) {
    this.container = document.createElement('div');
    this.container.className = 'place-labels';
    this.placed = [];
    this.addLabels(sources);
    parent.appendChild(this.container);
  }

  /** Add kind-styled labels (the baked places and geology) after construction. */
  addLabels(sources: readonly LabelData[]): void {
    const added = rankLabels(sources.flatMap((source) => source.labels)).map((label): PlacedLabel => {
      const element = document.createElement('div');
      element.className = `place-label place-label--${label.kind}`;
      element.textContent = labelText(label);
      element.style.display = 'none';
      this.container.appendChild(element);
      let twin: HTMLElement | null = null;
      if (this.rightEyeContainer) {
        twin = element.cloneNode(true) as HTMLElement;
        this.rightEyeContainer.appendChild(twin);
      }
      const position = earthPoint(label.lat, label.lon, label.depthKm);
      const size = estimateLabelSize(label);
      return {
        label,
        group: null,
        name: label.name,
        findName: label.name,
        rank: LABEL_KIND_ORDER.indexOf(label.kind),
        priority: label.priority,
        element,
        position,
        halfWidth: size.width / 2,
        halfHeight: size.height / 2,
        offsetY: 0,
        extentDeg: null,
        target: null,
        shownOffsetY: 0,
        shownX: NaN,
        shownY: NaN,
        twinX: NaN,
        twinY: NaN,
        visible: false,
        dimmed: false,
        twin,
        twinVisible: false,
      };
    });
    this.placed = [...this.placed, ...added].sort((x, y) => x.rank - y.rank || x.priority - y.priority);
  }

  setVisible(visible: boolean): void {
    this.shown = visible;
    this.container.style.display = visible ? '' : 'none';
    if (this.rightEyeContainer) this.rightEyeContainer.style.display = visible && this.stereo ? '' : 'none';
  }

  /**
   * Split into a left-eye and a right-eye half. While on, `update` takes
   * the eye viewport's size and the right-eye camera.
   */
  setStereo(on: boolean): void {
    this.stereo = on;
    if (on && !this.rightEyeContainer) {
      const right = document.createElement('div');
      right.className = 'place-labels place-labels--right-eye';
      for (const placed of this.placed) {
        placed.twin = placed.element.cloneNode(true) as HTMLElement;
        placed.twin.style.display = 'none';
        right.appendChild(placed.twin);
      }
      this.container.after(right);
      this.rightEyeContainer = right;
    }
    this.container.classList.toggle('place-labels--left-eye', on);
    this.setVisible(this.shown);
  }

  /** Show or hide every label of these kinds; takes effect at the next update. */
  setKindsVisible(kinds: readonly LabelKind[], visible: boolean): void {
    for (const kind of kinds) {
      if (visible) this.hiddenKinds.delete(kind);
      else this.hiddenKinds.add(kind);
    }
  }

  /**
   * Whether the sky below the horizon is being drawn through the planet.
   * When it is not, nothing is there to name: the sky's labels stop at the
   * horizon with it. Things in 'space' are drawn either way.
   */
  setSkyThroughEarth(shown: boolean): void {
    this.skyThroughEarth = shown;
  }

  /**
   * Add a lazy layer's labels. They join the same declutter pass at the
   * group's rank, and stay until the returned handle removes them.
   */
  addGroup(spec: LabelGroupSpec): LabelGroup {
    const state: GroupState = {
      frame: spec.frame,
      zoomedOnlyBelowHorizon: spec.belowHorizon === 'zoomed',
      findable: spec.findable ?? true,
      visible: true,
    };
    const style = spec.style;
    const em = style.wide ? COUNTRY_GLYPH_WIDTH_EM : GLYPH_WIDTH_EM;
    const added: PlacedLabel[] = spec.labels.map((label) => {
      const element = document.createElement('div');
      element.className = style.ring ? 'place-label place-label--ring' : 'place-label';
      element.textContent = label.text;
      element.style.display = 'none';
      element.style.fontSize = `${style.fontPx}px`;
      element.style.color = style.color;
      if (style.italic) element.style.fontStyle = 'italic';
      if (style.bold) element.style.fontWeight = '600';
      if (style.wide) {
        element.style.letterSpacing = '0.12em';
        element.style.textTransform = 'uppercase';
      }
      this.container.appendChild(element);
      let twin: HTMLElement | null = null;
      if (this.rightEyeContainer) {
        twin = element.cloneNode(true) as HTMLElement;
        this.rightEyeContainer.appendChild(twin);
      }
      return {
        label: null,
        group: state,
        name: label.text,
        findName: label.text.replace(LEADING_MARKER, ''),
        rank: spec.rank,
        priority: label.priority,
        element,
        position: label.position,
        halfWidth: (label.text.length * style.fontPx * em + LABEL_PADDING_PX) / 2,
        // A ring and the text under it lie within 2.6em of the point, above and
        // below: no other name may sit on the ring or on its text.
        halfHeight: style.ring ? style.fontPx * 2.6 + LABEL_PADDING_PX / 2 : (style.fontPx * 1.3 + LABEL_PADDING_PX) / 2,
        offsetY: style.offsetYPx ?? 0,
        extentDeg: label.extentDeg ?? null,
        target: null,
        shownOffsetY: style.offsetYPx ?? 0,
        shownX: NaN,
        shownY: NaN,
        twinX: NaN,
        twinY: NaN,
        visible: false,
        dimmed: false,
        twin,
        twinVisible: false,
      };
    });
    // Stable sort keeps every existing label's order among its equals.
    this.placed = [...this.placed, ...added].sort((a, b) => a.rank - b.rank || a.priority - b.priority);
    const mine = new Set(added);
    return {
      setVisible: (visible) => {
        state.visible = visible;
      },
      remove: () => {
        for (const placed of mine) {
          placed.element.remove();
          placed.twin?.remove();
        }
        this.placed = this.placed.filter((placed) => !mine.has(placed));
      },
    };
  }

  /**
   * Where the thing called `name` is, among the names lazy layers have
   * added: for a look or a mark at something no baked file has, "M31" or
   * "Mars". Hidden groups count: a layer switched off still knows where its
   * things are, and an answer that came and went with a switch would move a
   * guide's pointer for no reason the user could see. The baked names are
   * not looked at; targets.ts has them indexed, with their kinds.
   *
   * A label answers when its text, less a leading marker, is the name or
   * starts with it and a space: "M31" finds "M31 Andromeda Galaxy". An exact
   * answer beats a starting one. Two answers at one place (one galaxy in two
   * catalogues) are one; at two places they are `many`.
   */
  find(name: string): FoundLabel {
    if (name === '') return NOT_FOUND;
    let exact: PlacedLabel | null = null;
    let exactCount = 0;
    let starts: PlacedLabel | null = null;
    let startsCount = 0;
    for (const placed of this.placed) {
      const group = placed.group;
      if (!group?.findable || !placed.findName.startsWith(name)) continue;
      if (placed.findName.length === name.length) {
        if (!exact || !samePlace(exact, placed)) exactCount++;
        exact ??= placed;
      } else if (placed.findName.charCodeAt(name.length) === SPACE) {
        if (!starts || !samePlace(starts, placed)) startsCount++;
        starts ??= placed;
      }
    }
    const best = exact ?? starts;
    const count = exact ? exactCount : startsCount;
    if (!best) return NOT_FOUND;
    if (count > 1) return { found: 'many', count };
    return { found: 'one', frame: best.group!.frame, position: best.position };
  }

  /** Names currently shown, in placement order. Instrumentation for tests and the harness. */
  visibleNames(): string[] {
    return this.placed.filter((p) => p.visible).map((p) => p.name);
  }

  /**
   * The shown name nearest the middle of `camera`'s view, within
   * `maxAngleRad` of it, as its text reads; null if none is that near. For
   * "what's that?": the camera is the head's, so it is the middle of both
   * eyes too.
   */
  nameNearestViewCenter(camera: THREE.Camera, maxAngleRad: number): string | null {
    const best = this.nearestViewCenter(camera, maxAngleRad, () => true);
    return best ? (best.element.textContent ?? best.name) : null;
  }

  /** The shown name on the sky nearest the view's centre, within `maxAngleRad` of it, as a spyglass target. */
  skyTargetNearViewCenter(camera: THREE.Camera, maxAngleRad: number): SkyTarget | null {
    const best = this.nearestViewCenter(camera, maxAngleRad, (placed) => placed.group?.frame === 'sky');
    if (!best) return null;
    best.target ??= {
      key: best,
      name: best.element.textContent ?? best.name,
      extentDeg: best.extentDeg,
      // ICRS turned onto the world by this frame's sky rotation: the sky turns under a long look.
      directionInto: (out) => out.copy(best.position).applyMatrix4(this.skyRotation).normalize(),
    };
    return best.target;
  }

  /**
   * Hide the names inside the spyglass's window - `radiusRad` about the
   * world direction `direction` - where they would float over the
   * magnified sky at their unmagnified places; null when it is shut.
   */
  setSpyglassHole(direction: THREE.Vector3 | null, radiusRad = 0): void {
    if (direction) this.hole.copy(direction);
    this.holeCos = direction ? Math.cos(radiusRad) : 2;
  }

  private nearestViewCenter(camera: THREE.Camera, maxAngleRad: number, eligible: (placed: PlacedLabel) => boolean): PlacedLabel | null {
    camera.updateMatrixWorld();
    const forward = this.forward.set(0, 0, -1).transformDirection(camera.matrixWorld);
    let best: PlacedLabel | null = null;
    let bestCos = Math.cos(maxAngleRad);
    for (const placed of this.placed) {
      if (!placed.visible || !eligible(placed)) continue;
      const cos = this.worldPoint(placed, camera).sub(camera.position).normalize().dot(forward);
      if (cos > bestCos) {
        best = placed;
        bestCos = cos;
      }
    }
    return best;
  }

  /** Where a placed label's point is in the world, written into `this.view`. */
  private worldPoint(placed: PlacedLabel, camera: THREE.Camera): THREE.Vector3 {
    if (placed.group?.frame === 'sky') {
      return this.view
        .copy(placed.position)
        .applyMatrix4(this.skyRotation)
        .multiplyScalar(SKY_LABEL_DISTANCE_M)
        .add(camera.position);
    }
    return this.view.copy(placed.position);
  }

  /**
   * Place labels for this frame's camera, in a viewport of CSS size
   * width×height. In stereo, `camera` is the left eye, the viewport is one
   * eye's, and `rightEye` places the twins. `skyRotation` turns ICRS
   * directions into the world's (ECEF) for groups on the sky.
   */
  update(
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
    rightEye?: THREE.PerspectiveCamera,
    skyRotation?: THREE.Matrix4
  ): void {
    camera.updateMatrixWorld();
    if (skyRotation) this.skyRotation.copy(skyRotation);
    this.boxes.length = 0;
    let shown = 0;
    let shownSky = 0;
    let shownThroughEarth = 0;
    // The observer's zenith: the camera stands on the surface, the Earth's centre at the origin.
    this.up.copy(camera.position).normalize();
    const zoomed = camera.fov < SKY_ZOOMED_FOV_DEG;
    const throughEarthAllowance = zoomed ? MAX_VISIBLE_SKY_LABELS : MAX_SKY_LABELS_THROUGH_EARTH;

    for (const placed of this.placed) {
      let show = false;
      let below = false;
      let x = 0;
      let y = 0;
      const enabled = placed.label ? !this.hiddenKinds.has(placed.label.kind) : placed.group!.visible;
      const frame = placed.group?.frame ?? 'earth';
      const sky = frame !== 'earth';
      if ((sky ? shownSky < MAX_VISIBLE_SKY_LABELS : shown < MAX_VISIBLE_LABELS) && enabled) {
        this.worldPoint(placed, camera);
        const inHole = this.holeCos <= 1 && this.toPoint.copy(this.view).sub(camera.position).normalize().dot(this.hole) > this.holeCos;
        if (sky) {
          below = this.view.dot(this.up) < camera.position.dot(this.up);
          if (below) {
            show =
              (frame === 'space' || this.skyThroughEarth) &&
              shownThroughEarth < throughEarthAllowance &&
              (zoomed || !placed.group!.zoomedOnlyBelowHorizon);
          }
        }
        this.view.applyMatrix4(camera.matrixWorldInverse);
        // Camera looks down -Z: anything at z >= 0 is behind the viewer.
        if (!inHole && (!below || show) && this.view.z < 0) {
          this.view.applyMatrix4(camera.projectionMatrix);
          x = (this.view.x * 0.5 + 0.5) * width;
          const pointY = (0.5 - this.view.y * 0.5) * height;
          y = pointY + placed.offsetY;
          placed.shownOffsetY = placed.offsetY;
          show = this.fits(x, y, placed, width, height);
          // A name hung under its marker may sit over it instead: two things at
          // one spot on the sky - a galaxy and the black hole in it - both get named.
          if (!show && placed.offsetY !== 0) {
            y = pointY - placed.offsetY;
            placed.shownOffsetY = -placed.offsetY;
            show = this.fits(x, y, placed, width, height);
          }
        } else {
          show = false;
        }
      }

      if (show) {
        this.boxes.push(x - placed.halfWidth, y - placed.halfHeight, x + placed.halfWidth, y + placed.halfHeight);
        // Tenths of a pixel, and written only on a move: looking steadily at
        // a view, no label's style is touched at all.
        const tx = Math.round(x * 10);
        const ty = Math.round(y * 10);
        if (tx !== placed.shownX || ty !== placed.shownY) {
          placed.shownX = tx;
          placed.shownY = ty;
          placed.element.style.transform = `translate(${(tx / 10).toFixed(1)}px, ${(ty / 10).toFixed(1)}px) translate(-50%, -50%)`;
        }
        if (sky) {
          shownSky++;
          if (below) shownThroughEarth++;
        } else shown++;
        if (below !== placed.dimmed) {
          placed.dimmed = below;
          const opacity = below ? String(THROUGH_EARTH_OPACITY) : '';
          placed.element.style.opacity = opacity;
          if (placed.twin) placed.twin.style.opacity = opacity;
        }
      }
      if (show !== placed.visible) {
        placed.element.style.display = show ? '' : 'none';
        placed.visible = show;
      }
      if (this.stereo && rightEye && placed.twin) this.placeTwin(placed, placed.twin, show, rightEye, width, height);
    }
  }

  /** The right eye's copy of a label the left eye placed; hidden if that eye cannot see the point. */
  private placeTwin(
    placed: PlacedLabel,
    twin: HTMLElement,
    leftShows: boolean,
    rightEye: THREE.PerspectiveCamera,
    width: number,
    height: number
  ): void {
    let show = false;
    if (leftShows) {
      this.worldPoint(placed, rightEye).applyMatrix4(rightEye.matrixWorldInverse);
      if (this.view.z < 0) {
        this.view.applyMatrix4(rightEye.projectionMatrix);
        const tx = Math.round((this.view.x * 0.5 + 0.5) * width * 10);
        const ty = Math.round(((0.5 - this.view.y * 0.5) * height + placed.shownOffsetY) * 10);
        if (tx !== placed.twinX || ty !== placed.twinY) {
          placed.twinX = tx;
          placed.twinY = ty;
          twin.style.transform = `translate(${(tx / 10).toFixed(1)}px, ${(ty / 10).toFixed(1)}px) translate(-50%, -50%)`;
        }
        show = true;
      }
    }
    if (show !== placed.twinVisible) {
      twin.style.display = show ? '' : 'none';
      placed.twinVisible = show;
    }
  }

  /** Whether a label's box centred at (x, y) is on screen and clear of every label placed so far. */
  private fits(x: number, y: number, placed: PlacedLabel, width: number, height: number): boolean {
    return (
      x + placed.halfWidth > 0 &&
      x - placed.halfWidth < width &&
      y + placed.halfHeight > 0 &&
      y - placed.halfHeight < height &&
      !this.overlapsPlaced(x, y, placed.halfWidth, placed.halfHeight)
    );
  }

  private overlapsPlaced(x: number, y: number, halfWidth: number, halfHeight: number): boolean {
    const left = x - halfWidth;
    const top = y - halfHeight;
    const right = x + halfWidth;
    const bottom = y + halfHeight;
    for (let i = 0; i < this.boxes.length; i += 4) {
      if (left < this.boxes[i + 2] && right > this.boxes[i] && top < this.boxes[i + 3] && bottom > this.boxes[i + 1]) {
        return true;
      }
    }
    return false;
  }

  dispose(): void {
    this.container.remove();
    this.rightEyeContainer?.remove();
  }
}
