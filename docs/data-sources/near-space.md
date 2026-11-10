# Near space: data sources and verification

Everything the "Near space" layers draw - satellites, the magnetic field,
the magnetopause, the aurora, the Moon's orbit, spacecraft beyond Earth
orbit, meteor shower radiants - where it comes from, and what was checked
against what. Numbers are as measured on 2026-11-10 (UTC).

## Datasets shipped or fetched

| Layer | What | Source and citation | Licence / terms | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| The ten satellite switches (`sat-*`) | GP element sets ("TLEs", in CSV) of 17 CelesTrak groups: `stations`, `visual`, `gps-ops`, `glo-ops`, `galileo`, `beidou`, `geo`, `weather`, `resource`, `science`, `iridium-NEXT`, `oneweb`, `starlink`, and four debris groups | CelesTrak (Dr. T.S. Kelso), GP data from the US Space Force 18th/19th Space Defense Squadron's public catalogue | Free to use. Usage policy (below): one download per data update, data checked every 2 h | https://celestrak.org/NORAD/elements/ · `gp.php?GROUP=<group>&FORMAT=csv` | Live: fetched in the browser when a switch is first turned on, then kept in the Cache API for 3 h. Baked fallback: `tools/pipeline/generate_satellites_snapshot.py` → `app/public/space/gp/*.csv` + `manifest.json` (2.0 MB, of which Starlink 1.4 MB), fetched 2026-11-10 01:48 UTC | CelesTrak (Dr. T.S. Kelso), from the US Space Force 18th and 19th Space Defense Squadrons' public catalogue |
| same | SGP4/SDP4 propagation | satellite.js 6.0.2 (Shashwat Kandadai and contributors), after Vallado, Crawford, Hujsak & Kelso, "Revisiting Spacetrack Report #3" (2006) | MIT | https://github.com/shashwatak/satellite-js | npm dependency of `app`, loaded only in the lazy `satellites` chunk (36 KB, 17.5 KB gzipped, with the layer's own code) | satellite.js by Shashwat Kandadai and contributors |
| Magnetic field lines | World Magnetic Model 2025 (degree and order 12, epoch 2025.0, valid to 2030.0) | NOAA NCEI and the British Geological Survey | Public domain | https://www.ncei.noaa.gov/products/world-magnetic-model | Coefficients already in `packages/core/src/magnetic/wmm2025.ts`; lines are traced in the browser when the switch is turned on | NOAA National Centers for Environmental Information and the British Geological Survey |
| Magnetopause (model) | Solar wind speed, proton density and IMF Bz, measured at L1 and propagated to the Earth | NOAA Space Weather Prediction Center | Public domain (NOAA/NWS) | https://services.swpc.noaa.gov/products/geospace/propagated-solar-wind-1-hour.json | Live: on switch-on and every 5 min while shown. Baked fallback: `tools/pipeline/generate_space_weather_snapshot.py` → `app/public/space/space-weather.json` (0.4 KB) | NOAA Space Weather Prediction Center |
| same | The model surface: r = r0 (2 / (1 + cos θ))^α | Shue et al. (1998), "Magnetopause location under extreme solar wind conditions", J. Geophys. Res. 103, 17691, doi:10.1029/98JA01103 | Published formula | https://doi.org/10.1029/98JA01103 | Computed | Shue et al. (1998) |
| Aurora (live forecast) | OVATION Prime aurora nowcast: probability of aurora on a 1° global grid, 30-90 min ahead; hemispheric power; planetary K index | NOAA Space Weather Prediction Center | Public domain (NOAA/NWS) | https://services.swpc.noaa.gov/json/ovation_aurora_latest.json (920 KB) · `/text/aurora-nowcast-hemi-power.txt` · `/products/noaa-planetary-k-index.json` | Live: on switch-on and every 10 min while shown (the product is recomputed every 5 min). Baked fallback: same script → `app/public/space/aurora.png` (1.8 KB) | NOAA Space Weather Prediction Center |
| Moon's orbit and Earth-Moon Lagrange points | The lunar ephemeris already in `packages/core` (ELP-2000/82 as in Meeus), verified against JPL Horizons by an earlier slice; Lagrange points from the restricted three-body problem with GM of the Sun, Earth and Moon as JPL Horizons lists them | Computed | - | https://ssd.jpl.nasa.gov/horizons/ | Computed in the browser | Lunar theory ELP-2000/82 as in Meeus (1998); gravitational parameters from NASA/JPL Horizons |
| Spacecraft at Sun-Earth L1 and L2; Deep-space probes | Geocentric astrometric RA/Dec (ICRF) and range of 27 spacecraft at 00:00 UTC, 2026-01-01 to 2028-01-01, every 1, 2 or 5 days | NASA/JPL Horizons On-Line Ephemeris System (the missions' own trajectories) | Free use with acknowledgement | https://ssd.jpl.nasa.gov/api/horizons.api | Baked: `tools/pipeline/generate_spacecraft.py` → `app/public/space/spacecraft.json` (288 KB). Horizons sends no CORS headers, so the app cannot ask it live | NASA/JPL Horizons On-Line Ephemeris System |
| Meteor shower radiants | 37 showers: IAU number and code, activity period, date and solar longitude of maximum, radiant RA/Dec at maximum, speed, ZHR | International Meteor Organization, 2026 Meteor Shower Calendar (ed. J. Rendtel), Table 5, "Working List of Visual Meteor Showers" | **No stated licence - needs a decision, see below** | https://www.imo.net/files/meteor-shower/cal2026.pdf | Baked: `tools/pipeline/generate_meteor_showers.py` (needs `pdftotext`) → `app/public/space/meteor-showers.json` (10 KB) | International Meteor Organization, 2026 Meteor Shower Calendar (ed. J. Rendtel) |

Total baked for the slice: 2.33 MB under `app/public/space/`.

### CelesTrak's usage policy, and how the app keeps it

From https://celestrak.org/NORAD/documentation/gp-data-formats.php (FAQ
addendum updated 2026-03-26): CelesTrak checks for new GP data once every
two hours; "there is no need for you to check more often"; since March 2026
it enforces **one download per update**, beginning with the `active` and
`starlink` groups - a second request for the same group returns HTTP 403
until the data changes; an address that collects more than 1,000 error
responses in a day is firewalled; a 403 or 404 "is not going to change by
repeating the request". The TLE format cannot hold the six-digit catalogue
numbers assigned since 2026 (the snapshot has objects up to 101318), so the
CSV form of the OMM is used.

