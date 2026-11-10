# Data sources: the sky slice

Sun, Moon, planets, constellations, the sky grid and the Milky Way
(panel section "Sky"). The stars themselves are documented with the
`stars` layer (`tools/pipeline/generate_stars.py`).

Everything is free and keyless. Baked files are committed under
`app/public/sky/`; live data is fetched in the browser from NOAA SWPC,
whose endpoints all answer with `access-control-allow-origin: *`.

## Datasets

| Layer (id) | What | Source and citation | Licence / terms | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| `sun`, `moon`, `planets`, `sun-activity` | Positions of the Sun and the planets Mercury-Neptune | VSOP87B planetary theory: Bretagnon P., Francou G. 1988, A&A 202, 309 (CDS catalogue VI/81), truncated to 0.5″ | CDS/VizieR catalogue: free use with acknowledgement of the authors | https://vizier.cfa.harvard.edu/ftp/cats/VI/81/ | Baked into code: `tools/pipeline/generate_vsop87.py` → `packages/core/src/astro/vsop87-data.ts` (178 KB of source, 69 KB gzipped, loaded lazily) | VSOP87, Bretagnon & Francou 1988 (CDS VI/81) |
| `moon` (and the Moon in eclipses) | Position of the Moon | Main periodic terms of the ELP-2000/82 lunar theory (Chapront-Touzé & Chapront 1983) as tabulated in J. Meeus, *Astronomical Algorithms* (2nd ed. 1998) ch. 47; the 120 table rows taken from Sonia Keys' transcription `soniakeys/meeus` | Tables: facts from the published theory; the transcription is MIT licensed | https://github.com/soniakeys/meeus | Baked into code: `tools/pipeline/generate_lunar_series.py` → `packages/core/src/astro/lunar-series.ts` | Meeus, Astronomical Algorithms (1998), after ELP-2000/82 |
| `sun`, `moon`, `planets` | Formulae: Sun's rotation elements (Carrington; Meeus ch. 29), Moon's orientation (Cassini's laws; ch. 53), planet magnitudes (Astronomical Almanac 1984 formulae; ch. 41), Saturn's ring plane (ch. 45), ΔT before 1972 (Espenak & Meeus polynomials) | Meeus 1998; formula constants read from `soniakeys/meeus` (MIT); ΔT from NASA's eclipse site | Published formulae; MIT transcription; NASA page public domain | https://eclipse.gsfc.nasa.gov/SEcat5/deltatpoly.html | In code: `packages/core/src/astro/ephemeris.ts` | - |
| tests only | Reference positions, magnitudes, phases, disc orientations 1900-2100 | JPL Horizons on-line ephemeris system (DE441), Giorgini et al., JPL Solar System Dynamics | Public, keyless API | https://ssd.jpl.nasa.gov/horizons/ | `tools/pipeline/fetch_horizons_fixture.py` → `packages/core/src/astro/ephemeris.fixture.ts` | JPL Horizons |
| `sun` | White-light image of the Sun (HMI continuum intensitygram), 512 px | SDO/HMI, served by NOAA SWPC | SDO: "not copyrighted … use for non-commercial purposes and public education … requires no expressed authorization", credit requested | https://sdo.gsfc.nasa.gov/data/rules.php | **Live**: `services.swpc.noaa.gov/products/animations/sdo-hmii.json` (index of the last day's frames, ~15 min cadence); re-read every 5 min while the layer is on. Fallback snapshot `app/public/sky/sun/hmi.jpg` | Courtesy of NASA/SDO and the AIA, EVE, and HMI science teams |
| `sun-euv-171`, `sun-euv-195`, `sun-euv-304` | Extreme-ultraviolet images of the Sun, 1280 px | GOES-19 SUVI level-2 composites, NOAA SWPC / NESDIS | NOAA/NWS: public domain | https://www.swpc.noaa.gov/products/goes-solar-ultraviolet-imager-suvi | **Live**: `…/products/animations/suvi-primary-{171,195,304}.json` (4 min cadence), re-read every 5 min. Fallback `app/public/sky/sun/suvi-*.jpg` (half size) | NOAA Space Weather Prediction Center |
| `sun-corona-lasco` | White-light coronagraph images C2 (2-6 R☉) and C3 (4-30 R☉), 512 px | SOHO/LASCO, served by NOAA SWPC | SOHO: "use … for public education efforts and non-commercial purposes is strongly encouraged and requires no expressed authorization", credit requested | https://soho.nascom.nasa.gov/data/summary/copyright.html | **Live**: `…/products/animations/lasco-c2.json`, `lasco-c3.json` (~12 min cadence, 1-2 h behind real time), re-read every 5 min. Fallback `app/public/sky/sun/lasco-c2.jpg`, `lasco-c3.jpg` | Courtesy of SOHO/LASCO consortium. SOHO is a project of international cooperation between ESA and NASA. |
| `sun-corona-ccor1` | White-light coronagraph images (4-22 R☉), 1204 px | GOES-19 CCOR-1, NOAA SWPC / NESDIS | NOAA/NWS: public domain | https://www.swpc.noaa.gov/products/coronagraph | **Live**: `…/products/animations/ccor1/ccor1.json` (15 min cadence), re-read every 5 min. Fallback `app/public/sky/sun/ccor1.jpg` | NOAA Space Weather Prediction Center |
| `sun-activity` | Numbered active regions (heliographic latitude, Carrington longitude, area, McIntosh and magnetic class) | Solar Region Summary, NOAA SWPC with the USAF SOON network; issued daily at 00:30 UTC for the preceding day | NOAA/NWS: public domain | https://www.swpc.noaa.gov/products/solar-region-summary | **Live**: `…/json/solar_regions.json`, re-read every 10 min. Fallback: that day's rows in `app/public/sky/sun/snapshot.json` | NOAA Space Weather Prediction Center |
| `sun-activity` | GOES X-ray level, 10.7 cm flux, solar wind speed, daily sunspot number | NOAA SWPC | NOAA/NWS: public domain | https://services.swpc.noaa.gov/ | **Live**: `/json/goes/primary/xray-flares-latest.json`, `/products/summary/10cm-flux.json`, `/products/summary/solar-wind-speed.json`, `/text/daily-solar-indices.txt`, every 10 min. Fallback `snapshot.json` | NOAA Space Weather Prediction Center |
| `moon` | Map of the Moon: LRO Camera wide-angle colour mosaic | CGI Moon Kit, NASA's Scientific Visualization Studio (E. Wright, N. Petro), svs.gsfc.nasa.gov/4720 | NASA SVS: public domain, credit requested | https://svs.gsfc.nasa.gov/4720 | Baked: `tools/pipeline/generate_moon.py` → `app/public/sky/moon.jpg` (1024×512, 100 KB) | NASA's Scientific Visualization Studio |
| `constellations` | Stick figures and name positions of the 88 IAU constellations | d3-celestial by Olaf Frohn (`constellations.json`, `constellations.lines.json`), after the IAU / Sky & Telescope charts "with name positions and some line modifications" by Frohn | BSD 3-Clause, © 2015 Olaf Frohn (notice below) | https://github.com/ofrohn/d3-celestial | Baked: `tools/pipeline/generate_constellations.py` → `app/public/sky/constellations.json` (112 KB, with the boundaries) | d3-celestial © Olaf Frohn, BSD 3-Clause |
| `constellation-boundaries` | IAU constellation boundaries (Delporte 1930) | Catalogue of Constellation Boundary Data, Davenhall A.C., Leggett S.K. 1989 (CDS VI/49), file `constbnd.dat` (B. Gray's 2007 edition) | CDS/VizieR catalogue: free use with acknowledgement | https://vizier.cfa.harvard.edu/ftp/cats/VI/49/ | Baked: same script and file | Davenhall & Leggett 1989 (CDS VI/49) |
| `sky-grid` | Equatorial grid, celestial equator, ecliptic, galactic equator | none: geometry from the frames in `packages/core/src/astro` | - | - | computed | - |
| `milky-way` | All-sky map of the Milky Way's unresolved starlight | Deep Star Maps 2020, NASA/Goddard Space Flight Center Scientific Visualization Studio (E. Wright), from Gaia DR2 (ESA/Gaia/DPAC), Tycho-2 and Hipparcos-2 | NASA SVS: public domain, credit requested | https://svs.gsfc.nasa.gov/4851 | Baked: `tools/pipeline/generate_milkyway.py` (needs a venv with OpenEXR) → `app/public/sky/milkyway.jpg` (2048×1024, 281 KB) | NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC |

Total baked for the slice: 0.82 MB under `app/public/sky/` (excluding
`stars.json`) plus the 69 KB (gzipped) ephemeris chunk.

### d3-celestial licence notice

The constellation figures are redistributed in a derived form
(`constellations.json`), so the BSD 3-Clause notice is reproduced:

> Copyright (c) 2015, Olaf Frohn. All rights reserved.
> Redistribution and use in source and binary forms, with or without
> modification, are permitted provided that the following conditions are
> met: 1. Redistributions of source code must retain the above copyright
> notice, this list of conditions and the following disclaimer. 2.
> Redistributions in binary form must reproduce the above copyright
> notice, this list of conditions and the following disclaimer in the
> documentation and/or other materials provided with the distribution.
> 3. Neither the name of the copyright holder nor the names of its
> contributors may be used to endorse or promote products derived from
> this software without specific prior written permission.
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
> IS" AND ANY EXPRESS OR IMPLIED WARRANTIES … ARE DISCLAIMED.
> (full text: https://github.com/ofrohn/d3-celestial/blob/master/LICENSE)

## What was verified, and how

### Positions (`packages/core/src/astro/ephemeris.test.ts`)

Against JPL Horizons at 13 instants from 1900 to 2099, geocentric,
astrometric ICRF. Maximum error found:

| Body | Place | Other |
| --- | --- | --- |
| Sun | 0.04″ | distance 1.5e-7 au; from Austin, azimuth/elevation within 0.007° (that residual is aberration and nutation, which the app's frame leaves out for stars and Sun alike) |
| Mercury | 0.11″ | magnitude within 0.09 except a thin crescent (0.62 at phase angle 168°) |
| Venus | 0.25″ | magnitude within 0.18 |
| Mars | 0.17″ | magnitude within 0.09 |
| Jupiter | 0.45″ | magnitude within 0.02 |
| Saturn | 0.29″ | magnitude within 0.12, rings included |
| Uranus | 1.9″ | magnitude within 0.08 |
| Neptune | 2.4″ | magnitude within 0.13 |
| Moon | 4.1″ geocentric, 4.2″ from Austin (where parallax is up to a degree) | distance 4.7 km; illuminated fraction 0.004%; bright-limb angle 0.13° (0.3° within a day of new); libration 0.037°; axis position angle 0.03° |
| Sun's disc | B0 0.012°, P 0.014° | L0 within 0.13°: Horizons turns the Sun at the IAU's rounded 14.1844°/day, the app at Carrington's 25.38 d; they drift 0.1° per century |

Also: Meeus' worked example 47.a is reproduced to the printed digits,
and the total solar eclipse of 2026 August 12 is total from Burgos at
18:29 UTC in the app's ephemeris as in Horizons (centres 7″ and 12″
apart respectively, the Moon's disc 32″ larger in radius).

The repository's older low-accuracy Sun (`solarPosition`,
`subsolarPoint` in `packages/core/src/geodesy`) was measured against the
same Horizons rows: within 0.009° in elevation and 0.005° in azimuth at
all 13 instants. It feeds the day/night terminator and is left as it is.

### Solar image geometry (`tools/pipeline/test_sun_snapshot.py`)

The scale, centre and orientation of every product in
`app/src/layers/sun/products.ts` were measured from frames, not taken
from documentation:

- LASCO C3: plate solution against 37-40 catalogue stars (residual 0.8
  px): 112.6″/px; the top of the frame is 6.5° west of solar north,
  i.e. **ecliptic north** (prediction for that day: 6.3°). SOHO flies
  rolled to the ecliptic, and SWPC's frames are not rotated to the Sun's
  axis. The app turns LASCO frames accordingly.
- GOES-19 CCOR-1: plate solution against 22 stars (residual 0.6 px):
  39.97″/px, solar north up to 0.1°. The Sun's place among the frame's
  stars is 5 px (3′) from the limb circle the product draws; the star
  solution is used.
- LASCO C2 shows too few stars to solve; it shares C3's spacecraft roll,
  and its drawn limb circle gives centre and scale (41.0 px = the Sun's
  radius from L1 at 23.8″/px).
- SDO/HMI: limb fit, in November (237.8 px at 968.5″) and July (231.5 px
  at 943.9″): fixed plate scale 4.075″/px. Orientation: the test finds
  sunspots where NOAA's region list puts the large groups (AR 4566) and
  not at the mirrored places.
- GOES-19 SUVI: nominal 2.5″/px, centred, solar north up; only checked
  loosely (the disc fills the expected circle), since its EUV limb is too
  ragged to fit. The active-region labels fall on its bright regions.

### Baked data (`tools/pipeline/test_*.py`)

- `test_constellations.py`: 89 figures (Serpens in two parts), every
  corner on a star of `stars.json` within 0.1° (one documented
  exception, below), Orion's belt, the Big Dipper, Crux, Cassiopeia and
  Scorpius joined star to star; boundaries against VI/49's own J2000
  table and d3-celestial's Crux corner.
- `test_milkyway.py`: the bulge, the Scutum and Cygnus clouds, the Great
  Rift, both galactic poles, both Magellanic Clouds and the anticentre at
  their catalogue places, and not at the mirrored ones.
- `test_moon.py`: maria (Crisium, Imbrium, Tranquillitatis, Procellarum,
  Grimaldi, Moscoviense) darker than the highlands beside them; Tycho
  bright; Grimaldi west, not east.

## Notes: unverified, approximate, or licence-sensitive

- **SDO and SOHO terms are "non-commercial and public education" terms**,
  not public domain. This app qualifies; a commercial reuse of the app
  would need to revisit them. NOAA and NASA SVS material is public domain.
- **Live frames when the clock is pinned.** SWPC keeps one day of frames.
  With `?time=` set outside that day the newest frame is shown and the
  chip says "image of <time>" (stale), never "live".
- **LASCO frames arrive 1-2 hours late and are sometimes damaged** (the
  C3 frames of 2026-11-09 lack their western half). They are shown as
  served.
- **LASCO is seen from L1.** Background stars in LASCO frames sit up to
  0.26° from the app's stars (SOHO's halo orbit parallax). The corona
  itself is at the Sun and is unaffected.
- **LASCO during SOHO's 180° roll periods**: SWPC's frames are assumed
  to stay ecliptic-north-up (they did on the days measured, with the
  occulter pylon to the south-east). Not verified for a rolled period.
- **CCOR-1's Sun centre** (593.3, 593.5 px) comes from two star solutions
  twelve hours apart; whether its 5 px offset from the drawn limb circle
  is stable over months is not known.
- **Planet magnitudes** use the 1984 Astronomical Almanac formulae, not
  the Mallama & Hilton 2018 fits Horizons uses: up to 0.2 mag off, 0.6
  for a thin crescent of Mercury.
- **The Moon's physical libration** (up to 0.04°) is left out; so is the
  difference between the app's spherical Earth and the ellipsoid, which
  moves the Moon by up to 11″ for an observer.
- **Earthshine** on the Moon's night side is a fixed faint level scaled
  by the Earth's phase: present because it is real, but not photometry.
- **Planet colours** are drawing choices, not measurements. Planets are
  points at every zoom; no discs, rings, phases or satellites are drawn.
- **Aberration and nutation** (≤ 20″ and ≤ 17″) are left out for
  everything in the sky alike, so relative positions are right and
  absolute azimuth/elevation is within 0.01°.
- **ξ Ursae Majoris is missing from the star layer** (`stars.json`): the
  Hipparcos main catalogue has no position for HIP 55203, a close binary
  of V 3.8. Ursa Major's hind foot therefore ends on an empty spot. This
  belongs to the stars pipeline, not this slice; other bright Hipparcos
  entries without astrometry may be missing for the same reason.
- **Not built**: the Galilean moons and Titan (no compact theory was
  verified), planet discs, Pluto, GOES CCOR-2/SWFO-L1 imagery (SWPC
  serves it at `/images/animations/ccor2/`; not evaluated).
