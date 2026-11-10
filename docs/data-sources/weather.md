# Data sources: weather and surface imagery

Everything the Weather and Surface sections of the layers panel draw, where
it comes from, and on what terms. All of it is free, keyless and fetched with
ordinary anonymous GETs of global data: no request carries the user's location.

Checked from a browser on 2026-11-10: every live endpoint below answers with
`access-control-allow-origin: *`, and the headless-Chromium screenshots in
`~/review-loop/shots/weather/` were drawn from them.

## Weather layers (`app/src/layers/weather/`)

| Layer (id) | What | Source and citation | Licence | Live endpoint, cadence | Baked fallback |
|---|---|---|---|---|---|
| Clouds (`clouds`) | Longwave-infrared mosaic of the geostationary ring, ~73°S–73°N, greyscale, bright = cold | NOAA/NESDIS Global Mosaic of Geostationary Satellite Imagery (GMGSI), composited from Himawari-9, GOES-18, GOES-19, Meteosat-9 and Meteosat-10; served by NOAA nowCOAST | U.S. Government work, public domain (see note 1) | `https://nowcoast.noaa.gov/geoserver/satellite/wms`, layer `global_longwave_imagery_mosaic`, one 2048×1024 JPEG (~175 kB). Hourly, 1–3 h behind; only the last ~5 hours are served. The app reads the capabilities' time list every 20 min. | `app/public/weather/clouds.jpg` |
| Rain and snow (`precipitation`) | Precipitation rate, 0.1°, half-hourly, in GIBS's `GPM_Precipitation_Rate` palette | NASA GPM IMERG V07 half-hourly, Early run (GPM_3IMERGHHE), NASA GES DISC; imagery by NASA GIBS | Public domain / CC0 per NASA's data-use guidance | GIBS WMS `IMERG_Precipitation_Rate_30min`, one 2048×1024 PNG (~300 kB); time from WMTS `DescribeDomains`, checked every 15 min. ~5–6 h behind real time; archive back to 1998, so a pinned `?time=` is honoured. | `app/public/weather/precipitation.png` |
| Wind at the surface (`wind-10m`), Jet stream (`wind-250hpa`), Air temperature (`air-temperature`) | u/v wind at 10 m and at 250 hPa, 2 m temperature, 1° grid | NOAA/NCEP Global Forecast System (GFS), `pgrb2.1p00` files, via the NOAA Open Data Dissemination programme on AWS | "open to the public and can be used as desired"; NOAA asks for attribution and that no endorsement be implied (registry.opendata.aws/noaa-gfs-bdp-pds) | `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.YYYYMMDD/HH/atmos/gfs.tHHz.pgrb2.1p00.fFFF`: the `.idx` inventory (~40 kB), then each field by HTTP range (50–80 kB each; two per wind level, one for temperature). Runs every 6 h, published ~3.5 h later; forecast files every 3 h, so the field shown is valid within 1.5 h of the app clock. Checked every 30 min. Archive on the bucket goes back years, so a pinned `?time=` is honoured. | `wind-10m.bin`, `wind-250hpa.bin`, `temperature.bin` |
| Day and night (`day-night`) | Night-side city lights; terminator computed from the Sun's position | NASA Earth Observatory Black Marble 2016 (Suomi NPP VIIRS day/night band); imagery by NASA GIBS, layer `VIIRS_Black_Marble` | Public domain | None at run time: the lights never change, so the baked copy is the layer's only source | `app/public/weather/night-lights.jpg` (2048×1024) |

Baked by `tools/pipeline/generate_weather_snapshot.py` (checks:
`test_weather_snapshot.py`); valid times are in `app/public/weather/snapshot.json`.
The committed snapshot: clouds 2026-11-09 23:00 UTC, rain 2026-11-09 18:30 UTC,
GFS run 2026-11-09 18Z + 6 h (valid 2026-11-10 00:00 UTC). 0.83 MB in all.

## Surface imagery (`app/src/layers/surface-imagery/`)

All from NASA GIBS WMS (`https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi`),
one equirectangular image per product, live; dates from WMTS `DescribeDomains`.

