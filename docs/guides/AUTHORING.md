# Writing a guide

A guide is a narrated tour: a voice talks while the app turns layers on and off, points the view and marks what
it is talking about. This page is how to write one. The design behind it is [spec/guides.md](../../spec/guides.md);
the format's source of truth is [`app/public/guides/guide.schema.json`](../../app/public/guides/guide.schema.json),
which editors read for completion.

The first guide, [Down through the Earth](../../app/public/guides/down-through-the-earth/guide.json), is a complete
working example. Its script is [tools/guides/scripts/down-through-the-earth.md](../../tools/guides/scripts/down-through-the-earth.md).

## The files

```
tools/guides/scripts/<id>.md          the script: what the voice says, one sentence a line (not shipped)
app/public/guides/
  index.json                          the guide ids, in the order the Guides list shows them
  <id>/
    guide.json                        chapters, steps, cues
    audio/<NN-step>.m4a               one narration file per step
    audio/<NN-step>.vtt               its captions
    audio/, images/                   a hotspot's clip files, captions and posters
app/public/media/
  hotspots.json                       the "Stories and clips" layer's hotspots, with their files beside it
```

`<id>` is kebab-case and is the folder's name. Add it to `index.json` to list the guide.

## 1. Write the script

One `## <NN-step>` section per step, one sentence per line. Keep a step to one idea and 15–40 seconds of speech: a
step is what Back and Next move by.

Where the screen and the voice should differ, write `caption || spoken`. The caption shows figures and symbols; the
spoken half spells them out, because the voice can misread `12,742 km` or `°C`:

```
The inner core begins 5,150 km down. || The inner core begins five thousand, one hundred and fifty kilometres down.
```

Lines starting `>` are notes, not spoken. Put your sources there. **Every figure must be one you can cite**, and
preferably one the app already shows: the depth ladder (`app/public/geo/depth-ladder.json`), a layer's baked file,
a label. Nothing is made up here, the same rule as the data.

## 2. Make the narration

