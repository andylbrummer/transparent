# Companion Mobile App (React Native) — Location & Orientation Source

A small React Native app (iOS + Android) whose only job is to give the headset
the two things it cannot sense: **where on Earth it is** and **which way is
true north**.

The app is optional: every capability it provides has an in-headset fallback
([geospatial.md](geospatial.md)). It is the *recommended* path because it turns
a fiddly manual calibration into one guided gesture with better accuracy.

## Pairing

- Headset displays a QR code encoding a session token + connection info.
- Phone scans it (deep link installs app on first use), joins the same session.
- Transport: LAN-first — phone and headset on the same Wi-Fi, direct WebSocket
  (headset runs a lightweight listener; QR carries its LAN IP + port + token).
  Cloud relay fallback (WebSocket relay service) when the LAN path is blocked
  (client isolation, different networks). No account required; sessions are
  ephemeral tokens, no location data stored server-side.

## Location transfer

- Phone streams fused GPS fixes (`lat, lon, altMSL, accuracy`) until accuracy
  ≤ 20 m or user accepts current fix. One-shot by design — the headset doesn't
  move at planetary scale afterward.

## Heading transfer (the valuable part)

- Phone streams true-north heading from platform fused compass
  (magnetometer + IMU; declination handled by OS APIs — `CLLocationDirection
  trueHeading` on iOS, rotation-vector sensor + WMM declination from the GPS
  fix on Android).
- Sync gesture: user holds the phone flat against the top of the Touch
  controller (guided overlay shows exact placement), holds still 2 s, taps
  **Sync** on the phone. At that instant: phone heading = controller forward
  azimuth. Headset records the controller pose in tracking space → solves the
  tracking-space→true-north rotation.
- Quality gates: reject sync if phone reports low compass accuracy (OS-provided
  accuracy enum), if phone rotation rate > threshold during the hold, or if
  magnetometer variance is high (magnetic interference — prompt user to step
  away from speakers/metal desk and retry).
- Repeat-sample: app takes 3 syncs and uses the median; disagreement > 5°
  triggers an interference warning.

## Implementation notes

- Expo (managed) + `expo-location` (GPS + heading), `expo-sensors`
  (magnetometer variance check), Expo camera for QR scan, plain WebSocket
  client. No native modules beyond Expo SDK — keeps the app trivial to maintain.
- Screens: Scan → Connect status → Location fix card → Heading sync (guided,
  with live compass dial + accuracy indicator) → Done ("You can put the phone
  down"). Total interaction target: under 60 seconds.

## Protocol (headset ⇄ phone)

JSON messages over WebSocket, all client→headset unless noted:

| Message | Payload | Direction |
|---|---|---|
| `hello` | `{token, appVersion, platform}` | phone → headset |
| `hello_ack` | `{sessionId}` | headset → phone |
| `location` | `{lat, lon, altMsl, accuracyM, ts}` | phone → headset (streamed) |
| `location_accept` | `{}` | headset → phone (stop streaming) |
| `heading_sample` | `{trueHeadingDeg, accuracyEnum, magVariance, rotationRate, ts}` | phone → headset (streamed during sync hold) |
| `sync_commit` | `{medianHeadingDeg, samples: 3}` | phone → headset |
| `sync_result` | `{accepted, residualDeg?, reason?}` | headset → phone |

Errors are explicit and terminal per attempt — a rejected sync tells the user
why (interference, movement) and restarts the guided flow; no silent retries
with degraded data.
