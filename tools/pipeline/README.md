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
  city (1:110m) names, sorted by Natural Earth's minimum label zoom, which the
  app uses as declutter priority

```bash
python3 tools/pipeline/generate_geo.py
python3 tools/pipeline/test_geo.py
```

These outputs are committed: the Pages deploy runs no pipeline step, so an
uncommitted asset would never ship.

## Assets

Imagery (Blue Marble) is fetched by the app at runtime from NASA GIBS, not
baked. Nothing under `app/public/` is gitignored.