`app/src/layers/satellites/gp-source.ts`: a group is fetched only when its
switch is first turned on; the answer is kept in the Cache API and used for
3 h; the time of every attempt is written to localStorage *before* the
request and no second request for that group is made within 2 h of it,
whatever the first one's outcome - a refusal or a timeout is never retried
sooner; without localStorage no request is made at all. Whenever the
network is not used or does not answer, an older cached copy or the baked
snapshot is shown and the chip says which ("cached", "offline"). The
limit is per browser: many users behind one address (an office NAT) share
CelesTrak's per-address allowance, and some of them will get the snapshot.
The "all active" group (about 14,000 objects, the most tightly policed) is
deliberately not offered.

If the app clock is pinned (`?time=`) nearer to the snapshot's epoch than to
the present, the snapshot is used and CelesTrak is not asked. SGP4 degrades
as the date moves away from an element set's epoch (kilometres within days
for low orbits): the chip always gives the elements' date, and beyond 14
days from the shown time positions are drawn dimmer and the chip reads
"approximate".

### CORS and privacy

Checked with `curl -sI -H "Origin: https://example.org"` and in headless
Chromium: CelesTrak `gp.php` and all four SWPC products answer
`access-control-allow-origin: *` and load in the browser (CelesTrak's
`stations` group was fetched once from the browser, live, on 2026-11-10
02:41 UTC). JPL Horizons and the JPL SBDB close-approach API send no CORS
header. All live requests are anonymous GETs of global data; nothing about
the user or their location is sent.

## Verification

