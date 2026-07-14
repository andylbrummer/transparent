# Weather System — Live Overlays on the Globe

## Visualization

- **Clouds:** latest global true-color/IR composite draped slightly above the
  surface shell (+10 km true; exaggerated to ~+80 km legibility toggle).
- **Precipitation:** radar/satellite-merged rain-rate tiles as animated overlay
  (past 2 h loop, optional +6 h forecast loop).
- **Wind:** GPU particle streamlines (≈ 20 k particles) advected by GFS wind
  field at selectable pressure level (10 m, 500 hPa, 250 hPa jet stream).
- **Day/night terminator** with city-lights night texture, computed from real
  sun position at current UTC.
- Optional temperature shading layer.

## Modules

- `TileStreamer` — WMTS/XYZ tile fetch, LRU cache (disk + RAM), retry with
  visible failure (no stale-data masquerade).
- `CloudLayer`, `PrecipLayer` — draped composites over the surface shell.
- `WindLayer` — GPU particle advection from a GFS grid texture (downsampled ~1°).

## Data

| Data | Source | Refresh | Notes |
|---|---|---|---|
| Live true-color/IR clouds | NASA GIBS (GOES/Himawari/VIIRS composites) WMTS | 10–60 min | Tile streaming, cached |
| Precipitation | RainViewer API (global radar composite) | 10 min | Free tier; attribution required; verify quota — fallback to GIBS precip product |
| Wind / temperature | NOAA GFS 0.25° via NOMADS (or Open-Meteo API for simplicity) | 6 h model, hourly interp | Downsampled to ~1° grid texture |

All weather is optional-degradable: no internet → layer toggles show a labeled
"offline" chip. Never silently substitute fake data.

Acceptance sanity check (M5): live precip overlay matches current radar for the
user's region.