The narration is synthesized with [Piper](https://github.com/OHF-Voice/piper1-gpl) and the public-domain LJ Speech
voice, then checked in (spec Q1). Set the tools up once, outside the repository:

```bash
python3 -m venv ~/.cache/transparent-narration/venv
~/.cache/transparent-narration/venv/bin/pip install piper-tts imageio-ffmpeg
mkdir -p ~/.cache/transparent-narration/voices && cd ~/.cache/transparent-narration/voices
for f in en_US-ljspeech-high.onnx en_US-ljspeech-high.onnx.json; do
  curl -LO "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/high/$f"
done
```

Then, from the repository:

```bash
~/.cache/transparent-narration/venv/bin/python tools/guides/narrate.py tools/guides/scripts/<id>.md
```

It writes each step's `.m4a` (AAC-LC, mono, 64 kbit/s) and `.vtt`, and prints each sentence's start time:

```json
{ "step": "07-inner-core", "durationS": 38.24, "sentenceStartsS": [0.3, 9.02, 14.1, 19.49, 28.93, 34.31] }
```

Those times are what the cues in step 3 hang on. Piper varies its delivery a little from run to run, so the times
move by a few tenths of a second each time it runs: after re-running it, read the new times and update the cues.

**Listen to every file before you commit it.** The validator checks the captions' timing, not whether the voice
said the words right; names are where it slips (the script spells *Mohorovičić* as *Mohorovichich* for it).

A recording of a real voice works the same way: one `.m4a` per step, AAC-LC mono, with a `.vtt` you time yourself.

## 3. Write guide.json

```json
{
  "$schema": "../guide.schema.json",
  "formatVersion": 1,
  "id": "<id>",
  "title": "…",
  "summary": "One line for the Guides list.",
  "language": "en",
  "topics": ["geology"],
  "authors": [{ "name": "…" }],
  "licence": "CC BY 4.0",
  "credits": [{ "what": "Script", "source": "…", "licence": "CC BY 4.0", "url": "https://…" }],
  "chapters": [ … ]
}
```

**Licence.** CC BY 4.0 is the default for a guide's script and narration (spec Q2); a guide may choose another.
**Credits** list everything the guide uses that someone made: the script, the voice, any figure you quote. They show
in the app under **Layers → Data credits** and in [docs/DATA-SOURCES.md](../DATA-SOURCES.md) (`npm run docs:sources`).

### Chapters and scenes

A chapter opens with a **scene**: the whole view at its start. It is required, and it is what lets someone skip into
the middle of a guide and see the right thing. Give it exactly one of `preset` (a preset id from the Layers panel,
or `default`) or `layers` (exactly the switches to have on), plus a `look`. It may also give a `place` and a `time`,
as the `stand` and `time` cues below take them; left out, they are here and now.

### Steps

```json
{
  "id": "inner-core",
  "narration": { "audio": "audio/07-inner-core.m4a", "captions": "audio/07-inner-core.vtt" },
  "cues": [
    { "at": 9, "do": "layers", "on": ["shell-inner-core"] },
    { "at": 28.9, "do": "layers", "on": ["inner-core"] }
  ],
  "advance": "auto"
}
```

A step has `narration`, or `silenceS` for a step with no speech. When its narration ends, `advance` says what happens:

| `advance` | Then |
|---|---|
| `auto` | The next step starts. |
| `gaze` | It waits until the user looks at the target of the step's `look` cue. A pointer shows the way; after a while a "Can't find it? Continue" button appears. |
| `continue` | It waits for Next (or a tap on Continue). |

### Cues

A cue is a view action with `at`, seconds from the start of the step's audio. Cues are in time order and within the
audio's length. Take `at` from narrate.py's sentence starts, so a layer appears as the voice names it.

| `do` | Fields | Does |
|---|---|---|
| `layers` | `on`, `off`: switch ids | Turns switches on or off. Ids are the `data-layer` ids in the Layers panel. |
| `preset` | `id` | Sets every switch as a preset does. |
| `look` | `target`, optional `fovDeg` | Turns the view to the target, with an ease. On a phone the guide points instead (the user holds the view). |
| `fov` | `fovDeg` (30 or more) | Zooms. Under 30° a target is needed: use `look` with `fovDeg`. |
| `mark` | `target`, `text` | Puts a marker with a short text on the target; `text: null` takes it down. |
| `stand` | `place` | Stands the view somewhere else: `{"kind": "here"}`, `{"kind": "antipode"}`, or `{"kind": "at", "lat", "lon", "name"}`. A chip names the place. |
| `time` | `to`, optional `rate`, `until` | Sets the clock: `to` is an ISO 8601 instant or `"now"`; `rate` is simulated seconds a second (0 stops it); `until` stops it there. A chip shows the time. |
| `clip` | `hotspot`: an id, or `null` | Opens that hotspot's clip, as a tap on its marker would; `null` closes the clip that is open. The hotspot must be in this step or an earlier step of the chapter. |

A change of place, a jump in time or a preset goes dark for a moment and comes back changed, rather than sweeping.

**Time-lapse.** A `rate` above 60 must give `until`: with reduced motion the clock jumps straight there. In Cardboard
the clock runs no faster than 2,400 times real time, whatever the guide asks (spec §7.3). A layer of today's data
(marked live in the Layers panel's code, such as the aurora forecast) cannot be on while the time is away from now.
[A night at the North Pole](../../app/public/guides/a-night-at-the-north-pole/guide.json) uses both.

Targets:

| `kind` | Fields | Is |
|---|---|---|
| `horizon` | `azDeg`, `altDeg` | A direction from where the user stands. `altDeg: -90` is straight down, through the Earth. |
| `ground` | `lat`, `lon`, optional `depthKm`, `name` | A place on or in the Earth. |
| `label` | `name`, optional `labelKind` | A name from `geo/labels.json`, `geology.json` or `quakes.json`, exactly as written there. |
| `body` | `body` | The Sun, the Moon or a planet, where it is now. |
| `sky` | `raDeg`, `decDeg`, optional `name`, `extentDeg` | A fixed point on the sky. |

The guide plays wherever the user is, so write for any place: "straight down", not "under Texas".

### Hotspots and clips

A hotspot hangs a clip on something in the view: a marker, "▶ How we know: wave paths", that opens a short
recording, a picture or a film when it is tapped, stared at in Cardboard, or chosen with Enter. Add them to a step:

```json
"hotspots": [
  {
    "id": "wave-paths",
    "title": "How we know: wave paths",
    "anchor": { "kind": "horizon", "azDeg": 0, "altDeg": -72 },
    "layer": "shell-core",
    "clip": {
      "kind": "image",
      "src": "images/seismic-wave-paths.webp",
      "alt": "A cross-section of the Earth with the curving paths of waves from one earthquake.",
      "caption": "Waves bend at each layer; S waves cannot cross the liquid outer core.",
      "credit": { "what": "Diagram of earthquake wave paths", "source": "U.S. Geological Survey", "licence": "public domain", "url": "https://pubs.usgs.gov/gip/interior/" }
    }
  }
]
```

- `id` is unique in the guide, kebab-case: a `clip` cue names it. `title` is at most 60 characters; it stands among
  the map's names.
- `anchor` is a target, as for `look`. A `label` anchor must be a name that exists.
- `layer`, optional: the marker shows only while that switch is on.
- A step's hotspots show from that step to the end of its chapter.

Opening a clip pauses the guide; closing it, or the clip ending, lets the guide go on where it stopped. One thing
speaks at a time. A clip closes with its × button, Esc, a shake in Cardboard, or a `clip` cue with `hotspot: null`;
looking 40° away from it for 3 s in Cardboard pauses a recording or a film and puts a picture away.

| `kind` | Fields | Shows |
|---|---|---|
| `audio` | `src` (`.m4a`), `captions` (`.vtt`) | A title, a play/pause button, a progress bar and captions. Held to the narration's rules: AAC-LC mono, at most 96 kbit/s and 5 MiB. |
| `image` | `src` (`.webp` or `.jpg`), `alt`, `caption` | A panel over the lower half, with the caption under it; `alt` is what a screen reader says. At most 1 MiB and 2048 px on its long side. |
| `video` | `src` (a URL on the media host), `captions`, `poster`, `video` | The browser's own player in the same panel, with the app's captions over it. See below. |

Every clip has a `credit`, as the guide's credits have, and like everything else here the media must be real and
licensed: a public-domain or openly licensed picture, recording or film, credited to whoever made it. Nothing is
generated or made up. Each credit goes into `docs/DATA-SOURCES.md` with `npm run docs:sources`.

In Cardboard, a picture or a film is drawn as a flat panel 40° wide where its marker was when it opened, and it stays
there as the head turns.

### The "Stories and clips" layer

Hotspots that belong to no guide live in `app/public/media/hotspots.json`, with their files in
`app/public/media/`. The "Stories and clips" switch in the Labels section of the Layers panel shows them with no guide
playing. The file is `{ "formatVersion": 1, "language": "en", "hotspots": [ … ] }`, each hotspot exactly as in a
step. The validator checks it with the guides.

### Video

A film is too large for the repository and for the site's 25 MiB file cap, so it lives on the media host,
`https://media.transparent.sbdev.io`, under a name that carries its hash. Its captions and poster stay in the
guide's folder. The file must be H.264 with AAC sound in an `.mp4`, at most 1080p either way up and 200 MiB.

```json
"clip": {
  "kind": "video",
  "src": "https://media.transparent.sbdev.io/guides/<id>/wave-paths.a0306900.mp4",
  "captions": "audio/wave-paths.vtt",
  "poster": "images/wave-paths-poster.webp",
  "video": { "bytes": 16898239, "sha256": "a0306900…", "durationS": 90.006, "width": 1280, "height": 720 },
  "credit": { … }
}
```

Never write `src` or `video` by hand. `npm run guides:put-video -- --dry-run <id> film.mp4` reads the file and
prints both. Open the pull request with them, and a maintainer uploads the same file before merging. The steps and
the host's setup are in [VIDEO.md](VIDEO.md). The validator holds the `src` to the guide's own folder on the host
(`media/` for the layer), the name's hash to `sha256`, and the captions to `durationS`. It cannot see the host:
`npm run guides:check-media` fetches each film and checks it is what the guide says.

## 4. Check it

```bash
npm test                     # the validator runs with the tests: app/src/guides/guides.test.ts
npm run docs:sources         # the guide's credits into docs/DATA-SOURCES.md
npm run dev                  # then open http://localhost:5173/?guide=<id>
```

The validator fails the build on: a guide that does not match the schema; `index.json` and the folders disagreeing;
a layer, preset or label that does not exist; two switches of one exclusive group on together; cues out of order or
past the audio's end; a `gaze` step without a `look`; a missing, unused or oversized file; captions out of order,
overlapping, longer than 37 characters a line or 2 lines a cue, or leaving more than 3 s of speech uncaptioned; a
missing licence, author or credit. For hotspots: an id used twice; a `clip` cue naming a hotspot not shown by then; a
layer or label anchor that does not exist; a clip file missing, oversized, or not the format its name says; an image
over 2048 px; a film off the media host, outside its folder, over 1080p, or named by a hash that is not its own.

Budgets: narration `.m4a` AAC-LC mono, at most 96 kbit/s and 5 MiB a file; a guide's folder at most 20 MiB. The audio stays in the repository's history for good, so keep it
small.

`?guide=<id>&step=<chapter>/<step>` (counted from 1) opens a guide at a step, which is quicker for checking the end.
Play it once on a phone as well as a desktop: on a phone the guide points rather than turning the view.
