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

## Assets

Baked assets (Blue Marble, Black Marble, plate boundaries) go in
`app/public/assets/` and are gitignored. Regenerate via pipeline scripts.