| What | Against | Result |
| --- | --- | --- |
| SGP4 state (TEME) of the ISS, GPS BIIR-5 (PRN 22) and GOES 19 at 2026-11-09 18:00 UTC | python `sgp4` 2.27 (Brandon Rhodes' wrapper of Vallado's C++ SGP4) with the same element sets (`tools/pipeline/generate_satellite_fixture.py`) | position within 20 m, velocity within 2 cm/s (`orbit-math.test.ts`) |
| Sub-satellite point, height, and azimuth/elevation/range from Austin for the same three | the same python run, with its own GMST (IAU 1982) and WGS84 code | latitude/longitude to 0.001°, height to 20 m; azimuth/elevation within 0.1° (the bound set by the app's spherical Earth), range within 0.2 % |
| ISS from Austin at that instant | JPL Horizons, object -125544 (its own TLE-based trajectory): az 308.379°, el -49.645°, range 10,272.36 km | python sgp4 gives az 308.375°, el -49.645°, range 10,272.69 km; the app is held to 0.15° / 0.1° of Horizons, and its ICRF position to 3 km of Horizons' vector |
| GOES 19 over 24 h | its assigned slot | stays within 0.1° of 75.2°W and of the equator, within 25 km of 35,786 km |
| WMM field vector | all 12 rows of NOAA's `WMM2025_TEST_VALUES.txt` (X, Y, Z, H, F, I, D) | within 0.06 nT and 0.006° (the published precision), in the geodetic frame and again in Earth-fixed axes |
| Geomagnetic north pole | NCEI, "Wandering of the Geomagnetic Poles": 80.79°N (geocentric) 72.76°W for 2025.0 | matches to 0.01° |
| Dip poles | none fetched | the model's field is vertical there to 0.05 nT (85.76°N 139.30°E and 63.85°S 135.08°E for 2025.0); **not compared with a published position** |
| Field lines | the field itself | each chord is parallel to the field at its midpoint (cosine > 0.9999); a line from 60° geomagnetic latitude peaks between 3.3 and 4.8 Earth radii and lands near 60° south |
| Shue magnetopause coefficients | Tsyganenko's Geopack as ported at github.com/tsssss/geopack (`shuetal_mgnp`), including its 1.94e-6 n v² dynamic pressure | identical formula; the paper itself was not opened |
| Aurora grid orientation | physics (`tools/pipeline/test_space_weather_snapshot.py`) | northern oval centred 3.3° from the geomagnetic north pole, southern 7.7° from the south one; both brightest within 25° of magnetic midnight at the forecast time |
| Spacecraft table as the app reads it (interpolation, observer's parallax) | separate topocentric JPL Horizons queries from Austin, 2026-11-09 18:00 UTC: JWST, SOHO, Voyager 1 | within 0.02° (JWST, SOHO) and 0.002° (Voyager 1); range within 0.2 %. Without the parallax correction JWST would be 0.1-0.3° off |
| Magnetopause nose direction | the Sun layer | by eye: the nose sits 4° below the Sun from Austin at local noon, as parallax at 10.5 Earth radii requires |
| Meteor showers | the calendar's own columns | 10 rows read off the PDF by eye match; for all 37, the printed date of maximum and its solar longitude agree within 1.5°, through both a Meeus low-accuracy Sun (pipeline) and the app's VSOP87 Sun |

## Notes, gaps and things needing a decision

- **IMO meteor shower list - licence unclear, needs Andy's decision.** The
  calendar PDF carries no licence or copyright statement. The 37 rows are
  facts about the sky published for observers and are credited to the IMO
  in the app, but permission to redistribute the compiled table has not
  been asked for. If that is not acceptable, remove
  `app/src/layers/meteor-showers/` and `app/public/space/meteor-showers.json`.
- **Starlink snapshot is 1.4 MB** (`app/public/space/gp/starlink.csv`),
  over the 500 KB guideline. It is fetched only when the Starlink switch is
  on and CelesTrak cannot be used; without it that switch would have no
  fallback, and CelesTrak polices this group hardest.
- Horizons' trajectories for several L1 spacecraft end within weeks or
  months of the bake (DSCOVR 2026-11-22, SOHO and IMAP 2026-12-13, ACE, Wind
  and Hera January 2027, Aditya-L1 and STEREO-A February 2027, BepiColombo
  April 2027).
  After those dates the craft simply stop being shown, and the chip counts
  how many still have a trajectory. Re-running `generate_spacecraft.py`
  later extends them.
- A probe passing the Earth for a gravity assist (Europa Clipper December
  2026, JUICE September 2026, OSIRIS-APEX 2027) is hidden for the one or
  two daily steps in which it crosses the sky. Horizons files OSIRIS-APEX
  under its first name, OSIRIS-REx; the label uses the current one.
- The magnetopause is a model surface and is labelled so. The bow shock is
  not drawn. Solar wind aberration (about 4°) is ignored: the surface
  points straight at the Sun.
- OVATION's grid has stray 1 % values along the equator row; the app draws
  nothing below 1.5 %.
- Meteor radiants are shown where they are at maximum; their daily drift
  (about a degree) is not applied. Activity periods are the calendar's
  month-day ranges; only the maximum is recomputed from solar longitude for
  other years.
- The app's Earth is a sphere with geodetic latitude used as geocentric.
  Satellites are placed over their true WGS84 ground point at their true
  height above the ellipsoid, which keeps them within 0.1° of their true
  direction from the user (tested), not exactly on it.
- Nutation and polar motion are left out of TEME → Earth-fixed, as in the
  rest of the app's sky (under 20″).
- **Not built**: radiation belts (no source good enough to draw from - the
  only figures fetched for the outer belt were unsourced), field lines
  below ground (tried: they read as stray scratches from the surface
  viewpoint, removed), altitude reference shells, near-Earth asteroid close
  approaches and comets (would need per-object Horizons ephemerides that go
  stale in weeks), the "all active" satellite group, TESS (not in
  CelesTrak's science group; its 13.7-day orbit needs finer sampling than
  the daily spacecraft table).

## Used for verification only (not shipped)

| What | Source | Terms |
| --- | --- | --- |
| Reference SGP4 | python `sgp4` 2.27, in `tools/pipeline/.cache/venv` | MIT; not distributed |
| ISS az/el and ICRF vector; topocentric JWST, SOHO, Voyager 1; GM of Sun, Earth, Moon | JPL Horizons API | free use with acknowledgement |
| WMM2025 test values and geomagnetic pole | NOAA NCEI, https://www.ncei.noaa.gov/sites/default/files/2025-02/WMM2025_TEST_VALUES.txt and https://www.ncei.noaa.gov/products/wandering-geomagnetic-poles | public domain |
| Shue model coefficients | geopack (Python port of Tsyganenko's Geopack), github.com/tsssss/geopack | licence not checked; read to confirm a published formula, not distributed |