| Layer (id) | GIBS product | Source | Licence | Date shown | Size |
|---|---|---|---|---|---|
| Satellite view, latest full day (`surface-true-colour`) | `VIIRS_NOAA20_CorrectedReflectance_TrueColor` | NASA/NOAA NOAA-20 VIIRS corrected reflectance | Public domain | newest UTC day whose passes are all in (yesterday from 05:00 UTC, else the day before) | 4096×2048 JPEG, ~2 MB |
| Earth at night (`surface-night-lights`) | `VIIRS_Black_Marble`, 2016 | NASA Earth Observatory, Suomi NPP VIIRS | Public domain | fixed | 4096×2048 JPEG, ~0.4 MB; falls back to the baked 2048×1024 copy |
| Relief and sea floor (`surface-relief`) | `BlueMarble_ShadedRelief_Bathymetry` | NASA Earth Observatory Blue Marble (August 2004, MODIS), shaded relief and bathymetry | Public domain | fixed | 4096×2048 JPEG, ~0.9 MB |
| Sea surface temperature (`surface-sst`) | `GHRSST_L4_MUR_Sea_Surface_Temperature` | GHRSST Level 4 MUR Global Foundation SST Analysis v4.1, NASA JPL (MUR-JPL-L4-GLOB-v4.1) | Public domain / CC0 per NASA's data-use guidance | newest day, usually yesterday | 2048×1024 PNG, ~0.7 MB |
| Sea temperature anomaly (`surface-sst-anomaly`) | `GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies` | as above; anomaly "derived from a MUR climatology" | as above | newest day | 2048×1024 PNG |
| Vegetation (`surface-vegetation`) | `MODIS_Terra_L3_NDVI_16Day` | NASA MODIS/Terra Vegetation Indices 16-Day L3 Global 250 m (MOD13Q1) | Public domain | newest 16-day composite | 2048×1024 PNG |
| Population density (`surface-population`) | `GPW_Population_Density_2020` | CIESIN, Columbia University: Gridded Population of the World v4, population density adjusted to UN WPP totals, doi:10.7927/H4HX19NJ; via NASA SEDAC | **CC BY 4.0** (attribution required; given in the in-app credits) | fixed | 2048×1024 PNG |

GIBS asks clients to acknowledge it: "We acknowledge the use of imagery
provided by services from NASA's Global Imagery Browse Services (GIBS), part
of NASA's Earth Science Data and Information System (ESDIS)." Every GIBS
credit in the app names GIBS (ESDIS).

Legends for the data products are GIBS's own colour maps
(`https://gibs.earthdata.nasa.gov/colormaps/v1.3/<name>.xml`), reduced to nine
stops by `tools/pipeline/gibs_legends.py`. The wind and air-temperature colour
scales are the app's own (`app/src/layers/weather/ramps.ts`); the legend is
generated from the same table the shader uses.

## Why these and not others

- **Clouds.** GIBS's geostationary layers (GOES-East, GOES-West, Himawari)
  have no Meteosat, leaving Europe, Africa and the western Indian Ocean
  blank - often exactly the far side the user is looking at. Daily
  VIIRS/MODIS true colour is a day old and is offered as a surface map
  instead. Open-Meteo's cloud cover is model output asked for point by
  point, and its free API is for non-commercial use only, under 10,000 calls
  a day per IP address. GMGSI is one observed image of the whole ring, hourly.
