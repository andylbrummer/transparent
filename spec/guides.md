# Guides

Narrated tours of what the app shows: the Earth's interior, the surface, the
solar system, the stars, deep space, the Sun. A guide is a folder of JSON,
narration audio and captions in this repository. Anyone can add one by pull
request. The voice AI that can drive the same view is a separate, later
design: [voice-guide.md](voice-guide.md).

Status: design. Nothing here is built. Line references are to the tree at
commit `0d0bb71`.

## 1. Goals and non-goals

### Goals

- G1. A guide plays end to end on a phone, in Cardboard and on a desktop, with
  narration, captions and a view that changes in step with the narration.
- G2. A guide is authored without touching app code: one folder under
  `app/public/guides/<id>/`, checked by a validator that runs in `npm test`.
- G3. The viewer always looks out from a point on the ground. A guide may
  change where that point is and what time it is. It never moves the camera
  off the ground.
- G4. Where the device's pose aims the view, the guide points the way and
  waits. It does not turn the user.
- G5. Everything works in Cardboard with no touch: gaze, the viewer button,
  head gestures. Voice adds to these and is never the only way.
- G6. One action vocabulary changes the view. The guide player, the fixed
  voice grammar and the future AI all call it.
- G7. Failures show. A missing file or an unknown layer id fails the build. A
  file that fails to load at run time stops the guide with a message.
- G8. Every narration and video has captions and a transcript. Reduced motion
  is respected.
- G9. The site stays static. Guides add files, not server code.

### Non-goals (this design)

- No orbit view, no globe to spin, no camera flight between places.
- No branching guides. Chapters, steps and cues run in order (§5.6).
- No guides inside an AR session. Labels are already off there
  (`app/src/main.ts:597`) and the camera belongs to the XR session. The guide
  button is hidden while AR is active.
- No in-app authoring tool. Authors edit JSON with a schema-aware editor.
- No synthesized narration at run time. Narration is recorded audio in the
  repository.
- No guide loaded from outside this site's origin.
- No dependency on the voice AI anywhere in this document's phases.

## 2. The view control: one action vocabulary

### 2.1 Verdict on the idea

The idea holds, with five changes.

1. **Actions are absolute, never relative.** "Zoom in" and "toggle" depend on
   what came before. A guide must be able to seek, skip and go back, so the
   view at any point has to be computable from the cues alone (§5.4). The
   vocabulary has "set the field of view to 20°", not "zoom in 2×". The voice
   grammar's relative commands ("zoom in") stay in the voice adapter, which
   turns them into absolute actions.
2. **Not everything in `VoiceActions` belongs.** `calibrate`,
   `keepCalibration`, `exitCardboard`, `isInCardboard` and `isCalibrating`
   (`app/src/voice/respond.ts:16-21`) are about the viewer, not the view.
   They stay in `VoiceActions`. Neither a guide nor the AI gets them.
3. **No "show a caption" action.** Captions come from the narration's
   caption file, so they can never drift from the audio. What a guide does
   need is a way to put a name on a thing: `mark`.
4. **One `look` action covers aim, field of view and the spyglass.** Zoom is
   the camera's field of view on a phone or desktop and the spyglass in
   Cardboard (`app/src/main.ts:563-577` already makes that split for voice).
   Authors say what to look at and how wide. The view control picks the
   mechanism.
5. **Layer opacity is not in the first vocabulary.** See §7.

### 2.2 Where it sits

A new folder, `app/src/view/`:

| File | Holds |
|---|---|
| `actions.ts` | The `ViewAction`, `Target`, `Place` types. Types only. |
| `view-control.ts` | `createViewControl(deps)`: the one implementation. |
| `targets.ts` | Pure maths: a `Target` to a world direction at a place and time. |
| `standing-place.ts` | Where the view stands: the sensor fix, or a place set by an action. |

`view-control.ts` takes its collaborators as an argument, the way
`VoiceActions` is passed in today, so it is tested without a renderer. It
hides the layers panel, the layer manager, the clock, the standing place, the
look controller, the spyglass and the labels. `main.ts` builds it once and
hands it to the guide player and to the voice adapter. `main.ts` gets
shorter: the block at `app/src/main.ts:544-579` becomes a few lines.

### 2.3 Types

