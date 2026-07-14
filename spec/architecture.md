# Architecture

## Engine & SDK

- **Phase 1 (web/phone):** Three.js + WebXR, TypeScript — see
  [mobile.md](mobile.md). Platform-agnostic `core/` TypeScript package
  (geodesy math, catalog client, playback clock, tile streaming) built here
  and reused as the reference implementation for Phase 2 ports.
- **Phase 2 (Quest):** Unity 6 (URP) + Meta XR Core SDK + MR Utility Kit (MRUK).
  Rationale: best-supported passthrough/stencil-portal path on Quest, Depth API
  optional, OpenXR-based, large geospatial shader ecosystem.
- Companion app (Phase 2): React Native / Expo — see [companion-app.md](companion-app.md).
- Render settings and budgets: Quest in [platform.md](platform.md), phone in
  [mobile.md](mobile.md).

## Module breakdown (headset app)

```
app/
├── PortalSystem        — MRUK floor anchor, stencil mask mesh, edge shader,
│                          wall-porthole variant, safety grid
├── GeoFrame            — WGS84/ECEF math, floating origin, ENU alignment,
│                          heading calibration state machine, persistence
├── CompanionLink       — QR session issue, LAN WebSocket listener, relay
│                          fallback client, location/heading-sync protocol
├── EarthRenderer       — surface shell, interior shells (PREM radii),
│                          Fresnel-inverse transparency, graticule, terminator,
│                          layer opacity state
├── SeismicSystem
│   ├── CatalogClient   — USGS FDSN fetch, cache (SQLite), query filters
│   ├── PlaybackClock   — time compression, scrub, pause
│   └── WaveRenderer    — travel-time texture sampling, P/S isochron shells,
│                          surface-wave ripple, shadow zones
├── WeatherSystem
│   ├── TileStreamer    — WMTS/XYZ tile fetch, LRU cache (disk+RAM), retry
│   ├── CloudLayer      — draped composite
│   ├── PrecipLayer     — animated radar loop
│   └── WindLayer       — GPU particle advection from GFS grid texture
├── UI                  — layer panel, timeline, map picker, calibration flow,
│                          info cards (all world-locked panels, hand+controller)
└── Boot                — permissions, MRUK setup, first-run location/heading
```

## Data sources (baked, non-live)

| Data | Source | Notes |
|---|---|---|
| Base imagery | NASA Blue Marble NG (monthly), Natural Earth vectors | Bundled; core visuals work offline |
| City lights (night) | NASA Black Marble | Bundled |
| Plate boundaries | USGS/Bird 2003 dataset | Bundled |
| Terrain elevation (user altitude) | Open-Elevation, or bundled ETOPO coarse grid | Coarse fine (±100 m irrelevant at planet scale) |

Live sources: earthquakes in [seismic.md](seismic.md), weather in
[weather.md](weather.md).

**Degradation policy:** all network access optional-degradable. Offline → baked
imagery, bundled historical earthquake set, no live weather. Fail fast and
visibly — an errored source shows a labeled "offline" chip on its layer toggle;
never silently substitute fake data.

## Persistence & config

- App config (defaults, layer presets, comfort settings): **KDL** file in app
  persistent storage.
- Content/data caches (event catalog, tiles): SQLite + flat tile cache.
- Per-room anchors (floor, heading): Meta spatial anchors keyed by room UUID.

## Attributions & licensing

- USGS earthquake data: public domain, attribution courtesy.
- NASA GIBS/Blue Marble/Black Marble: public domain, attribution required per
  GIBS guidelines.
- RainViewer: attribution required (logo/text per their terms).
- ak135 travel-time tables via ObsPy (LGPL — used offline in content pipeline
  only, not shipped).
