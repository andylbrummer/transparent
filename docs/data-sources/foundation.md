# Stars, the sky frame and the always-loaded map: data sources and verification

What the app shows before any optional layer is switched on, where it comes
from, and what was checked against what. Numbers are as measured on
2026-11-09 (UTC). The always-loaded map files are also described, file by
file, in `app/public/geo/ATTRIBUTION.md`.

## Datasets shipped

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Stars (`stars`, lazy, on by default) | Position, V magnitude and B−V colour of the 15,537 stars of V ≤ 7.0 that have astrometry | ESA (1997), The Hipparcos and Tycho Catalogues, ESA SP-1200; main catalogue, CDS I/239 | Free use with acknowledgement | https://www.cosmos.esa.int/web/hipparcos/catalogues (fetched from the CfA VizieR mirror, https://vizier.cfa.harvard.edu) | Baked: `tools/pipeline/generate_stars.py` → `app/public/sky/stars.json` | The Hipparcos and Tycho Catalogues, ESA SP-1200 (1997) |
| Stars | Positions of seven V ≤ 7 close binaries the main catalogue lists without astrometry (ξ UMa, ξ Sco, 94 Aqr and four fainter) | SIMBAD astronomical database, CDS Strasbourg (Wenger et al. 2000, A&AS 143, 9) | Free use with acknowledgement | https://simbad.cds.unistra.fr/simbad/ | Baked, same script | This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France |
| Stars: names | 344 proper names; drawn for stars of V ≤ 3.0 | IAU Working Group on Star Names, IAU Catalog of Star Names (IAU-CSN), version of 2022-04-04 | CC BY 4.0 (the file states IAU products are released under Creative Commons Attribution) | https://www.iau.org/public/themes/naming_stars/ (table from https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt) | Baked, same script | IAU Catalog of Star Names |
| Surface imagery (always loaded) | Blue Marble Next Generation, one 4096×2048 image | NASA Earth Observatory / NASA GIBS, layer `BlueMarble_NextGeneration` | Public domain; GIBS asks for acknowledgement | https://earthdata.nasa.gov/gibs | Live: composed after the page has loaded from the 50 GIBS map tiles of level 3 (matrix set `500m`, ~1.2 MB; `app/src/layers/weather/gibs-tiles.ts`), the baked copy showing until then. If it fails, the baked 2048×1024 copy `app/public/geo/blue-marble.jpg` (`tools/pipeline/generate_base_map.py`, 241 kB) takes its place and the HUD says "offline copy" | We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS) |
| Compass | Magnetic declination at the user's position | World Magnetic Model 2025, NOAA NCEI and British Geological Survey | Public domain | https://www.ncei.noaa.gov/products/world-magnetic-model | Coefficients compiled into `packages/core/src/magnetic/wmm2025.ts` | World Magnetic Model 2025 (NOAA NCEI / BGS) |
| Coastlines, borders, place names; plate boundaries; faults; hotspots and plumes; volcano names; plate motion; mantle flow | See `app/public/geo/ATTRIBUTION.md`, and for earthquakes, slabs and boundaries the earthquake and tectonics documents beside this one | | | | Baked | |

The user's position comes from the browser's Geolocation API and never
leaves the device: it is used only to place the camera. The one request made
before any layer is switched on is the Blue Marble image, an anonymous GET of
a global picture.

## What is computed rather than data

- **Where the sky is.** `packages/core/src/astro/index.ts` turns ICRS
  directions into Earth-fixed ones with IAU 1976 precession and IAU 1982
  mean sidereal time. Left out, and why it does not matter here: nutation
  (≤ 17″), polar motion (≤ 0.5″), UT1−UTC (≤ 0.9 s, 13″), annual aberration
  (≤ 20″), refraction (the app shows the geometric sky, also below the
  horizon).
- **Star places.** Hipparcos positions are for epoch J1991.25; each star is
  carried along its catalogued proper motion to 2026.0. Parallax and radial
  velocity are ignored (under an arcsecond).
- **Star colour and size.** Colour is the black-body colour of the
  temperature given by B−V (Ballesteros 2012, EPL 97, 34008), pulled
  part-way to white; drawn size and opacity are functions of V chosen for
  legibility (`app/src/render/star-color.ts`). They are a drawing
  convention, not photometry.
- **Sky below the horizon** is the real sky in its real place, drawn at
  35 % brightness as if the planet were glass.

## What was verified

- **Sky frame against JPL Horizons.** Azimuth and elevation from
  97.74°W 30.27°N for the Sun (four instants over 2026-11-09/10), the Moon,
  Mars and Jupiter, taken from Horizons observer tables (airless,
  astrometric ICRF RA/Dec in, apparent az/el out): all within 0.02°. Pinned
  in `packages/core/src/astro/index.test.ts`. Sidereal time and precession
  reproduce Meeus, *Astronomical Algorithms*, examples 12.b and 21.b.
- **Star bake** (`tools/pipeline/test_stars.py`): positions against places
  worked independently from SIMBAD's J2000 position and proper motion —
  Sirius 0.2″, Arcturus 0.2″, Vega 1.4″, Polaris 0.1″, Betelgeuse 0.7″,
  α Centauri 2.2″ (its orbit); magnitudes within 0.15; Barnard's Star
  (V 9.5) absent; 63 % of stars within 30° of the galactic plane. ξ UMa and
  ξ Sco are pinned against the Bright Star Catalogue.
- **By eye.** From Austin at 2026-11-09 06:00 UT looking east, Orion is
  rising with Gemini to its north and Sirius low in the east-south-east.
  Constellation figures baked later from an independent source land on
  these stars.
- **Frame time** at 412×892, device pixel ratio 2, on Intel Iris Xe through
  headless Chromium: 16.6 ms (the vsync floor) with stars on.

## Notes

- The CDS Strasbourg hosts timed out from the build machine on 2026-11-09;
  the bake lists the CfA mirror first and the CDS original second. Both
  serve the same catalogue.
- The Hipparcos magnitude limit is V 7.0, slightly beyond the naked eye, so
  that zoomed views are not empty. Stars fainter than the catalogue's
  completeness (about V 7.3) are not shown.
- Nothing has been measured on a phone or headset.