```ts
// app/src/view/actions.ts

/** Something to look at. Every kind resolves to a direction from where the view stands. */
export type Target =
  /** The Sun, the Moon or a planet, from packages/core/src/astro at the app clock's time. */
  | { readonly kind: 'body'; readonly body: 'sun' | 'moon' | PlanetName }
  /** A fixed place on the sky, ICRS. */
  | { readonly kind: 'sky'; readonly raDeg: number; readonly decDeg: number;
      readonly name?: string; readonly extentDeg?: number }
  /** A direction in the local frame: azimuth clockwise from north, altitude above the horizon. -90 is straight down. */
  | { readonly kind: 'horizon'; readonly azDeg: number; readonly altDeg: number }
  /** A place on or in the Earth. */
  | { readonly kind: 'ground'; readonly lat: number; readonly lon: number;
      readonly depthKm?: number; readonly name?: string }
  /** A name from the baked label files (geo/labels.json, geology.json, quakes.json). */
  | { readonly kind: 'label'; readonly name: string };

export type Place =
  /** Where the sensors say the user is. */
  | { readonly kind: 'here' }
  /** The far side of the Earth from `here`. */
  | { readonly kind: 'antipode' }
  | { readonly kind: 'at'; readonly lat: number; readonly lon: number; readonly name: string };

export type ViewAction =
  /** Every switch as the preset has it (ui/presets.ts). */
  | { readonly do: 'preset'; readonly id: string }
  /** Named switches on or off; the rest stay. */
  | { readonly do: 'layers'; readonly on?: readonly string[]; readonly off?: readonly string[] }
  | { readonly do: 'stand'; readonly place: Place }
  /**
   * The app clock. `at` is an ISO 8601 instant or 'now'. `rate` is simulated
   * seconds per real second: 1 is real time, 0 is frozen. With `until`, the
   * clock stops there.
   */
  | { readonly do: 'time'; readonly at: string; readonly rate?: number; readonly until?: string }
  /** Look at a target, optionally `fovDeg` wide. */
  | { readonly do: 'look'; readonly target: Target; readonly fovDeg?: number }
  /** The field of view with no target: 60 is the default. Closes the spyglass. */
  | { readonly do: 'fov'; readonly fovDeg: number }
  /** A ring and a line of text on a target; `text: null` removes it. */
  | { readonly do: 'mark'; readonly target: Target; readonly text: string | null }
  /** Play a hotspot's clip (§8), or stop whatever clip is playing. */
  | { readonly do: 'clip'; readonly hotspot: string | null };

export type AimMode = 'pose' | 'manual';

export type ActionOutcome =
  | { readonly ok: true }
  /** `look` in pose mode: the pointer is up; the user has to turn. */
  | { readonly ok: true; readonly awaitingGaze: true }
  | { readonly ok: false; readonly code: ActionErrorCode; readonly message: string };

export type ActionErrorCode =
  | 'unknown-preset' | 'unknown-layer' | 'layer-unavailable'
  | 'target-unresolved' | 'unknown-hotspot' | 'media-failed' | 'bad-value';

/** What the view is, in full: enough to rebuild it. */
export interface ViewState {
  readonly layersOn: readonly string[];
  readonly place: Place;
  /** Where that is. */
  readonly position: SurfacePosition;
  readonly time: { readonly at: Date; readonly rate: number; readonly live: boolean };
  readonly aimMode: AimMode;
  /** Where the view's centre points, local frame. */
  readonly aim: { readonly azDeg: number; readonly altDeg: number };
  readonly fovDeg: number;
  readonly lookingAt: Target | null;
  readonly marks: readonly { readonly target: Target; readonly text: string }[];
  readonly clip: string | null;
}

export interface ViewControl {
  /** Do one action. Resolves when it has taken effect: the layer loaded, the ease finished. */
  perform(action: ViewAction): Promise<ActionOutcome>;
  /** Apply a whole state at once, with no eases: for seek and skip. */
  restore(state: FoldedView): Promise<ActionOutcome>;
  state(): ViewState;
  /** Where a target is now and how far the view's centre is from it. */
  locate(target: Target): Located | { readonly ok: false; readonly code: 'target-unresolved'; readonly message: string };
  /** Load layers ahead of need. Rejects if one fails. */
  preload(layerIds: readonly string[]): Promise<void>;
  /**
   * Borrow the view: nothing is saved to localStorage until `end()`, which
   * puts the switches, place, clock and field of view back as they were.
   */
  borrow(): { end(): void };
}

export interface Located {
  readonly ok: true;
  /** World unit vector. */
  readonly direction: THREE.Vector3;
  readonly azDeg: number;
  readonly altDeg: number;
  /** Angle from the view's centre, degrees. */
  readonly offCentreDeg: number;
}
```

`FoldedView` is the result of folding a list of actions (§5.4): the switches
on, the place, the clock, the look target, the field of view and the marks.
`fold(actions): FoldedView` is a pure function in `actions.ts`.

`perform` returns an outcome. It does not throw for an author's mistake and it
does not skip. The guide player shows a failed outcome as an error and stops
(§5.5). The AI gets it back as a tool result.

### 2.4 The three callers

| Caller | How it uses the view control |
|---|---|
| Guide player | Cues are `ViewAction` JSON. `perform` in time order, `restore` on seek. |
| Fixed voice grammar | `respond.ts` maps `preset` and `layer` commands straight to actions. Its `zoom` reads `state().fovDeg` and performs an absolute `fov` or `look`. `resetView` and the Cardboard commands stay as they are. |
| Voice AI (later) | Tool calls are `ViewAction` JSON, checked against the same schema. See [voice-guide.md](voice-guide.md). |

### 2.5 What each action does in each aim mode

The aim mode is `pose` when `sensors.getAttitude()` returns an attitude, as
the camera update at `app/src/main.ts:609` already decides, and `manual`
otherwise.

| Action | Manual aim (desktop, no compass) | Pose, phone | Pose, Cardboard |
|---|---|---|---|
| `preset`, `layers` | Applied. Waits for lazy layers to load. | Same. | Same. |
| `stand` | Dip to dark, move, fade up (§7). Place chip shows. | Same. | Same; chip shows for 4 s. |
| `time` | Applied. Time chip shows while the clock is not live. | Same. | Same; rate capped (§7.3). |
| `look`, no `fovDeg` | The view eases to the target (§6.1). | Pointer toward the target; outcome `awaitingGaze` (§6.2). | Same, pointer drawn per eye. |
| `look` with `fovDeg` ≥ 30 | Eases aim and field of view together. | Pointer; field of view changes once the target is centred. | Pointer only. The stereo field of view is the lenses'. |
| `look` with `fovDeg` < 30 | Eases aim and field of view together. | Pointer; then narrows the field of view. Floor 5° (hand tremor). | Pointer; then the spyglass opens on the target, framed `fovDeg` wide. |
| `fov` | Eases. | Applied. | Closes the spyglass. |
| `mark` | Ring and text. | Same. | Same, per eye. |
| `clip` | Plays in the clip panel (§8). | Same. | Audio and image: yes. Video: phase 4d. |

A field of view under 30° always needs a target, because Cardboard can only
magnify through the spyglass and the spyglass opens on something. The
validator rejects a bare `fov` under 30°.

## 3. Guide files

```
app/public/guides/
  index.json                      ids, in the order the guide list shows them
  guide.schema.json               the format; guides point "$schema" at it
  down-through-the-earth/
    guide.json
    audio/01-surface.m4a          narration, one file per step
    audio/01-surface.vtt          its captions
    images/prem-cross-section.webp
```

`index.json` is the one shared file a new guide touches. The app cannot list
a folder on a static host, and a build plugin to generate the list is more
machinery than one line of JSON. The validator fails if the index and the
folders disagree.

### 3.1 Schema sketch

`guide.schema.json` is JSON Schema (draft 2020-12). It is the format's source
of truth: editors read it for completion, the validator checks every guide
against it, and the AI's tool schemas are cut from its `ViewAction`
definition later. The TypeScript types in `view/actions.ts` and
`guides/format.ts` are derived from it (§9, open question Q3).

