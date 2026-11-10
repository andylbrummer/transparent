# Content Pipeline

## Seismic Wavefronts

`generate_seismic_waves.py` bakes what the "Seismic waves" layer plays: where
the P and S wavefronts of an earthquake are, inside the Earth, at every moment.
(It replaces `generate_traveltime.py`, whose depth × distance texture held the
first direct P and S only: nothing arrived past 98°, and it said nothing about
the interior.)

The Earth model is ak135 (Kennett, Engdahl & Buland 1995), radial, traced with
ObsPy TauP. For each of nine source depths (0, 12, 30, 60, 150, 300, 450, 600,
700 km) it shoots a fan of 464 rays by take-off angle - PKIKP, PKP, P and the
upgoing p; the S that strikes the core (kept as far as the core, where it
ends), S and s - and stores each ray's radius and angular distance every 20 s.
The front at a time is the curve through the rays at that time, turned about
the source's axis; the app does that in a vertex shader.

- `app/public/geo/seismic-waves.bin` (1.35 MB) - per depth, 78 × 464 texels of
  two uint16 (radius, distance), then three float32 arrays: when and where
  each ray reaches the surface, and its take-off angle
- `app/public/geo/seismic-waves.json` - the layout, the branches, the
  diffracted-phase ranges (Pdiff, Sdiff), the surface-wave group speeds
  (PREM, Dziewonski & Anderson 1981, Table V) and two deep earthquakes from
  USGS ComCat
- `app/src/layers/seismic-waves/taup.fixture.ts` - TauP's own answers at
  depths and times that are not baked, for the app's tests

```bash
python3 -m venv tools/pipeline/.cache/venv
tools/pipeline/.cache/venv/bin/pip install obspy numpy
tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_seismic_waves.py   # about a minute
tools/pipeline/.cache/venv/bin/python tools/pipeline/test_seismic_waves.py
```

`test_seismic_waves.py` checks the bake against three things: Kennett's
published ak135 travel-time tables (ANU, surface focus), an independent
integration of the ray integrals through the ak135 velocity table as ANU
publishes it (deep sources, shadow edges, the front on the axis through the
centre), and TauP asked by distance.

## Outlines and Labels

`generate_geo.py` downloads Natural Earth (public domain) and writes what the
app draws on the far-side surface. Standard library only.

- `app/public/geo/outlines.json` — coastlines, country borders and
  state/province lines (1:50m), quantized to 0.01° and delta-encoded as flat
  integer arrays `[lon0, lat0, dlon1, dlat1, ...]` in hundredths of a degree
- `app/public/geo/labels.json` — country (1:110m), state/province (1:50m) and
  city (1:110m) names, sorted by kind (countries, states, cities) and then by
  Natural Earth's minimum label zoom; the app declutters in that order

```bash
python3 tools/pipeline/generate_geo.py
python3 tools/pipeline/test_geo.py
```

These outputs are committed: the Pages deploy runs no pipeline step, so an
uncommitted asset would never ship.

## Tectonics and Geology

`generate_geology.py` downloads plate boundaries, active faults, hotspots and
volcanoes, adds a short curated list of deep-Earth structures, and writes:

