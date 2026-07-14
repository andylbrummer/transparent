# Geospatial Accuracy

The core promise of the app: everything below the window is positioned exactly
where it really is relative to the user. That requires the user's true location,
true-north heading, and jitter-free planetary-scale rendering.

## Location acquisition (no GPS on device)

Priority chain:
1. Companion app GPS push ([companion-app.md](companion-app.md)) — meters-level accuracy.
2. Cached last-confirmed location.
3. IP geolocation (network request → ~city accuracy) proposed for confirmation.
4. Manual map-pin entry (floating 2-D map, search box).

Altitude from Open-Elevation/terrain tileset lookup; user height above floor from
MRUK floor plane + HMD pose.

## Heading (no compass)

Priority chain:
1. Companion app compass transfer ([companion-app.md](companion-app.md)) —
   ±2–3° after declination correction.
2. Sun-assist calibration: user points controller ray at the sun (through a
   window or from memory of where it rises); app computes solar azimuth/elevation
   from time + location → derives true north. Error ±3–5° typical.
3. Manual compass-rose drag; landmark-nudge fine adjustment (always available
   on top of either method above).

Persist heading per MRUK room UUID (re-localization keeps it valid across sessions).

## Coordinate system & precision

- Earth-centered Earth-fixed (ECEF, WGS84) is the source of truth for all data.
- **Floating-origin scheme:** the render camera stays near the scene origin; the
  globe (radius 6.371 × 10⁶ m) is transformed so the user's surface position maps
  to the origin. All ECEF positions converted to origin-relative doubles on CPU,
  floats only after subtraction. Prevents jitter at planetary scale.
- Render scale 1:1. Depth precision handled with reversed-Z + camera far plane
  ~1.4 × 10⁷ m (antipode + margin); log-depth fallback if artifacts appear.
- Orientation: ENU (east-north-up) frame at user location, rotated by calibrated
  heading, mapped to MRUK floor anchor pose.