```jsonc
{
  "$schema": "../guide.schema.json",
  "formatVersion": 1,
  "id": "down-through-the-earth",        // equals the folder name
  "title": "Down through the Earth",
  "summary": "From the ground under your feet to the inner core.",
  "language": "en",                       // BCP 47
  "topics": ["geology"],                  // geology | solar-system | stars | deep-space | sun | weather | near-space
  "authors": [{ "name": "…", "url": "…" }],
  "licence": "CC BY 4.0",                 // of the script and the narration recording
  "credits": [                            // same shape as layers/types.ts Credit
    { "what": "Narration", "source": "…", "licence": "CC BY 4.0", "url": "…" }
  ],
  "sponsor": null,                        // or { "name": "…", "url": "…" }: shown as "commissioned by"
  "chapters": [
    {
      "id": "crust",
      "title": "The crust",
      "scene": {                          // the whole view at the chapter's start: required
        "preset": "inside",               // or "layers": ["…"]: exactly one of the two
        "place": { "kind": "here" },
        "time": { "at": "now" },
        "look": { "target": { "kind": "horizon", "azDeg": 0, "altDeg": -90 }, "fovDeg": 60 }
      },
      "steps": [
        {
          "id": "moho",
          "narration": { "audio": "audio/02-moho.m4a", "captions": "audio/02-moho.vtt" },
          // or, for a step with no speech:  "silenceS": 6
          "cues": [
            { "at": 0, "do": "layers", "on": ["shell-moho"] },
            { "at": 4.5, "do": "mark", "target": { "kind": "horizon", "azDeg": 0, "altDeg": -90 }, "text": "Moho · 24 km" }
          ],
          "advance": "auto",              // auto | gaze | continue
          "hotspots": []                  // §8
        }
      ]
    }
  ]
}
```

Rules the schema states:

- Ids are kebab-case and unique within their parent.
- A cue is a `ViewAction` plus `at`, seconds from the start of the step's
  narration. Cues are in time order. `at` is within the narration's length.
- A step has `narration` or `silenceS`, never both.
- A `scene` is complete. It is the keyframe that makes seeking cheap (§5.4).
- `advance: "gaze"` needs a `look` cue in the step: that cue's target is what
  the step waits for.
- No unknown properties anywhere.

### 3.2 Worked example

`app/public/guides/down-through-the-earth/guide.json`, shortened to three
steps. Every layer and preset id is one that exists today. The label name is
from `app/public/geo/geology.json`.

```json
{
  "$schema": "../guide.schema.json",
  "formatVersion": 1,
  "id": "down-through-the-earth",
  "title": "Down through the Earth",
  "summary": "From the ground under your feet to the inner core, 6,371 km straight down.",
  "language": "en",
  "topics": ["geology"],
  "authors": [{ "name": "Transparent Earth" }],
  "licence": "CC BY 4.0",
  "credits": [
    { "what": "Script and narration", "source": "Transparent Earth contributors", "licence": "CC BY 4.0",
      "url": "https://github.com/andylbrummer/transparent" }
  ],
  "sponsor": null,
  "chapters": [
    {
      "id": "the-way-down",
      "title": "The way down",
      "scene": {
        "layers": ["globe-surface", "political", "place-labels", "depth-ladder"],
        "place": { "kind": "here" },
        "time": { "at": "now" },
        "look": { "target": { "kind": "horizon", "azDeg": 0, "altDeg": -90 }, "fovDeg": 60 }
      },
      "steps": [
        {
          "id": "look-down",
          "narration": { "audio": "audio/01-look-down.m4a", "captions": "audio/01-look-down.vtt" },
          "cues": [
            { "at": 0, "do": "look", "target": { "kind": "horizon", "azDeg": 0, "altDeg": -90 } },
            { "at": 6, "do": "mark", "target": { "kind": "horizon", "azDeg": 0, "altDeg": -90 },
              "text": "The far side · 12,742 km" }
          ],
          "advance": "gaze"
        },
        {
          "id": "shells",
          "narration": { "audio": "audio/02-shells.m4a", "captions": "audio/02-shells.vtt" },
          "cues": [
            { "at": 0, "do": "mark", "target": { "kind": "horizon", "azDeg": 0, "altDeg": -90 }, "text": null },
            { "at": 0, "do": "layers", "off": ["political", "place-labels"] },
            { "at": 3, "do": "layers", "on": ["shell-moho"] },
            { "at": 11, "do": "layers", "on": ["shell-670"] },
            { "at": 19, "do": "layers", "on": ["shell-core"] },
            { "at": 27, "do": "layers", "on": ["shell-inner-core", "inner-core"] }
          ],
          "advance": "auto"
        },
        {
          "id": "the-deep-mantle",
          "narration": { "audio": "audio/03-deep-mantle.m4a", "captions": "audio/03-deep-mantle.vtt" },
          "cues": [
            { "at": 0, "do": "layers", "on": ["deep-labels", "tomography-slow-bodies"], "off": ["globe-surface"] },
            { "at": 2, "do": "look", "target": { "kind": "label", "name": "Tuzo (African LLSVP)" } }
          ],
          "advance": "gaze",
          "hotspots": [
            {
              "id": "prem",
              "title": "How we know: the PREM model",
              "anchor": { "kind": "horizon", "azDeg": 0, "altDeg": -90 },
              "clip": { "kind": "image", "src": "images/prem-cross-section.webp",
                        "alt": "Cross-section of the Earth with the PREM layer boundaries at 24, 670, 2,890 and 5,150 km.",
                        "caption": "Seismic waves speed up and slow down at each boundary. PREM (Dziewonski & Anderson 1981) fits those travel times.",
                        "credit": { "what": "Diagram", "source": "…", "licence": "CC BY 4.0", "url": "…" } }
            }
          ]
        }
      ]
    }
  ]
}
```

This guide needs no place or time change and no video, which is why it is the
first one to ship (§13, phase 1).

## 4. The player

`app/src/guides/`:

| File | Holds |
|---|---|
| `format.ts` | Guide types; `foldTo(guide, chapter, step, tS)`. |
| `player.ts` | The state machine. Pure: takes a clock source and a `ViewControl`. |
| `narration.ts` | The one audio element and its events. |
| `captions.ts` | WebVTT cue parsing and the caption overlay. |
| `gaze-guide.ts` | The pointer and the arrival test (§6). |
| `guide-ui.ts` | The guide list, the play bar, the pause card, errors. |
| `guides.test.ts` | The validator (§9). |

A deep link starts a guide: `?guide=<id>` and optionally `&step=<chapter>/<step>`,
in the style of the existing `?time=` (`app/src/clock.ts:14`). The harness
hook grows `getGuide()` beside `getSpyglass()` (`app/src/main.ts:91`), giving
the guide id, chapter, step, step time and player state.

## 5. Timing model

### 5.1 The step clock is the narration

Within a step, the only clock is the audio element's `currentTime`. A cue
fires when `currentTime` passes its `at`. Nothing is scheduled with timers, so
a stalled download stalls the cues with it and captions, cues and speech
cannot drift apart. A step with `silenceS` uses a wall clock that pauses with
the player.

### 5.2 Player states

