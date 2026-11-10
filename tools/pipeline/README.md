# Content Pipeline

## Travel-Time Texture

`generate_traveltime.py` generates a 1024×512 three-channel uint16 texture
from the ak135 Earth model using ObsPy TauP:

- **R channel**: direct P (`P`/`p`) arrival times (deciseconds, 0–65534)
- **G channel**: direct S (`S`/`s`) arrival times (deciseconds, 0–65534)
- **B channel**: surface wave (`3.5kmps`) arrival times (deciseconds, 0–65534)
- **Sentinel value** 65535 = no arrival (core shadow)

It is written as raw little-endian uint16, not PNG: browsers decode PNGs to
8 bits per channel before WebGL sees them, which would discard the 16-bit
precision.

X-axis: angular distance 0–180° (1024 samples)
Y-axis: source depth 0–700 km (512 samples)

## Usage

```bash
# Generate texture (requires Python + obspy + numpy)
pip install obspy numpy
python3 tools/pipeline/generate_traveltime.py
# Quick low-resolution run for checking the pipeline end to end
python3 tools/pipeline/generate_traveltime.py --width 128 --height 16

# Test against ObsPy spot checks
python3 tools/pipeline/test_traveltime.py
```

## Output

- `tools/pipeline/output/traveltime.bin` — height × width × 3 uint16 LE, row = depth
- `tools/pipeline/output/traveltime_manifest.json` — metadata + sample arrays

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
  as `outlines.json`.
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
python3 tools/pipeline/test_geology.py
```

## Slabs and Earthquakes

`generate_seismicity.py` downloads Slab2 (Hayes et al. 2018) and the USGS
ComCat catalogue and writes:

- `app/public/geo/slabs.json` — slab-surface depth contours every 40 km down
  to 700 km, grouped by depth, same polyline encoding as `outlines.json`.
- `app/public/geo/quakes.json` — every M5+ earthquake since 1973 at its
  hypocentre and origin time, as columns, oldest first (`minute` as deltas,
  `lon`, `lat` in quanta, `depthKm`, `magnitude10`), plus `quake` labels for
  M8+. Only ComCat type `earthquake` (no nuclear tests, eruptions,
  collapses), without the few dozen events ComCat lists twice; the counts
  left out are in the file (`excluded`). See the script's docstring for the
  licence note on its ISC-GEM records.

The Slab2 archive is 140 MB; `--source-dir` takes its extracted
`Slab2_CONTOURS/` directory and a `usgs_quakes.csv` instead, and
`--only quakes` (or `slabs`) writes just one of the two files.

```bash
python3 tools/pipeline/generate_seismicity.py
python3 tools/pipeline/test_seismicity.py
```

`test_seismicity.py` pins known earthquakes to their ComCat hypocentres,
times and magnitudes (to the file's quantisation, under 1 km) and to the
ISC Bulletin's independent locations (within 30 km), and checks the edges:
the antimeridian, the poles, events above sea level, the excluded types.

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
