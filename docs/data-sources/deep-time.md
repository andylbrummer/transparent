# Continents through time: data sources and verification

What the deep-time layer draws, where it comes from and what was checked.
Numbers are as measured on 2026-11-10 (UTC). The slice was planned to also
cover the ice-age Earth and the wandering magnetic pole; the agent building
it was cut off after the first item, so only the plate reconstruction is
here (see "Not built").

## Datasets shipped

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Continents through time (`continents-through-time`, lazy, off by default) | Present-day coastlines (1,691 rings) and continental blocks of a global plate model, each tagged with its plate and the ages it exists for, and each plate's finite rotation at every age back to 1,000 Ma | Merdith, A.S., Williams, S.E., Collins, A.S., Tetley, M.G., Mulder, J.A., Blades, M.L., Young, A., Armistead, S.E., Cannon, J., Zahirovic, S. & Müller, R.D. (2021), Extending full-plate tectonic models into deep time: Linking the Neoproterozoic and the Phanerozoic, Earth-Science Reviews 214, 103477, doi:10.1016/j.earscirev.2020.103477; model files as distributed by EarthByte / GPlates | CC BY 4.0 (the Zenodo record states `cc-by-4.0`; checked through the Zenodo API) | https://doi.org/10.5281/zenodo.13635864 ; files from https://repo.gplates.org/webdav/pmm/merdith2021/ | Baked: `tools/pipeline/generate_deep_time.py` → `app/public/geo/deep-time/plates.bin` (1.18 MB) | Merdith et al. (2021), EarthByte |
| The time control's period names and colours | Eons, eras, periods and epochs with boundary ages and the chart's colours | International Commission on Stratigraphy, International Chronostratigraphic Chart v2024/12; Cohen, K.M., Harper, D.A.T., Gibbard, P.L. & Car, N. (2025), Episodes 48, 105–115, doi:10.18814/epiiugs/2025/025001; machine-readable edition https://github.com/i-c-stratigraphy/chart | CC BY 4.0, as the bake script records; not independently re-read | https://stratigraphy.org/chart | Baked: same script → `timescale.json` (6 kB) | International Commission on Stratigraphy |

Nothing is fetched at run time. The bake needs `pygplates` in the pipeline
venv (see the script's docstring).

## What is a model, and what is derived

- **Everything drawn is a model.** The caption says so and names it. The
  reference frame is palaeomagnetic: latitudes are palaeolatitudes;
  longitude is not constrained by palaeomagnetism and is the model's choice.
  Nothing is drawn beyond the model's 1,000 Ma.
- **Shapes are today's.** The app holds the present-day shapes once and
  turns each plate by its rotation in the vertex shader, so a coastline at
  200 Ma is today's coastline carried back, not a palaeo-shoreline. Each
  piece appears only for the ages the model says that crust exists.
- **Rotations** are sampled every million years and thinned to key ages,
  dropping a key only while interpolation reproduces the dropped samples
  within the script's tolerance; jumps in the rotation file survive as two
  keys a million years apart.
- **Seams.** Edges that lie between two pieces of the same landmass at the
  age shown are not drawn, so Africa is an outline rather than a web of
  block boundaries.
- **"The ground here was at …"** is the palaeolatitude of the crust under
  the user's present position, from the same rotations; over ocean floor
  there is none to give.
- **Supercontinent and ocean names** (Rodinia, Gondwana, Laurussia,
  Pangaea, Panthalassa) are placed at the middle of their member plates as
  the model has them. The age ranges over which each name shows were set by
  hand in `continents.ts` and are not taken from a cited table.
- Deep time is the layer's own state: the sky and every dated layer stay
  at the app clock.

## What was verified

`tools/pipeline/test_deep_time.py` (73 checks, all passing):

- **Against the GPlates Web Service**, an independent evaluation of the
  same model: central India at 8 ages agrees to 0.002°, South Australia at
  6 ages to 0.001°, Germany at 4 ages to 0.007°; stored rotations for
  plates 501 (India), 701 (Africa) and 101 (North America) at 71 and 250 Ma
  equal the service's Euler poles to 0.0007–0.006°.
- **Known history.** Central India (22°N today) stood at 29.7°S at 71 Ma
  and only moved north since (50 Ma −3°, 30 Ma 10°, 10 Ma 17°), at
  15 cm/yr over 71–50 Ma (published rates for the run are 15–20 cm/yr).
  Recife to Cameroon: 50° apart today, 13° at 100 Ma, 4.5° at 130 Ma, shut
  before. Australia's south coast to Wilkes Land: 32° today, 9° at 45 Ma.
- **0 Ma is today's map.** Every rotation is the identity at 0 Ma; 90 % of
  the model's coast points lie within 0.22° of the app's own coastlines
  (the model omits small islands and draws terrane edges).
- Continental fill covers 216 million km² (continental crust today is
  about 210).

`app/src/layers/deep-time/deep-time.test.ts` (8 tests) reads the baked file
through the app's own decoder: places stay put at 0 Ma, Delhi is south of
10°S at 71 Ma, Brazil's corner lies within 10° of Cameroon at 150 Ma, no
crust in mid-Pacific, and the control's snapping, play and period naming.

By eye (`~/review-loop/shots/deep-time/`): at 0 Ma the outlines lie on
today's coasts; at 100 Ma India and Madagascar sit off East Africa and
Australia is joined to Antarctica; at 200 Ma the label reads Pangaea; the
control fits a phone screen above the HUD. Frame time 16.7–16.8 ms at
1280×800 and at 412×892 (device pixel ratio 2) on Intel Iris Xe.

## Notes and gaps

- `plates.bin` is 1.18 MB, over the project's usual 500 kB per file; it is
  a billion years of 1,691 rings and their rotations and loads only when
  the layer is switched on.
- Two thresholds in the data test were the cut-off agent's first guesses
  and were widened by the coordinator to what the data shows (file size
  1.25 MB; up to 90 % of block edges being interior seams). The seam
  figure was judged against the screenshots, not against a reference.
- Not checked: playback while the animation runs (only still ages were
  looked at), the Cardboard stereo view, ages older than 250 Ma by eye,
  keyboard use of the control.
- **Not built:** the Last Glacial Maximum ice sheets and coastline, the
  track of the north magnetic dip pole, sea-level scenarios.