```
idle → loading → playing ⇄ paused
                 playing → waiting (narration over; gate not yet met) → playing (next step)
                 any → error (halts; Retry or Exit)
                 last step done → ended → idle
```

A step ends when its narration is over **and** its gate is met:

| `advance` | Gate |
|---|---|
| `auto` | None. |
| `gaze` | The step's look target is centred (§6.3). In manual aim the ease has finished. |
| `continue` | The user says go on: tap Next, viewer button, nod, Space, or "next". |

The gate is at the end of the step, not the start. The narrator says "turn to
the south-west and find the red point" while the user turns. The next step
starts when they get there.

A gate that is not met 20 s after the narration ends shows "Can't find it?
Continue" beside the pointer. The guide never moves on by itself.

### 5.3 Pause

- Narration pauses. The step clock stops with it.
- If the guide set the app clock running fast, its rate goes to 0 and comes
  back on resume.
- An ease in progress finishes. Layers stay as they are.
- Leaving the tab (`visibilitychange`) pauses. Coming back does not resume.

### 5.4 Seek, skip, back

The view at any point is a fold: start from the chapter's `scene`, apply
every cue up to that point in order, keep the last value of each thing.
`foldTo` does this with no side effects, and `ViewControl.restore` applies
the result in one go with a dip to dark (§7). There is no undo log.

- **Next / back** go to the start of the next or previous step.
- **Repeat** goes back 10 s within the step.
- **Chapter jump** goes to a chapter's first step.
- `clip` cues are not replayed by a fold. A clip plays only when playback
  crosses its cue going forward.

This is why actions are absolute (§2.1) and why every chapter has a full
scene: a fold never reaches back past the chapter's start.

### 5.5 Things that go wrong

| Event | What the player does |
|---|---|
| Narration stalls (network) | Cues stall with it. "Buffering…" after 1 s. After 10 s: error, Retry / Exit. |
| Narration or caption file fails to load | Error naming the step. Halts there. No skip, no text-to-speech stand-in. |
| A layer fails to load | Error naming the layer. Halts. The layer's own "unavailable" chip (`app/src/layers/manager.ts:72-76`) is not enough: the panel is hidden in Cardboard. |
| `perform` returns `ok: false` | Error with the outcome's message. Halts. |
| `formatVersion` newer than the app knows | Error: "This guide needs a newer version of the app." |

Errors show in the play bar on a phone or desktop and as a per-eye readout in
Cardboard, and are spoken once with the browser's speech. The spoken line is
the error, not a replacement for the narration.

### 5.6 The user wanders

- **Looks away during narration.** The narration goes on: it is audio, and
  people look around. If the view's centre is more than 40° from the step's
  target for 3 s, the pointer comes back.
- **Drags the view during an ease (manual aim).** The ease stops. The user
  wins. The pointer shows instead.
- **Flips a switch by hand.** Allowed. It lasts until a cue sets that switch
  or the next chapter's scene.
- **Leaves the guide.** `borrow().end()` puts the switches, place, clock and
  field of view back as they were before the guide. The guide's changes were
  never saved (§12, gap 6).

### 5.7 Why linear

Branches multiply what an author must record, caption and fact-check, and
what the validator must prove reachable. The need behind branching is "let me
hear more about that". Hotspots meet it: optional clips beside the main line
that pause it and hand back (§8). The chapter list gives random access.
Neither needs a graph.

## 6. Gaze guidance

### 6.1 Manual aim: the guide drives

`LookController.setAim` exists (`app/src/input/look.ts:83`, `:231-238`). It
jumps. The view control adds the ease:

- Turn along the shortest arc from the current aim to the target.
- 1.5 s for turns up to 90°, then at 60°/s. Ease in and out.
- Field of view eases over the same time, evenly in log scale, as the
  spyglass opens (`app/src/ui/spyglass.ts:15-17`).
- Reduced motion: no ease. Dip to dark, set the aim, fade up.

### 6.2 Pose: the guide points

The view control cannot turn a phone or a head (`app/src/input/look.ts:81`:
"a phone's attitude still overrides it"). `look` puts up the pointer:

- **Target off screen:** an arrow at the edge of the view on the shortest
  turn toward the target, with its name and how far: "Mars · 74° right". In
  Cardboard the arrow sits 20° from the view's centre, not at the screen's
  edge, which the lenses blur, and is drawn once per eye the way the voice
  readout is (`app/src/voice/voice-overlay.ts:58-70`).
- **Target on screen:** a ring on it, with its name.
- **Target centred:** the ring closes and the pointer goes.

The arrow's text carries the direction, so it does not depend on shape or
colour alone.

### 6.3 Arrival

A target is centred when it has been within `ARRIVE_DEG = 8` of the view's
centre for `ARRIVE_MS = 600`. That is looser and quicker than the spyglass's
stare (`CAPTURE_DEG = 2.5`, `DWELL_MS = 1200`,
`app/src/ui/spyglass.ts:44-47`), on purpose: the stare opens something and
must not fire by accident, while arrival only lets a narration move on. Both
numbers are first guesses to tune on a phone held in the hand.

Where a `look` asks for the spyglass (Cardboard, `fovDeg` < 30), arrival is
followed by the spyglass's own rule: the view control calls
`spyglass.deeper(target)` once the target is within `CAPTURE_DEG`, the same
call a nod makes (`app/src/main.ts:628`). The spyglass then behaves as it
always does. Looking `RELEASE_DEG` away closes it.

## 7. Transitions

### 7.1 Dip to dark

One transition covers every hard change: a preset, a new place, a time jump,
a seek. The scene fades to the background colour over 250 ms, the change is
made, lazy layers finish loading, and the scene fades back over 400 ms. It is
drawn by the renderer once, over whatever the layers drew, so no layer has to
know about it. Labels fade with it.

A dissolve from a frozen picture of the old view was considered and rejected.
In pose mode the frozen picture would be stuck to the screen while the head
moves, which is uncomfortable in a headset. A dark frame stuck to the head is
not.

A `layers` cue that turns on a layer that is already loaded does not dip. It
just appears.

### 7.2 Layer fades

`LayerInstance` has `setVisible` and nothing finer
(`app/src/layers/types.ts:110-111`). Adding opacity to every layer means
touching more than a hundred switches of five kinds
(`app/src/ui/layers-panel.ts:20-27`). That is not worth it for a first
release.

The shells are the exception, and the place a planetarium fade matters most.
Their visibility is already a float the shader multiplies into alpha
(`app/src/render/globe.ts:127`, `:133`), written as 0 or 1
(`app/src/render/globe.ts:237`). Writing values between is a few lines.
Phase 5 adds an optional `setOpacity?(opacity)` to `LayerInstance`, fades the
shells, and lets `layers` cues take `"fadeS"`. The validator rejects `fadeS`
on a switch that cannot fade.

