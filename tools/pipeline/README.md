# Content Pipeline

## Travel-Time Texture

`generate_traveltime.py` generates a 1024×512 16-bit RGB PNG texture from the
ak135 Earth model using ObsPy TauP:

- **R channel**: P-wave arrival times (deciseconds, 0–65534)
- **G channel**: S-wave arrival times (deciseconds, 0–65534)
- **B channel**: Surface wave arrival times (deciseconds, 0–65534)
- **Sentinel value** 65535 = no arrival (core shadow)

X-axis: angular distance 0–180° (1024 samples)
Y-axis: source depth 0–700 km (512 samples)

## Usage

```bash
# Generate texture (requires Python + obspy + numpy + pillow)
pip install obspy numpy pillow
python3 tools/pipeline/generate_traveltime.py

# Test against ObsPy spot checks
python3 tools/pipeline/test_traveltime.py
```

## Output

- `tools/pipeline/output/traveltime.png` — 16-bit RGB texture
- `tools/pipeline/output/traveltime_manifest.json` — metadata + sample arrays

## Assets

Baked assets (Blue Marble, Black Marble, plate boundaries) go in
`app/public/assets/` and are gitignored. Regenerate via pipeline scripts.