- `app/public/geo/tectonics.json` — PB2002 plate boundaries split into
  `subduction`, `ridge` (spreading ridges and rifts), `transform` and
  `collision`, plus GEM active faults by mechanism (`fault-normal`,
  `fault-reverse`, `fault-strike-slip`), simplified to 0.02°. Same encoding
  as `outlines.json`. Beside the lines it carries what PB2002 says of them:
  `ridgeSteps` (per step of each `ridge` polyline, the plates' relative
  speed in tenths of mm/yr and its azimuth - the app's spreading ribbons
  and arrows) and `subductionOverriding` (per `subduction` polyline, +1 if
  the overriding plate is on the left of its direction, -1 if on the right
  - the side the trench's teeth go).
- `app/public/geo/geology.json` — labels for plates, deep structures (with a
  `depthKm`), hotspots, subduction zones and volcanoes, sorted by kind and
  then priority.
  It also carries `plumes`: a conduit under each hotspot whose plume class
  makes a depth claim, from the surface to `depthKm` (and on to
  `possibleDepthKm` where the class may reach the core-mantle boundary).

Faults are drawn but not named (GEM's names are local segment names), and
deep-structure positions are approximate centres from the cited papers.
Licences differ per source; `app/public/geo/ATTRIBUTION.md` carries them.

```bash
python3 tools/pipeline/generate_geology.py
python3 tools/pipeline/test_geology.py      # reads slabs.bin too: teeth against Slab2
```

`test_geology.py` also pins spreading rates to PB2002's own figures (22.6
mm/yr on the Mid-Atlantic Ridge at 30 N, 148 on the East Pacific Rise at
20 S) and checks every trench's polarity against Slab2: wherever a slab
lies shallow on just one side of a trench, the teeth must point to it.

## Slabs

`generate_slabs.py` downloads Slab2 (Hayes et al. 2018; 140 MB, kept in
`.cache/slab2/`) and writes `app/public/geo/slabs.bin`: for each of the 27
slabs its depth grid sampled every 0.2° (0.1° for the eight the coarser
step would bend by more than 2.5 km at the 99th percentile or 5 km
anywhere), with the plate's thickness and each node's distance from the
slab's edge, from which the app builds closed plates. The layout is in the
script's docstring. The bake measures its own error against every source
node and writes it into the header: at worst 0.9 km rms, 2.3 km at the
99th percentile, 6.7 km at one node on a near-vertical edge.

Needs h5py and scipy, which the system Python lacks:

```bash
python3 -m venv tools/pipeline/.cache/venv
tools/pipeline/.cache/venv/bin/pip install numpy h5py scipy pillow
tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_slabs.py
python3 tools/pipeline/test_slabs.py
```

`test_slabs.py` pins the baked depths and thicknesses to values read from
the source grids (the slab 68 km under Tokyo, 50 km under Seattle, 578 km
under the Lau Basin) and checks the layout through its own reader,
`slab_file.py`.

## Seafloor Age

`generate_seafloor_age.py` (same venv) downloads the 6-arc-minute age grid
of Seton et al. (2020) from EarthByte (CC BY 4.0) and writes
`app/public/geo/seafloor-age.png`, 2048×1024 equirectangular: red is
`255 * sqrt(age / 340 Myr)`, green the share of the pixel that is ocean
crust, no alpha channel. The app colours it in the shader.

```bash
tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_seafloor_age.py
python3 tools/pipeline/test_seafloor_age.py
```

## Earthquakes

`generate_seismicity.py` downloads the USGS ComCat catalogue and writes:

- `app/public/geo/quakes.json` — every M5+ earthquake since 1973 at its
  hypocentre and origin time, as columns, oldest first (`minute` as deltas,
  `lon`, `lat` in quanta, `depthKm`, `magnitude10`), plus `quake` labels for
  M8+. Only ComCat type `earthquake` (no nuclear tests, eruptions,
  collapses), without the few dozen events ComCat lists twice; the counts
  left out are in the file (`excluded`). See the script's docstring for the
  licence note on its ISC-GEM records.

`--source-dir` takes a `usgs_quakes.csv` instead of fetching. `--only
quakes` is still accepted, from when this script baked the slabs too.

```bash
python3 tools/pipeline/generate_seismicity.py
python3 tools/pipeline/test_seismicity.py
```

`test_seismicity.py` pins known earthquakes to their ComCat hypocentres,
times and magnitudes (to the file's quantisation, under 1 km) and to the
ISC Bulletin's independent locations (within 30 km), and checks the edges:
the antimeridian, the poles, events above sea level, the excluded types.

## Recent and Notable Earthquakes

`generate_quake_sets.py` writes two small files from USGS:

- `app/public/geo/quakes-recent-snapshot.json` — the real-time feeds the
  "Recent earthquakes (live)" layer reads (M4.5+ past 30 days, M2.5+ past
  7 days), merged, as they stood at bake time, in the feeds' own GeoJSON
  shape. The app falls back on it, marked stale with its date, when USGS
  cannot be reached. Re-run before a release so the fallback is not ancient.
- `app/public/geo/quakes-notable.json` — every M8.5+ earthquake since 1900
  and the smaller presets of `spec/seismic.md` (San Francisco 1906,
  Türkiye 2023), from ComCat by event id. Pre-1973 locations are ISC-GEM's
  (CC BY-SA 3.0); each event records its location source.

```bash
python3 tools/pipeline/generate_quake_sets.py            # or --only recent / --only notable
python3 tools/pipeline/test_quake_sets.py
```

## Plate Motion

`generate_plate_motion.py` writes `app/public/geo/plate-motion.json`: an
arrow on each of ~1650 evenly spread points showing where the plate under it
moves in 3 Myr, in the NNR-MORVEL56 no-net-rotation frame (Argus, Gordon &
DeMets 2011). Each point is assigned to the plate whose MORVEL56 outline
contains it, and moves by that plate's angular velocity. One polyline per
arrow — base, tip, barb, tip, barb — in the `outlines.json` encoding.

Poles and outlines come from the `platemotion` wheel on PyPI;
`--source-dir` takes its `platemotion/data/` directory instead.

```bash
python3 tools/pipeline/generate_plate_motion.py
python3 tools/pipeline/test_plate_motion.py
```

## Mantle Flow

`generate_mantle_flow.py` writes `app/public/geo/mantle-flow.json`: flow
velocity (east, north, up) on ~1100 points at each of 300, 1450 and 2750 km
depth. It is an instantaneous flow model, not data: the `hc` solver
(Hager & O'Connell 1981) driven by SEMUCB-WM1 tomography, with the
Steinberger & Holme (2008) viscosity profile and density scaling, and the
NNR-MORVEL56 plates moving the surface. The flow follows those choices;
change them in the script's constants.

`hc` is GPL-2.0 and runs only here, as a tool; none of it ships. Build it
once at the pinned commit (`HC_COMMIT`), plus `sh_ana`, which the no-GMT
target leaves out although it needs no GMT:

```bash
git clone https://github.com/geodynamics/hc /path/to/hc
git -C /path/to/hc checkout 7bb6d0385d88e25510f5e4646e835d8b018f2073
make -C /path/to/hc all_no_gmt ADD_FLAGS=-DNO_GMT
cc -DNO_GMT -DNO_RICK_FORTRAN -I/path/to/hc/src -c /path/to/hc/src/sh_ana.c -o /path/to/hc/objects/sh_ana.o
cc -L/path/to/hc/objects /path/to/hc/objects/sh_ana.o -o /path/to/hc/bin/sh_ana -lhc -lrick /path/to/hc/objects/prem_util.o -lm

python3 tools/pipeline/generate_mantle_flow.py --hc-dir /path/to/hc
python3 tools/pipeline/test_mantle_flow.py
```

## Assets

Imagery (Blue Marble) is fetched by the app at runtime from NASA GIBS, not
baked. Nothing under `app/public/` is gitignored.

## Deep Sky and All-Sky Maps

`generate_deepsky.py` bakes sixteen catalogues of the faint and invisible
sky (Messier/NGC/IC objects, X-ray and gamma-ray sources, pulsars,
exoplanet hosts, the nearest stars, galaxies, clusters, quasars, the 2MASS
Redshift Survey...) into `app/public/sky/deep/`. Standard library only;
`sky_catalog_support.py` holds the HEASARC / VizieR / SIMBAD readers and
the B1950 → J2000 precession.

`generate_skymaps.py` bakes twelve all-sky maps (radio, 21 cm, the
microwave background from COBE, WMAP and Planck, infrared, H-alpha,
X-rays, gamma rays, galaxy density) into `app/public/sky/maps/` as
2048×1024 plate carrées in galactic coordinates. It needs healpy and
astropy, and downloads 3 GB of source maps into the cache.

```bash
python3 tools/pipeline/generate_deepsky.py
python3 tools/pipeline/test_deepsky.py

python3 -m venv tools/pipeline/.cache/venv
tools/pipeline/.cache/venv/bin/pip install numpy pillow astropy healpy
tools/pipeline/.cache/venv/bin/python tools/pipeline/generate_skymaps.py
tools/pipeline/.cache/venv/bin/python tools/pipeline/test_skymaps.py
```

Sources, licences and what the checks pin down:
`docs/data-sources/deep-sky.md`.

## Every script

One line per bake script, from its own docstring, which also gives its
sources, licences and any extra Python packages it needs (those go in a venv
under `tools/pipeline/.cache/venv`). Raw downloads are cached in the ignored
`tools/pipeline/.cache/`. Sources and licences for everything are indexed in
`docs/DATA-SOURCES.md`.

| Script | What it bakes | Writes | Data test |
| --- | --- | --- | --- |
| `generate_air.py` | Airports and air routes | `app/public/geo/air-routes.json`, `app/public/geo/airports.json` | `test_air.py` |
| `generate_antarctic_ice.py` | Bake the thickness of the Antarctic ice and the shape of the land under it, from Bedmap3 | `app/public/geo/antarctic-bed.png`, `app/public/geo/antarctic-ice-thickness.png`, `app/public/geo/antarctic-ice.json` | `test_antarctic_ice.py` |
| `generate_base_map.py` | An offline copy of the base map | `app/public/geo/blue-marble.jpg` | `test_base_map.py` |
| `generate_cables.py` | Undersea communication cables | `app/public/geo/cables.json` | `test_cables.py` |
| `generate_constellations.py` | The constellations | `app/public/sky/constellations.json` | `test_constellations.py` |
| `generate_craters.py` | Impact craters | `app/public/geo/craters.json` | `test_craters.py` |
| `generate_cyclones.py` | Bake the tracks of the world's major tropical cyclones for the app | `app/public/geo/cyclone-live-snapshot.json`, `app/public/geo/cyclone-tracks.bin`, `app/public/geo/cyclone-tracks.json` | `test_cyclones.py` |
| `generate_deep_time.py` | The continents through deep time | `app/public/geo/deep-time/plates.bin`, `app/public/geo/deep-time/timescale.json` | `test_deep_time.py` |
| `generate_deepsky.py` | The faint and invisible sky | `app/public/sky/deep/` | `test_deepsky.py` |
| `generate_depth_ladder.py` | The depth ladder | `app/public/geo/depth-ladder.json` | `test_depth_ladder.py` |
| `generate_earth_fields.py` | Global geophysical fields | `app/public/geo/fields/` | `test_earth_fields.py` |
| `generate_fireballs.py` | Fireballs (bolides) | `app/public/geo/fireballs.json` | `test_fireballs.py` |
| `generate_geo.py` | Map outlines and place labels | `app/public/geo/labels.json`, `app/public/geo/outlines.json` | `test_geo.py` |
| `generate_geology.py` | Tectonics and geology labels | `app/public/geo/ATTRIBUTION.md`, `app/public/geo/geology.json`, `app/public/geo/tectonics.json` | `test_geology.py` |
| `generate_hazards_snapshot.py` | Snapshot of current natural events | `app/public/geo/hazards-snapshot.json` | `test_hazards_snapshot.py` |
| `generate_ice.py` | Bake the ice layers: where the land ice is, and where the sea ice ends | `app/public/geo/ice-mask.png`, `app/public/geo/ice.json`, `app/public/geo/sea-ice-extent.json` | `test_ice.py` |
| `generate_landmarks.py` | Landmarks people point at | `app/public/geo/landmarks.json` | `test_landmarks.py` |
| `generate_lunar_series.py` | The lunar theory's periodic terms |  | — |
| `generate_mantle_flow.py` | Mantle flow | `app/public/geo/mantle-flow.json` | `test_mantle_flow.py` |
| `generate_meteor_showers.py` | The year's meteor showers - where each radiant is on the sky, when it is active, when it peaks and how strong it usually is | `app/public/space/meteor-showers.json` | `test_meteor_showers.py` |
| `generate_meteorites.py` | Meteorites | `app/public/geo/meteorites.json` | `test_meteorites.py` |
| `generate_milkyway.py` | The Milky Way | `app/public/sky/milkyway.jpg` | `test_milkyway.py` |
| `generate_moon.py` | The face of the Moon | `app/public/sky/moon.jpg` | `test_moon.py` |
| `generate_neo_approaches.py` | Asteroids passing close to the Earth - every known approach within 10 lunar distances from PAST_DAYS before the bake to FUTURE_DAYS after it, each with a short table of where it is around its closest approach | `app/public/sky/neo-approaches.json` | `test_neo_approaches.py` |
| `generate_ocean_currents.py` | Ocean surface currents | `app/public/geo/ocean-currents.bin` | `test_ocean_currents.py` |
| `generate_overlay_snapshot.py` | Bake the one Earth overlay that never changes, for when NASA GIBS cannot be reached | `app/public/geo/overlay-lightning.png` | `test_overlay_snapshot.py` |
| `generate_plate_motion.py` | Plate motion arrows | `app/public/geo/ATTRIBUTION.md`, `app/public/geo/plate-motion.json` | `test_plate_motion.py` |
| `generate_power_plants.py` | The world's large power plants | `app/public/geo/power-plants.json` | `test_power_plants.py` |
| `generate_quake_sets.py` | Two small earthquake sets | `app/public/geo/quakes-notable.json`, `app/public/geo/quakes-recent-snapshot.json` | `test_quake_sets.py` |
| `generate_satellite_fixture.py` | Reference values for the satellite layers' tests: where three satellites are at one instant, worked out by a second implementation | `app/public/space/gp/` | — |
| `generate_satellites_snapshot.py` | A snapshot of satellite orbits for offline use | `app/public/space/gp/` | `test_satellites_snapshot.py` |
| `generate_seafloor_age.py` | The age of the ocean floor | `app/public/geo/seafloor-age.png` | `test_seafloor_age.py` |
| `generate_seismic_waves.py` | Seismic wavefronts inside the Earth | `app/public/geo/seismic-waves.bin`, `app/public/geo/seismic-waves.json` | `test_seismic_waves.py` |
| `generate_seismicity.py` | Earthquakes at depth | `app/public/geo/ATTRIBUTION.md`, `app/public/geo/quakes.json` | `test_seismicity.py` |
| `generate_ship_density.py` | Where the world's ships go | `app/public/geo/ship-density.jpg` | `test_ship_density.py` |
| `generate_skymaps.py` | All-sky maps beyond visible light | `app/public/sky/maps/` | `test_skymaps.py` |
| `generate_slabs.py` | Subducting slabs as surfaces | `app/public/geo/ATTRIBUTION.md`, `app/public/geo/slabs.bin` | `test_slabs.py` |
| `generate_small_bodies.py` | The small bodies of the solar system - dwarf planets, the brightest asteroids, the comets predicted to be within reach of a small telescope, and a cloud of some forty thousand minor planets that draws the main belt, the Hildas, Jupiter's Trojans and the Kuiper belt | `app/public/sky/small-bodies-cloud.bin`, `app/public/sky/small-bodies-cloud.json`, `app/public/sky/small-bodies.json` | `test_small_bodies.py` |
| `generate_space_weather_snapshot.py` | A snapshot of space weather for offline use | `app/public/space/` | `test_space_weather_snapshot.py` |
| `generate_spacecraft.py` | Where the spacecraft beyond Earth orbit are - the observatories at the Sun-Earth L1 and L2 points and the probes in deep space - as a table of geocentric directions and distances | `app/public/space/spacecraft.json` | `test_spacecraft.py` |
| `generate_stars.py` | The naked-eye stars | `app/public/sky/stars.json` | `test_stars.py` |
| `generate_sun_snapshot.py` | A snapshot of the Sun for offline use | `app/public/sky/sun/` | `test_sun_snapshot.py` |
| `generate_tomography.py` | Seismic tomography | `app/public/geo/tomography/dvs-` | `test_tomography.py` |
| `generate_tomography_bodies.py` | The slow bodies of the lower mantle, in three dimensions | `app/public/geo/tomography-bodies-slow.bin` | `test_tomography_bodies.py` |
| `generate_transients.py` | Bake the transient and multi-messenger sky: things that happened once, at a known time, somewhere on the celestial sphere | `app/public/sky/transients/` | `test_transients.py` |
| `generate_tsunamis.py` | Historical tsunamis | `app/public/geo/tsunamis.json` | `test_tsunamis.py` |
| `generate_ulvz.py` | Ultra-low velocity zones (ULVZs) on the core-mantle boundary | `app/public/geo/ulvz.json` | `test_ulvz.py` |
| `generate_undersea.py` | The named features of the seabed | `app/public/geo/undersea.json` | `test_undersea.py` |
| `generate_volcanoes.py` | Volcanoes as data | `app/public/geo/volcanoes.json` | `test_volcanoes.py` |
| `generate_vsop87.py` | The planetary theory |  | — |
| `generate_waters.py` | Rivers, lakes and sea ports | `app/public/geo/ports.json`, `app/public/geo/waters.json` | `test_waters.py` |
| `generate_weather_snapshot.py` | The weather layers' offline snapshot | `app/public/weather/` | `test_weather_snapshot.py` |

Tests without a script of the same name: .