### 7.3 Time-lapse

`time` with a `rate` runs the app clock fast. The sky turns 15° an hour, so:

- Phone and desktop: no cap beyond the validator's (`|rate|` ≤ 31,557,600,
  a year a second).
- Cardboard: the rate is capped so the sky turns at most 10°/s, which is
  `rate` ≤ 2,400. A whole sky turning faster than that in a headset makes
  people ill. The cap is a first guess.
- Reduced motion: no time-lapse. Dip to dark and jump to `until`. A `time`
  cue with `rate` > 60 must give `until`, so there is somewhere to jump to.

While the clock is not live, a time chip shows the simulated date
("11 Mar 2011 05:46 UTC · guide"). The view is not the present and must say
so.

## 8. Hotspots and clips

### 8.1 What a hotspot is

A hotspot hangs a clip on something in the view.

```jsonc
{
  "id": "prem",                              // unique in its file
  "title": "How we know: the PREM model",
  "anchor": { … Target … },                  // where its marker sits
  "layer": "shell-core",                     // optional: shown only while this switch is on
  "clip": {
    "kind": "audio",                         // audio | video | image
    "src": "audio/prem.m4a",                 // in the guide's folder; video: an https://media… URL
    "captions": "audio/prem.vtt",            // audio and video: required
    "alt": "…", "caption": "…",              // image: both required
    "poster": "images/prem-poster.webp",     // video: required
    "video": { "bytes": 18234567, "sha256": "…", "durationS": 94, "width": 1280, "height": 720 },
    "credit": { "what": "…", "source": "…", "licence": "…", "url": "…" }
  }
}
```

Hotspots live in two places, in one format:

- **In a guide step.** Shown while that step plays and until the chapter
  ends.
- **In the "Stories and clips" layer.** A lazy layer, `app/src/layers/media/layer.ts`,
  id `media-hotspots`, in the Labels section, off by default. Its data is
  `app/public/media/hotspots.json` with its files beside it. Switch it on and
  the hotspots are there with no guide playing.

Both hand their hotspots to one `HotspotField`, reached from a layer as
`context.addHotspots(spec)` beside the existing `context.addLabels`
(`app/src/layers/types.ts:105`). The field draws the markers, takes the
input and asks the clip player to play.

### 8.2 Markers

A marker is a label: "▶ PREM model". It goes through `LabelLayer.addGroup`
(`app/src/render/labels.ts:373`) in the frame its anchor needs, so it is
decluttered with the other names and gets its right-eye twin in stereo for
nothing.

### 8.3 Opening one

| Input | How |
|---|---|
| Tap or click | A press released within 8 px of where it went down, within 3° of a marker. Labels ignore pointer events (`app/index.html`, `.place-labels`), so the field tests the tap's direction against its markers. |
| Gaze-dwell (Cardboard) | The spyglass's rule and its ring: within `CAPTURE_DEG`, still, for `DWELL_MS`. |
| Viewer button | Tap while a marker is within `CAPTURE_DEG`. |
| Nod | Same as the button. |
| Voice | "play that", "play <title>". |
| Keyboard | Enter, with a marker within `CAPTURE_DEG` of the centre. |

A marker and a sky name can both be under the gaze. The marker wins the
dwell, the button and the nod. The name is still reachable: close the clip
and it is the name's turn.

Closing: shake, "stop", Esc, the close button, or looking 40° away from the
clip for 3 s, which pauses it.

### 8.4 The clip player

One module, `app/src/guides/clip-player.ts`, owning one `<audio>` and one
`<video>` element for the whole app.

- **One thing speaks at a time.** Opening a clip pauses the guide. Closing it
  resumes the guide where it stopped. Narration is never ducked under a clip.
- **Captions** are drawn by the app's caption overlay from the VTT file, not
  by the browser's track renderer. In stereo the overlay needs one copy per
  eye, and the browser's renderer cannot do that. One caption path for every
  mode.
- **Phone and desktop:** audio shows its title, a progress bar and captions
  near the foot of the screen. An image shows in a panel over the lower half
  with its caption and alt text. Video plays in the same panel with the
  browser's own controls.
- **Cardboard, audio and image:** captions per eye under the convergence
  spot. An image is drawn in the scene as a flat panel 40° wide, fixed in the
  local frame at the anchor's direction when it opened. It stays put as the
  head turns, as the spyglass's window does (`app/src/ui/spyglass.ts:12-14`),
  and it is fixed to the horizon, not the sky, so a time-lapse does not carry
  it off.
- **Cardboard, video:** the one `<video>` element is a texture on that same
  panel, drawn in both eye passes through the per-eye hook the spyglass lens
  uses (`app/src/main.ts:662-677`). Two `<video>` elements, one per eye,
  would decode twice and drift. This needs CORS on the media host (§10) and
  is its own phase.

### 8.5 Autoplay

Browsers start sound only after a user gesture. The player takes its audio
and video elements through `play()` once inside the tap that starts a guide
or enters Cardboard, then reuses those two elements for every file by
changing `src`. A guide started by voice in Cardboard is covered by the tap
that entered Cardboard. This is how Chrome and Safari are documented to
behave. It must be checked on a Pixel and an iPhone before phase 1 closes.

### 8.6 Preloading and offline

- On guide start: `guide.json`, the first chapter's caption files, the first
  two steps' audio, and the first chapter's layers through
  `ViewControl.preload`.
- While a step plays: the next step's audio and captions, and the next
  chapter's layers once the current chapter is half done.
- Video: the poster only. The video loads when opened, with range requests.
  Nothing fetches a video the user has not asked for.
- Offline or a failed fetch: the error of §5.5. There is no service worker
  and this design does not add one. A guide needs the network for whatever is
  not already in the HTTP cache.

## 9. The validator

`app/src/guides/guides.test.ts`, a Vitest file. It runs in `npm test`, so it
runs in GitHub Actions (`.github/workflows/deploy.yml`) and in the Cloudflare
build command, and a guide that fails it is not deployed. It reads
`app/public/guides/` and `app/public/media/` from disk and imports the real
registries: `LAYER_DEFINITIONS`, `LAYER_SWITCHES`, `LAYER_PRESETS`. It makes
no network request.

It checks, and names the guide, the JSON path and the reason for each
failure:

