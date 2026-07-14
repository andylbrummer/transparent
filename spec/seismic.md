# Seismic System — Earthquake Playback & Wave Visualization

## Visualization

- **Events:** glowing point at true hypocenter (lat, lon, depth). Size/color by
  magnitude (log scale); recent events pulse.
- **P-waves:** expanding translucent wavefront surfaces through the interior,
  positions driven by ak135 travel-time tables (precomputed 2-D depth×distance
  texture, sampled in shader). Rendered as isochron shells — blue-white.
- **S-waves:** slower wavefront, warmer color, **terminates at the outer core
  boundary** (liquid — no shear) leaving a visible S-wave shadow zone: this is a
  key teaching moment and must read clearly.
- **Surface waves:** ring ripple expanding along the sphere surface from the
  epicenter, amplitude decaying, with slight vertex displacement on the surface mesh.
- **Shadow zones:** optional overlay shading the 104°–140° P shadow.
- Playback engine time-compresses real propagation (a P-wave takes ~20 min to
  cross the Earth; default compression 60×).

## Playback data flow

1. `CatalogClient` fetches events from the USGS FDSN Event API →
   normalized `EventRecord { id, t0, lat, lon, depthKm, mag, name }` → SQLite cache.
2. User selects range → `PlaybackClock` maps wall time → simulation time
   (scrubber, pause, speed 1 s = 1 min … 1 s = 1 year).
3. Per frame, `WaveRenderer` computes for each active event the elapsed
   propagation time; shader samples the travel-time texture to draw the isochron
   surface (the set of interior points where the wave is "now").
4. Surface-wave ripple driven by same clock; event points fade per age.

Active-event budget: ≤ 8 simultaneous wavefront events; oldest culled first.

## Data

| Data | Source | Refresh |
|---|---|---|
| Earthquake catalog | USGS FDSN Event API (GeoJSON), free, no key | 5 min poll live; on-demand historical. Magnitude ≥ 4.5 global default; regional smaller quakes on request. |
| Travel times | ak135 (or IASP91) tables → 2-D texture (source depth × angular distance → P, S, surface arrival times), generated with ObsPy TauP in the content pipeline | Baked at build time |
| Offline fallback | Bundled curated set (~200 notable events) | Shipped with app |

Notable-event presets: 2011 Tōhoku, 2004 Sumatra, 1960 Valdivia, 1906 San
Francisco, 2023 Türkiye–Syria.

Acceptance sanity check (M4): Tōhoku 2011 playback — P-wave reaches antipode in
~20 min sim-time; S-wave shadow beyond ~104° visible and correct.
