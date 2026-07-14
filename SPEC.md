# Transparent Earth — Quest 3S Mixed Reality App Specification

**Version:** 0.2 (draft)
**Target device:** Meta Quest 3S (also runs on Quest 3)
**Companion:** React Native phone app (iOS + Android) for location/heading
**Working title:** Transparent Earth

---

## 1. Concept

A mixed-reality app that makes the ground beneath the user optically "disappear."
The user stands in their real room (passthrough), and a window opens in the floor
revealing a geographically accurate view *through* the planet — as if the Earth
were a glass beachball and the user were standing on top of it, looking down
through a transparent porthole directly beneath their feet.

Through that window the user sees:

- The Earth's curvature falling away in every direction, rendered at true scale
  and correctly oriented for the user's actual location and heading.
- Ghostly, semi-transparent interior layers: crust, upper/lower mantle, outer
  core, inner core (PREM-based radii), each independently toggleable.
- The far side of the planet (the antipode) visible straight down through the core.
- **Earthquake playback overlay:** historical and near-real-time earthquakes
  rendered at their true hypocenter depth, with animated P-wave and S-wave
  fronts propagating through the interior and surface waves rippling across
  the crust.
- **Weather overlay:** live cloud cover, precipitation, and wind rendered on the
  planet surface below.

The core illusion: *accurate vantage point*. Everything below the window is
positioned exactly where it really is relative to the user — the Pacific really
is that way and that far down; the antipode really is straight down.

## 2. Spec documents

| Document | Contents |
|---|---|
| [spec/platform.md](spec/platform.md) | Quest 3S constraints, performance & memory budgets, render settings |
| [spec/ux.md](spec/ux.md) | First-run flow, interactions, comfort/safety, visual design of portal + transparent Earth |
| [spec/geospatial.md](spec/geospatial.md) | Location/heading acquisition chains, ECEF/WGS84 coordinates, floating origin, precision |
| [spec/companion-app.md](spec/companion-app.md) | React Native phone app: pairing, GPS transfer, compass heading sync, protocol |
| [spec/seismic.md](spec/seismic.md) | Earthquake catalog, playback engine, P/S/surface wave rendering, travel-time data |
| [spec/weather.md](spec/weather.md) | Cloud/precip/wind layers, data sources, degradation |
| [spec/architecture.md](spec/architecture.md) | Engine choice, module breakdown, data sources, persistence, licensing |

## 3. Goals and Non-Goals

### Goals
- G1. Convincing "hole in the floor / transparent world" illusion anchored to the
  real floor plane, stable under head movement (no swim, no jitter).
- G2. Geospatially accurate: correct latitude/longitude/altitude vantage, correct
  true-north alignment, correct scale (1:1 — the Earth rendered at real size,
  6,371 km radius, seen from its actual distance of ~0 m).
- G3. Scientifically grounded interior model (PREM layer radii) suitable for
  education use.
- G4. Earthquake catalog browsing + time-compressed playback with physically
  plausible seismic wave propagation (travel times from standard Earth models).
- G5. Live weather visualization (clouds, precipitation, wind) on the globe surface.
- G6. Comfortable, standing-or-seated experience at 72 Hz minimum on Quest 3S.
- G7. Sub-minute setup via companion phone app (GPS + compass transfer), with
  full in-headset fallbacks so the phone is never required.

### Non-Goals (v1)
- No multiplayer / shared sessions.
- No full-physics waveform simulation (wavefronts animate from travel-time
  tables, not spectral-element synthetics).
- No outdoor/wide-area use; single-room experience.
- No hand-tracked geology tools (measuring, core sampling) — future.

## 4. Milestones

| # | Deliverable | Acceptance |
|---|---|---|
| M1 | Portal tech proof: stencil hole in passthrough floor showing skybox, stable to ±2 mm at head sway | On-device demo |
| M2 | GeoFrame + companion app: phone GPS/heading sync end-to-end; static Blue Marble globe correctly oriented beneath floor at 1:1; sun-assist + manual fallbacks | Antipode of test location verified straight down; horizon direction matches reality within 5°; phone sync under 60 s |
| M3 | Interior shells + layer panel + depth ladder | 72 Hz sustained with full window |
| M4 | Seismic playback: catalog fetch, timeline, P/S/surface wavefronts, S-wave core shadow visible | Tōhoku 2011 playback: P-wave reaches antipode in ~20 min sim-time; S-shadow correct |
| M5 | Weather: clouds + precip + wind particles + terminator | Live data matches current radar for user's region |
| M6 | Polish: comfort features, offline degradation, first-run flow, store-compliance pass | Quest store tech requirements met |

## 5. Risks & Open Questions

1. **Heading accuracy without phone** — sun-assist assumes user can point at the
   sun; indoor nighttime fallback is manual only. Mitigation: companion app is
   the primary path; landmark nudge + per-room persistence make manual a
   one-time cost.
2. **Phone compass interference indoors** — magnetometers lie near speakers,
   rebar, desks. Mitigation: variance gating + 3-sample median + explicit retry
   guidance (see [spec/companion-app.md](spec/companion-app.md)).
3. **Transparent overdraw** — 6 shells + wavefronts inside a large portal may
   blow the 4 ms shell budget on 3S; may need to merge mantle sublayers into a
   single raymarched shell (single pass, analytic sphere intersections — likely
   *cheaper* than 6 raster shells; prototype both in M3).
4. **Depth API noise on 3S** — if per-pixel occlusion of the portal by real
   furniture (chair legs over the hole) looks bad, ship without dynamic
   occlusion (floor-plane stencil only); recommend users clear a floor patch.
5. **RainViewer free-tier limits** — verify quota; fallback to GIBS precip
   product.
6. **Store policy** — location-permission narrative required for Meta review
   even though location comes from phone/IP/manual (no platform location API).
7. Wall-porthole ("look through walls at horizon") — bonus mode; first cut if
   schedule slips.