**Structure**
- Every guide validates against `guide.schema.json`.
- `index.json` lists exactly the folders that exist. `id` equals the folder
  name.
- `formatVersion` is one the app supports.

**References**
- Every layer id in a scene, cue or hotspot is a switch id from
  `switchesWithLazyLayers(LAYER_DEFINITIONS)`.
- Every preset id is in `LAYER_PRESETS` or is `default`.
- A scene or cue never turns on two switches of one exclusive group.
- A `label` target's name is in `geo/labels.json`, `geo/geology.json` or
  `geo/quakes.json`, exactly once.
- A `body` target is the Sun, the Moon or a planet the ephemeris has.
- `ground`, `sky` and `horizon` targets are in range.
- A `clip` cue names a hotspot of its own step or an earlier one in the
  chapter.
- A `time` cue that leaves the present does not coincide with a live layer
  being on (§12, gap 9).

**Timing**
- Cue times are in order and within the narration's length, read from the
  audio file's header.
- Caption cues are in order, do not overlap, and end within the audio's
  length.
- `advance: "gaze"` has a `look` cue to wait for.
- `fov` under 30° has a target. `rate` over 60 has `until`.

**Files**
- Every `audio`, `captions`, `src` and `poster` path exists inside the
  guide's folder. No path leaves the folder.
- Every file in the folder is used by the guide. Orphans fail.
- Formats and budgets:

| Kind | Format | Budget |
|---|---|---|
| Narration, audio clips | `.m4a`, AAC-LC, mono | ≤ 96 kbit/s; ≤ 5 MiB a file |
| Captions | `.vtt`, cue text and times only | ≤ 42 characters a line, ≤ 2 lines a cue |
| Images | `.webp` or `.jpg` | ≤ 2,048 px on the long side; ≤ 1 MiB |
| A guide's folder | | ≤ 20 MiB |
| Video (declared, §10) | `.mp4`, H.264 + AAC | ≤ 1080p; ≤ 200 MiB |

  Cloudflare refuses any static asset over 25 MiB. The 5 MiB cap sits far
  below it and is about the repository's size: a guide's audio stays in git
  history for good.

**Accessibility**
- Every narration has captions. Every audio or video clip has captions.
  Every image has `alt` and `caption`.
- Captions cover the narration: no stretch of speech longer than 3 s with no
  cue. Checked by gaps between caption cues, which is a proxy.

**Credits**
- `licence`, `authors` and at least one credit are present.
- Every clip has a credit with a licence and a URL.
- A video's URL is on the media origin and under `guides/<id>/` or `media/`.

**What it cannot check.** Whether the narration is true. Whether the audio
says what the captions say. Whether a video on R2 matches its declared hash
(§10 covers that with a separate command). Review covers the first two.

## 10. Video on R2, and the CSP

### 10.1 Hosting

- Bucket `transparent-media`, public through the custom domain
  `media.transparent.sbdev.io`. R2 answers range requests.
- Objects are named by content: `guides/<id>/<name>.<first 8 of sha256>.mp4`.
  A changed video is a new name, so objects are cached for a year and never
  purged.
- The bucket's CORS allows `GET` and `HEAD` from `https://transparent.sbdev.io`
  and `https://andylbrummer.github.io`. Video used as a WebGL texture needs
  it (§8.4).
- Upload: `devkey run cloudflare -- npx wrangler r2 object put …`, wrapped in
  `npm run guides:put-video <guide> <file>`, which names the object by its
  hash, uploads it and prints the `video` block for the guide JSON. The
  `cloudflare` devkey token has Workers Scripts edit today (AGENTS.md). It
  needs R2 object write added. That is the user's call.
- `npm run guides:check-media` fetches each declared video's headers and a
  hash, and fails on a mismatch. It needs the network, so it is not in
  `npm test`. Run it before a release that adds or changes a video.

A contributor's pull request cannot upload to R2. The PR carries the guide
with the video's declared size, hash and length. A maintainer uploads the
file before merging (Q5).

### 10.2 Exposure

This adds a listener. AGENTS.md's exposure table gets a row in the same
commit that creates the bucket:

| listener | posture | notes |
|---|---|---|
| `media.transparent.sbdev.io` (R2 bucket `transparent-media`) | `public` | static objects, GET/HEAD only, no auth by decision: it holds only published guide video |

R2 serves objects. There is no Worker code, no route to authenticate and no
request body. The caps are Cloudflare's.

### 10.3 CSP

**There is no CSP today.** `app/public/_headers` sets `X-Content-Type-Options`
and `Referrer-Policy` and a cache rule, and nothing else
(`app/public/_headers:4-6`, `:9-10`). So "reflect the media origin in the
CSP" means writing the first one.

A full policy is a job of its own: the layers fetch from many outside
hosts (GIBS, USGS, NOAA, JPL, CDS, ESA and more), and a wrong `connect-src`
breaks a layer with no message. This design adds only what video needs:

```
/*
  Content-Security-Policy: media-src 'self' https://media.transparent.sbdev.io
```

A policy with one directive restricts only that directive. Audio and video
may then load only from the site and the media host. Everything else is as
open as it is today. That gap is real and stays named here until a full
policy closes it (Q6).

Two limits:

- **GitHub Pages ignores `_headers`.** The policy applies on
  `transparent.sbdev.io` only. On the Pages site media loads from anywhere
  the code asks. The code asks only for the one origin.
- The media origin is written twice: in `_headers` and in the app as
  `MEDIA_ORIGIN`. A test reads `_headers` and fails if the two differ.

## 11. Accessibility

- **Captions** are on by default for narration and clips, in every mode. One
  switch turns them off. At least 16 CSS px, on a dark plate.
- **Transcript.** The play bar opens the current step's full text, built from
  its caption file. It is ordinary text: selectable and readable by a screen
  reader.
- **Screen readers.** The caption overlay is not a live region. With one, a
  screen reader would speak over the narration. Errors are a live region
  (`role="status"`), as the voice readout is
  (`app/src/voice/voice-overlay.ts:23`).
- **Keyboard.** Space: pause or resume. N: next. B: back. Enter: open the
  hotspot at the centre. Esc: close the clip, then leave the guide. The arrow
  keys keep aiming the view (`app/src/input/look.ts:162-175`).
- **Reduced motion** (`prefers-reduced-motion: reduce`, as
  `app/src/layers/seismic-waves/waves.ts:137` reads it): no camera eases, no
  time-lapse, no field-of-view animation. Each becomes a dip to dark and a
  cut. The dip stays. It is a fade, not movement.
