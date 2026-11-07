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
  hypocentre, as columns (`lon`, `lat` in quanta, `depthKm`,
  `magnitude10`) sorted by magnitude, plus `quake` labels for M8+.

The Slab2 archive is 140 MB; `--source-dir` takes its extracted
`Slab2_CONTOURS/` directory and a `usgs_quakes.csv` instead.

```bash
python3 tools/pipeline/generate_seismicity.py
python3 tools/pipeline/test_seismicity.py
```

## Assets

Imagery (Blue Marble) is fetched by the app at runtime from NASA GIBS, not
baked. Nothing under `app/public/` is gitignored.
