# Mobile / Web Version — Phone-First Accessible Target

Primary near-term target: **Pixel 6 Pro (and any ARCore/WebXR-capable phone)**
running a web app. Ships before the Quest 3S native app; shares the data
pipeline and visual design with it.

Key advantage over Quest 3S: the phone natively has **GPS, magnetometer
(compass), and ARCore 6DoF tracking** — the entire location/heading
calibration problem from [geospatial.md](geospatial.md) disappears. One device
senses and renders.

## Modes (one codebase, three tiers)

| Mode | Tech | Tracking | Experience |
|---|---|---|---|
| **AR magic window** (primary) | WebXR `immersive-ar` (Chrome/ARCore) | 6DoF + camera passthrough on screen | Point phone at floor; portal punched into camera feed; walk around the hole. Full spec experience through a handheld window. |
| **Cardboard stereo** (toggle) | WebXR `immersive-vr` | 3DoF | Fully virtual scene (no passthrough): user floats on glass surface above the transparent globe. Bonus immersion mode; short sessions (thermal). |
| **Gyro/orbit fallback** | Plain Three.js + DeviceOrientation | 3DoF gyro aim, touch orbit | Works on any phone/desktop. Entry tier + shareable demo. |

Mode selection automatic by capability probe; manual override in settings.

## Stack

- **Three.js + WebXR**, TypeScript, Vite. No app store, no build pipeline
  beyond static hosting; instantly shareable URL.
- Sensors via web APIs: Geolocation API (GPS), `AbsoluteOrientationSensor` /
  DeviceOrientation `alpha` with `webkitCompassHeading`-style fallbacks for
  true heading, WebXR hit-test for floor plane in AR mode.
- Data pipeline identical to Quest spec: same ak135 travel-time texture, same
  USGS FDSN catalog client, same GIBS/RainViewer/GFS tile+grid sources
  ([seismic.md](seismic.md), [weather.md](weather.md)). Shared as a
  platform-agnostic TypeScript package (`core/`): catalog client, playback
  clock, geodesy math (ECEF/ENU, floating origin), tile streaming.

## Rendering adaptations (Tensor G1 budget)

- Single **raymarched interior shell** pass (analytic sphere intersections for
  all PREM layers in one fragment shader) instead of 6 raster alpha shells —
  this was already the Quest overdraw mitigation; on mobile it is the default.
- Target 60 fps magic-window, 72 fps not applicable; Cardboard stereo targets
  60 fps at reduced resolution scale (0.7×) with session-length soft cap +
  thermal API watch (`navigator.thermal` unavailable — use frame-time trend as
  proxy, degrade shells before dropping frames).
- Tile budget halved vs Quest: ≤ 256 MB RAM tiles, Blue Marble 4k base.
- Wind particles 8 k (vs 20 k on Quest).

## Location & heading (native — no companion needed)

- Geolocation API one-shot fix (user grants permission) → same accuracy gate
  (≤ 20 m or accept).
- Heading: fused absolute orientation sensor gives true-north-referenced device
  pose directly; in WebXR AR, anchor the ENU frame once at session start from
  the sensor reading, then trust ARCore visual-inertial tracking (drift-free
  short-session).
- Compass interference gates from [companion-app.md](companion-app.md) reuse
  here (variance check, hold-still sampling, median of 3).

## Portal in AR mode

- WebXR hit-test finds the floor plane; user taps to place/confirm portal disc.
- No stencil-vs-passthrough compositing needed: camera feed is the background,
  portal is simply rendered geometry occluding it — cheaper than Quest version.
- Depth-API occlusion (ARCore Depth via WebXR depth-sensing) optional
  enhancement; ship without.

## Relationship to Quest app

- Phone web app is **Phase 1**: proves visual design, seismic playback,
  weather layers, and data pipeline with zero store friction.
- Quest 3S native app is **Phase 2**: ports proven design to true stereo MR;
  reuses content pipeline outputs and service endpoints as-is.
- The React Native companion app ([companion-app.md](companion-app.md)) is a
  Phase 2 artifact — needed only when the renderer (Quest) lacks sensors. If
  the web app's sensor code is structured cleanly, the companion app can wrap
  the same pages (heading-sync UI) in a WebView or reuse logic via shared
  TypeScript, shrinking Phase 2 scope.

## Milestones (Phase 1)

| # | Deliverable | Acceptance |
|---|---|---|
| P1 | Gyro globe: geolocated, compass-aligned transparent Earth beneath user, raymarched shells, depth ladder | Antipode straight down at test location; horizon bearing within 5° of reality |
| P2 | AR magic window: WebXR hit-test portal on real floor, 6DoF stable | Portal locked to floor within ±2 cm during walk-around on Pixel 6 Pro |
| P3 | Seismic playback (full [seismic.md](seismic.md) scope) | Tōhoku 2011: P-wave antipode ~20 min sim-time; S-shadow correct |
| P4 | Weather layers (full [weather.md](weather.md) scope) | Live precip matches local radar |
| P5 | Cardboard stereo toggle + fallback tier polish | 60 fps stereo 10-min session on Pixel 6 Pro without thermal frame collapse |