- **No sound.** A guide is usable with the sound off: captions carry the
  speech and marks carry the pointing.
- **Images** have alt text and a caption. **Video** has captions.
- **The pointer** says its direction in words.
- **Language.** A guide declares one language. Translations are open (Q8).

Cardboard input, in one table. Every row has a way that needs no voice.

| Action | Viewer button | Gaze | Head gesture | Voice ("Earth, …") |
|---|---|---|---|---|
| Start a guide | Start it before entering the viewer | — | — | "play guide <title>" |
| Pause / resume | Tap, with nothing under the gaze | — | — | "pause", "resume" |
| Next / back / leave | — | Dwell on the pause card's Next, Back, Leave | — | "next", "back", "stop guide" |
| Go on at a `continue` step | Tap | — | Nod | "next" |
| Arrive at a target | — | Look at it | — | — |
| Open a hotspot | Tap, marker under the gaze | Dwell | Nod | "play that" |
| Close a clip | — | Look away | Shake | "stop" |
| Leave Cardboard | Hold (unchanged) | — | — | "exit" |

The **pause card** appears when the guide is paused in Cardboard: three dwell
targets, Back, Resume and Next, with Leave beneath, in the scene where the
user was looking when they paused. It is not a standing menu. Straight down
is the usual place for one in a headset, and straight down is the best view
this app has.

The spyglass keeps first call on the button, the nod, the shake and the head
roll while it is open or a sky name is under the gaze
(`app/src/main.ts:481`, `:626-629`). Order of claim: open spyglass, then a
hotspot under the gaze, then a sky name, then the guide.

## 12. Gaps in the app

Each was checked in the code.

| # | Gap | Evidence | What it needs |
|---|---|---|---|
| 1 | The clock cannot be set or sped up after load. | `AppClock` is `now()` and `pinned` (`app/src/clock.ts:7-11`). The only input is `?time=` (`:14`). | `set(instant)`, `setRate(rate)`, `goLive()`, `isLive()`. The same arithmetic as the core playback clock (`packages/core/src/seismic/index.ts:211-289`); build on it. The seismic timeline keeps its own clock, for the reason its header gives (`app/src/ui/timeline/index.ts:5-10`). |
| 2 | No way to stand somewhere else. | Position comes only from the geolocation callback and the Austin stand-in (`app/src/sensors/index.ts:226-240`, `:243-254`). `SensorController` has no setter (`:74-89`). The only URL parameter the app shell reads is `?time=`. | `standing-place.ts`, read where `main.ts` reads `sensorState.position` today (`app/src/main.ts:369`, `:591`). It must sit outside `sensors/`: the declination that corrects the real compass belongs to the real location (`app/src/sensors/index.ts:234`). |
| 3 | Programmatic aim exists but only jumps, and nothing calls it. | `setAim` (`app/src/input/look.ts:83`, `:231-238`). No caller outside `look.ts`. | The ease (§6.1), and a direction-to-yaw-and-pitch helper in `targets.ts`. `gyroActive` is private (`look.ts:92`); the view control reads the aim mode from `sensors.getAttitude()`. |
| 4 | Layers cannot fade. | `LayerInstance.setVisible` only (`app/src/layers/types.ts:110-111`). Shells are a 0/1 float (`app/src/render/globe.ts:237`). | The dip (§7.1) now. Optional `setOpacity?` and shell fades in phase 5 (§7.2). |
| 5 | No lookup of a name's direction. | `nameNearestViewCenter` and `skyTargetNearViewCenter` consider only labels shown near the centre (`app/src/render/labels.ts:448`, `:454`, `:483`). The label list is private (`:251`). Lazy layers' names exist only once the layer has loaded (`:373`). | Phase 1: `targets.ts` resolves `label` targets from the three baked label files and bodies from the ephemeris. That needs nothing from `LabelLayer`. Phase 5: `LabelLayer.find(name)` over every loaded group, for "find M31". |
| 6 | Applying a preset or a switch overwrites the user's saved view. | `localStorage` writes in `setLayer` and `applyPreset` (`app/src/ui/layers-panel.ts:415`, `:432`). | A borrowed mode on the panel: no writes, and the old switches come back on `end()`. |
| 7 | A layer cannot be loaded ahead of need, and its load cannot be awaited. | `load` is private and starts from `setVisible(true)` (`app/src/layers/manager.ts:42-53`). Failure reaches only the status chip and a callback with an id (`:31`, `:72-76`). | `preload(id): Promise<void>` and a promise from `setVisible`. |
| 8 | `LayerManager.setVisible` ignores an unknown id. | `if (!slot) return;` (`app/src/layers/manager.ts:44`). | The view control goes through `LayersPanel.setLayer`, which throws (`app/src/ui/layers-panel.ts:403`). Make the manager throw too: a silent skip is a defect by this project's rules. |
| 9 | Nothing says which layers show live data. | `LayerDefinition` has no such field (`app/src/layers/types.ts:119-139`). 12 layer files use the `live` status tone. | `readonly live?: true` on `LayerDefinition`. A guide that sets the clock to 2011 with the live weather on would show today's clouds over a 2011 sky. The validator rejects it. |
| 10 | A layer's own controls cannot be driven. | Seismic playback, deep time, ice sheets and the core field each take input only from their own DOM control and a URL parameter read once (`app/src/layers/seismic-waves/waves.ts:76-92`, `:134`, `:180-200`; `deep-time/continents.ts:199`; `ice-sheets-time/slices.ts:75`; `core-field/epochs.ts:63`). | Phase 5: `LayerDefinition.params` (a small schema) and `LayerInstance.setParams?`. The URL parameters become one caller of it. Then a guide can play the Tōhoku earthquake. |
| 11 | The spyglass exists only in Cardboard. | It is updated only when `stereo` (`app/src/main.ts:619`). | Nothing. `look` narrows the camera's field of view elsewhere (§2.5). |
| 12 | The wake word collides with narration. | The wake word is "earth" (`app/src/voice/commands.ts:19`). Heard speech is dropped only while the app's own reply is speaking (`app/src/voice/voice-control.ts:204`, `:244-252`). A narrated sentence that starts "Earth is…" parses as a command, fails, and the app says "I heard…" over the narrator (`app/src/voice/respond.ts:80`). | While narration or a clip plays, the voice adapter accepts only the guide's own commands and drops everything else without a reply. Whether the phone's microphone hears its own speaker enough to matter has to be measured (Q7). |
| 13 | Labels take no taps. | `.place-labels { pointer-events: none }` (`app/index.html`). Pointer events go to the look controller (`app/src/main.ts:455-489`). | The hotspot field tests a tap's direction (§8.3). |
| 14 | No CSP. | `app/public/_headers:1-10`. | §10.3. |
| 15 | Credits come only from layers. | `allCredits(definitions)` (`app/src/ui/credits.ts:73-83`). `docs/DATA-SOURCES.md` is generated from the same. | Guide credits join the in-app list under a "Guides" heading, and the generator writes a guides section. |

