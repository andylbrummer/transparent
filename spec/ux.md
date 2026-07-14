# User Experience & Visual Design

## First-run flow

1. **Passthrough boot** — user sees their room immediately.
2. **Room setup** — MRUK space setup if not already done; app requires a floor.
3. **Location & heading** — headset shows a QR code; user scans it with their
   phone to open/install the companion app ([companion-app.md](companion-app.md)),
   which streams GPS position and compass heading to the headset. One guided
   gesture (hold phone flat against the controller, tap "Sync") transfers
   true-north into the headset's tracking space. Fallbacks if no phone: IP
   geolocation proposal ("Looks like you're near Austin, TX — correct?") +
   floating map pin for location; sun-assist or manual compass-rose for heading
   ([geospatial.md](geospatial.md)). Altitude auto-filled from terrain elevation
   service. Coarse heading is acceptable (±5°); a later "landmark nudge" lets
   users rotate the globe until a known coastline/city aligns.
4. **Reveal** — the floor dissolves in an expanding ring from beneath the user's
   feet. Default window: 3 m radius disc (clamped to room floor bounds).

## Core interactions

- **Window control:** resize the floor window (grab edge), expand to "whole floor,"
  or "full transparency" mode where walls/furniture also ghost out (passthrough
  alpha ramp), leaving only a faint room wireframe for safety.
- **Layer panel:** toggles + opacity sliders for: terrain/ocean surface, crust,
  upper mantle, lower mantle, outer core, inner core, graticule (lat/long lines),
  political borders, city lights, plate boundaries.
- **Time controls (earthquakes):** timeline scrubber, play/pause, speed
  (1 s = 1 min … 1 s = 1 year), event list filter (magnitude, depth, region, date
  range), "notable events" presets (2011 Tōhoku, 2004 Sumatra, 1960 Valdivia…).
- **Weather controls:** toggles for clouds, precipitation radar, wind streamlines,
  temperature shading; "now" vs. short forecast loop (past 2 h → +6 h).
- **Look-through-anywhere:** point controller at any wall → temporary porthole
  showing the horizon-line view through that wall (bonus mode, reuses same portal
  tech, lower priority — first cut if schedule slips).
- **Info gaze:** dwell on an earthquake event or city → info card (magnitude,
  depth, time, felt reports; population, local time).

## Comfort & safety

- The floor *visually* disappears but users must not fear stepping: subtle
  guardian-style grid shimmer appears on the real floor whenever the user moves
  their feet (locomotion detection via head bob/position delta).
- Optional "vertigo reducer": frosted-glass rim (1 m) between user and window edge.
- All wave/weather animation obeys system reduced-motion setting.
- Snap "restore floor" gesture: double-tap thumbstick or palm-down hand pose.

## Visual design

### The window ("porthole")
- Stencil-based portal punched into the passthrough layer at the MRUK floor plane.
- Edge: soft feathered rim + faint caustic glow, reads as "glass cutout."
- Inside the portal, render the virtual Earth scene with its own depth range.

### The transparent Earth ("beachball" rendering)
- Outer surface: satellite imagery (Blue Marble base + optional live true-color),
  rendered mostly opaque at grazing angles, increasingly transparent when viewed
  face-on beneath the user — Fresnel-inverted transparency so the ground directly
  below stays see-through while the curving horizon reads as a solid globe.
- Interior layers, each a translucent shell with distinct treatment:
  - **Crust** (0–35 km avg): thin brownish glassy shell; real crust is invisible
    at true scale — offer "10× thickness" teaching mode.
  - **Upper mantle** (to 660 km): deep amber, faint convection flow-noise shader.
  - **Lower mantle** (to 2,891 km): darker red-orange gradient.
  - **Outer core** (to 5,150 km): molten glow, slow animated swirl (it's liquid).
  - **Inner core** (r = 1,220 km): bright white-gold solid sphere, gentle pulse.
- Layer shells rendered back-to-front with premultiplied alpha; max 6 transparent
  layers overlapping ⇒ overdraw budgeted in [platform.md](platform.md).
- **Antipode marker:** faint ring + label on the far surface directly below.
- Optional graticule and "depth ladder" — concentric distance rings labeled
  (100 km, 1,000 km, 2,900 km CMB, 6,371 km center, 12,742 km antipode) drawn
  along the user's nadir line.