- **Rain.** IMERG is globally complete. RainViewer (the spec's first choice)
  was checked and not used: its API is now "for personal and educational use
  only", it has radar only where countries run radar, and its tiles are Web
  Mercator. Cost of the choice: IMERG trails real time by five to six hours,
  where radar would be ten minutes old.
- **Wind.** NOMADS (grib filter, OPeNDAP) sends no CORS headers; UCAR THREDDS
  sent none on data requests; the PacIOOS ERDDAP copy of GFS has CORS but is a
  surface subset (no 250 hPa) and took 5 s for a small request; Open-Meteo
  would need a global grid of points per refresh from each user's address,
  against its non-commercial 10,000-call daily limit. NOAA's
  own bucket has CORS (including for `Range`), every level, no quota - at the
  price of decoding GRIB2 in the browser (`grib2.ts`, 240 lines, checked
  against ecCodes).

## Accuracy checks

- **GRIB2 reader.** `tools/pipeline/grib2.py` against ecCodes 2.50 on seven
  global GFS fields (U/V at 10 m and 250 hPa, 2 m temperature, total cloud,
  precipitation rate): largest difference 6e-14. The TypeScript reader is
  tested on the same real subregion in both packings NCEP and NOMADS use.
- **Sun.** The terminator uses core's `subsolarPoint`. Against JPL Horizons
  (apparent RA/Dec and apparent sidereal time, seven dates 2024–2030) its
  largest error is 0.008° (under 1 km on the ground). The test pins those
  seven. (A first comparison against Horizons' sub-observer point *as seen
  from the Sun* was off by 2.07°: that quantity is where the Earth was
  8.3 minutes earlier. It is the wrong reference, not an error in the code.)
- **Orientation.** Night lights sit inside the coastline layer's outlines:
  the Nile and its delta, the Indo-Gangetic plain, Java, Johannesburg
  (`surface-night-lights-india-nile.png`, `day-night-india-nile-lights-19utc.png`).
  The 2 m temperature field shows the Ethiopian highlands and the Tibetan
  plateau cold inside the same outlines, which pins the GFS grid's
  half-degree registration.

## Notes, limits and things to decide

1. **GMGSI inputs.** The mosaic is a NOAA product, but two of its five inputs
   are EUMETSAT's Meteosats and one is JMA's Himawari. NOAA distributes the
   mosaic openly and NWS states its web information is public domain "unless
   specifically noted otherwise"; I found no such note for GMGSI, but
   nowCOAST's own terms page returned HTTP 403 to a script and was not read.
   Low risk, flagged for a human look.
2. **Infrared is not cloud cover.** The clouds layer shows cold cloud tops.
   Low warm cloud (marine stratus) is faint or missing; cold bare ground can
   read as thin cloud at high latitudes, which is why the layer's threshold
   rises toward the poles and the layer fades out between 63° and 72°.
3. **Clouds have no archive.** With `?time=` pinned to the past the layer
   shows nowCOAST's newest image and its chip says `latest · <time>` in the
   stale tone, not `live`.
4. **Precipitation is not animated.** The spec's two-hour loop is not built;
   the layer shows the newest half hour.
5. **Wind time is exaggerated**, necessarily (the captions say by how much),
   and the trails are a visual device: particles are seeded uniformly and
   live 2.5–7 s, so trail density says nothing about the air.
6. **Night side over the interior.** The night shade is drawn as an overlay
   on the far surface, like every draped shell, so it also dims the glass
   shells of the interior that lie in front of the night hemisphere.
7. **RainViewer and Open-Meteo are not used anywhere.** No source here has a
   non-commercial or share-alike clause; the one attribution-required licence
   is GPW's CC BY 4.0.
8. **Not decided here:** packages/core still exports the old `gfs`, `tiles`
   and `terminator` modules that the removed `app/src/weather/` scaffolding
   used; nothing in the app imports them now. `tiles` names RainViewer as a
   provider. Removing them touches core's shared index.

## Earth right now (added 2026-11-10)

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Earth right now (`earth-now`, lazy, off by default) | GeoColor images from GOES East (75.2°W) and GOES West (137.2°W), a new one every 10 minutes: true colour by day; by night infrared cloud over a **fixed** picture of city lights | NOAA/NESDIS GOES-R Advanced Baseline Imager; GeoColor by CIRA, Colorado State University (Miller et al. 2020, J. Atmos. Oceanic Technol. 37:429); served as map tiles by NASA GIBS | GOES data are a U.S. Government work (public domain). GeoColor is CIRA's product; NOAA distributes it freely and asks for the credit NOAA/CIRA. **No formal licence text was found for GeoColor itself.** | https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/GOES-East_ABI_GeoColor/… and GOES-West | Live (WMTS tiles, composed in the browser), last download kept in the Cache API, baked snapshot `app/public/weather/earth-now.webp` (88 kB) from `generate_earth_now_snapshot.py` | NOAA/CIRA; imagery by NASA GIBS |

What it is and is not:

- **Coverage is the two satellites' view**: about half the planet, the
  Americas and the eastern Pacific out to New Zealand. Europe, Africa and
  Asia are transparent and the base map shows there; GIBS carries no
  GeoColor for Meteosat or Himawari. The caption says "the half of the
  planet two weather satellites see".
- **The night side's city lights are not live.** GeoColor paints infrared
  cloud over a static lights picture at night. The caption says so.
- **The two pictures are joined** at 106.2°W, midway between the
  satellites, cross-faded over 8° of longitude. They can be up to ten
  minutes apart; the chip gives the older time.
- **Near each disc's edge** the satellite looks along the ground: the
  picture is stretched and hazy there. That is the data.
- The app's own time: with `?time=` pinned, the layer asks GIBS for the
  newest picture in the day before that time (GIBS keeps an archive with
  gaps back to 2021); if there is none the chip reads "latest" with the date
  of what is shown.

How it is fetched:

- The newest time comes from a `DescribeDomains` request limited to one day
  (about 370 bytes each; unlimited it is 580 kB per satellite).
- Tiles: level 2 (2560 px round the globe, 18 tiles, ~4.5 MB) on a pointer
  device; level 1 (1280 px, 8 tiles, ~1.3 MB) on touch devices. Re-checked
  every 10 minutes while the layer is on; a new picture is fetched only when
  GIBS has one.
- On 2026-11-10 GIBS's WMS endpoint (which the older GIBS layers here use for
  whole-globe images) was not answering at all, while the tile endpoint
  answered in 0.2–0.4 s. This layer uses tiles for that reason. **The older
  GIBS layers (satellite view of the latest full day, sea temperature,
  vegetation, rain) still depend on WMS** and fell back to their caches or
  snapshots that day; moving them to tiles is not done.

Checked:

- `geostationary.test.ts` (15): which tiles each satellite needs (East columns
  0–2, West 0, 1 and 4 across the date line), tile and domain addresses, the
  newest time from a domain clipped as GIBS clips it, one satellite missing,
  both missing.
- `tools/pipeline/test_earth_now_snapshot.py` (21): opaque at Austin, Quito,
  Hawaii, Buenos Aires, New Zealand and on the seam; transparent at Nairobi,
  Delhi, Berlin, Perth and the pole; 40–60% of the map covered; no hard step
  at the seam.
- In the app (`~/review-loop/shots/earth-now/`, 4 shots): chip "live · 10 Nov
  15:10 UTC"; South America in daylight and the Pacific at night seen through
  the Earth from Austin; phone-sized view 17.6 ms, desktop 16.8 ms. With
  `gibs.earthdata.nasa.gov` blocked the chip reads "offline · snapshot 10 Nov
  2026" and three requests are made in all.
- Not checked: a refresh arriving while the layer is shown (the ten-minute
  timer), the Cache API path on a second visit, a real phone.