One existing practice to flag, not a gap in this design: without a location
fix the app stands in Austin, Texas (`app/src/sensors/index.ts:35`), and says
so in the HUD. A guide's `here` is then Austin. The place chip says so too.

## 13. Phases

Each line is one commit: it compiles, its tests pass, and it can be reverted
alone. Refactors come before the features that need them. Local tests before
each commit, the full suite before each push.

### Phase 1 — one guide, end to end

Ships "Down through the Earth" on desktop and phone: narration, captions,
layers, look, the pointer, the validator. No place, time, Cardboard or clips.

1. `refactor(view)`: add `view/actions.ts` and `createViewControl` with
   `preset` and `layers`; `respond.ts` calls it. No behaviour change.
2. `fix(layers)`: `LayerManager.setVisible` throws on an unknown id.
3. `feat(layers)`: `LayerManager.preload` and an awaitable `setVisible`.
4. `feat(layers)`: borrowed mode on `LayersPanel`: no save, restore on end.
5. `feat(view)`: `targets.ts`: `horizon`, `ground`, `sky`, `body`, `label`
   to a direction. Tested against the ephemeris fixtures.
6. `feat(view)`: `look` and `fov` in manual aim, with the ease; `locate`.
7. `feat(view)`: `mark`.
8. `feat(guides)`: the pointer and arrival (`gaze-guide.ts`), one eye.
9. `feat(guides)`: `guide.schema.json`, `format.ts`, `foldTo`.
10. `test(guides)`: the validator, with one fixture guide for each failure.
11. `feat(guides)`: WebVTT cue parser and the caption overlay.
12. `feat(guides)`: `player.ts`, tested with a fake narration clock.
13. `feat(guides)`: `narration.ts`: the audio element, unlock, preload,
    stall and error.
14. `feat(guides)`: the guide list, play bar, transcript, errors, keys,
    `?guide=`, the harness hook.
15. `feat(credits)`: guide credits in the app's list and in
    `docs:sources`.
16. `content(guides)`: "Down through the Earth": script, narration,
    captions.
17. `docs`: an authoring guide, `docs/guides/AUTHORING.md`.

### Phase 2 — place and time

1. `refactor(clock)`: the app clock on the core playback clock; `?time=`
   unchanged.
2. `feat(clock)`: `set`, `setRate`, `goLive`.
3. `feat(view)`: `standing-place.ts`; `main.ts` reads it.
4. `feat(render)`: the dip to dark.
5. `feat(view)`: `stand` and `time` actions; `restore`; the place and time
   chips.
6. `feat(layers)`: `live` on `LayerDefinition`, set on the live layers; the
   validator rule.
7. `feat(guides)`: reduced motion: cuts for eases and time-lapse.
8. `content(guides)`: a second guide that uses both. "The Sun today", or a
   night at the North Pole.

### Phase 3 — Cardboard

1. `feat(guides)`: captions and errors per eye.
2. `feat(guides)`: the pointer per eye.
3. `feat(view)`: `look` opens the spyglass in stereo.
4. `feat(guides)`: viewer button and nod for the guide, after the spyglass's
   claim.
5. `feat(guides)`: the pause card.
6. `feat(voice)`: guide commands; only those while narration plays.
7. `feat(view)`: the Cardboard time-lapse cap.

### Phase 4 — hotspots and clips

- 4a. `feat(guides)`: `HotspotField`, markers, tap and dwell.
  `feat(guides)`: the clip player, audio and image.
  `feat(view)`: `clip`.
- 4b. `feat(layers)`: the `media-hotspots` layer and its validator rules.
- 4c. `chore(infra)`: the R2 bucket, its domain and CORS; AGENTS.md row.
  `feat(headers)`: the `media-src` policy and its test.
  `feat(guides)`: video on phone and desktop; `guides:put-video`,
  `guides:check-media`.
- 4d. `feat(guides)`: video as a texture in Cardboard.

### Phase 5 — reach

1. `feat(labels)`: `LabelLayer.find(name)`; `label` targets from any loaded
   layer.
2. `feat(layers)`: `params` and `setParams`; seismic playback first.
3. `feat(layers)`: `setOpacity?`; shell fades; `fadeS`.

The voice AI's phases start after phase 3. See
[voice-guide.md](voice-guide.md).

## 14. Open questions

- **Q1. Narration voice.** Recorded by a person, or synthesized ahead of time
  and checked in? Either is a file in the repository. It decides the licence
  line and whether guides sound alike.
- **Q2. Licence for guide content.** The code is MIT and the data keeps its
  publishers' licences (LICENSE-DATA.md). Guide scripts and recordings are
  new works. CC BY 4.0 as the default, with each guide free to choose?
  [voice-guide.md](voice-guide.md) §8 depends on the answer.
- **Q3. Two dev dependencies.** The schema-first plan wants `ajv` to validate
  in tests and `json-schema-to-ts` to derive the types. Neither ships to the
  browser. The other way is types by hand, a schema by hand, and tests to
  hold them together. Which?
- **Q4. Where the guide button goes** on a phone screen that already has the
  HUD, the layers toggle, Cardboard, calibrate, AR and the microphone.
- **Q5. Who uploads video.** A maintainer before merge, as written? That
  makes video guides slower to accept than audio ones.
- **Q6. The full CSP.** Write it now as its own task, or leave `media-src` as
  the only directive? And should the policy move into a `<meta>` tag in
  `index.html`, which GitHub Pages would honour?
- **Q7. Open microphone during narration.** Does a phone in a Cardboard hear
  its own speaker well enough to trigger commands? Measure before phase 3.
  If it does, the choices are a different wake word or no wake listening
  while narration plays.
- **Q8. Translations.** One folder per language, or one guide with several
  narration tracks? Not needed for the first release. The format should not
  block it: `language` is there and `formatVersion` allows a change.
- **Q9. `ARRIVE_DEG`, `ARRIVE_MS`, the 40° look-away, the 10°/s cap.** All
  first guesses. Each needs a session with a phone in the hand and in a
  viewer.
- **Q10. R2 write on the `cloudflare` devkey token.** Needed for phase 4c.
