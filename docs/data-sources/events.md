# Events, hazards and small bodies: data sources and verification

Everything the `events` slice draws - tropical cyclones, fireballs, meteorites, live natural events, tsunamis,
the NASA GIBS overlays, ice, the small bodies of the solar system, asteroids passing the Earth, and the
transient sky - where it comes from, under what terms, and what was checked against what. Numbers are as
measured on 2026-11-09/10 (UTC). Every layer is off by default.

Baked for the slice: about 3.0 MB under `app/public/geo/` and `app/public/sky/`.

Sources whose terms need the owner's decision: GDACS (live cyclones; only a disclaimer is published, the
European Commission reuse policy is presumed), "Meteorite Landings" (NASA Open Data states no licence; the data
is the Meteoritical Society's), the LIGO/Virgo/KAGRA sky maps (public release without licence text), and the
CHIME/FRB, Asiago and ASAS-SN catalogues (published catalogues used with citation, no explicit data licence).
Each sits in its own file and layer and can be removed alone.

## Tropical cyclones

| Layer | What | Source + citation | Licence | URL | Baked or live (script / endpoint, cadence) | Attribution |
| --- | --- | --- | --- | --- | --- | --- |
| Major hurricanes and typhoons since 1980 (`cyclone-tracks`) | Best tracks of the 1,135 storms whose U.S. 1-minute wind reached 96 kt (Saffir-Simpson category 3) in the 1980–2026 seasons, plus Tip 1979 and Camille 1969: position, time and wind at six-hourly records, landfall and peak records; peak wind and lowest pressure per storm | IBTrACS v04r01, NOAA NCEI. Knapp, K. R. et al. (2010), BAMS 91, 363–376, doi:10.1175/2009BAMS2755.1; Gahtan, J. et al. (2024), IBTrACS version 4r01, doi:10.25921/82ty-9e16 | public domain (U.S. Government work) | https://www.ncei.noaa.gov/products/international-best-track-archive | Baked: `tools/pipeline/generate_cyclones.py` → `app/public/geo/cyclone-tracks.json` (148 kB) + `cyclone-tracks.bin` (381 kB), from `csv/ibtracs.ALL.list.v04r01.csv` (333 MB, not committed). Last record 5 Nov 2026 | IBTrACS v04r01, NOAA NCEI |
| Tropical cyclones now (live) (`cyclones-live`) | Storms with an advisory in the ten days up to the app clock: every advisory's position and sustained wind, the latest advisory's forecast points, the forecast's cone of uncertainty | Global Disaster Alert and Coordination System (GDACS), European Commission JRC and UN OCHA, compiled from NOAA NHC/CPHC, JTWC and WMO RSMC advisories | No licence stated on gdacs.org (terms page is a disclaimer only). European Commission content falls under its reuse decision 2011/833/EU (CC BY 4.0) - **presumed, not stated: needs Andy's decision** | https://www.gdacs.org/ | Live: `gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC…` (one request an hour while the layer shows), then per storm `events/getepisodedata`, `export/gettimeline` and, for a storm still forecast, `polygons/getgeometry` - only when its advisory number has changed. localStorage cache; retry after 2 min on failure. Fallback snapshot baked by `generate_cyclones.py --snapshot` → `app/public/geo/cyclone-live-snapshot.json` (19 kB, 10 Nov 2026 05:13 UTC) | GDACS (European Commission JRC, UN OCHA) |

Notes

- CORS, checked with `curl -H "Origin: …"` and in headless Chromium from the dev server: all four GDACS endpoints send `access-control-allow-origin: *` and load in the page. **NHC `CurrentStorms.json` sends no CORS header** (checked 10 Nov 2026), so it and NHC's GIS products cannot be read by a browser; GDACS carries the same NHC/CPHC advisories. IBTrACS's near-real-time `ibtracs.ACTIVE.list` CSV does have CORS and is public domain, but trails by two days (file of 8 Nov on 10 Nov) and has no forecasts, so it is not used live.
- GDACS answers take about 2 s each; the first load of the live layer with five storms listed takes 8–10 s. One list request in ~10 during development failed ("Failed to fetch") and succeeded on retry.
- Verified against agency reports in `test_cyclones.py`: Katrina 2005 peak 150 kt / 902 hPa and a record at 11:10 UTC 29 Aug 2005 at 110 kt within 15 km of Buras, Louisiana (NHC TCR AL122005); Patricia 2015 185 kt / 872 hPa, the strongest in the set (NHC TCR EP202015); Haiyan 2013 170 kt with the track line within 25 km of Guiuan, Samar; Tip 1979 870 hPa on 12 Oct 1979, the deepest in the set. Screenshots: Katrina in the Gulf of Mexico at ?time=2005-08-28T18:00Z labelled Cat 5 · 150 kt; Haiyan east of Samar at ?time=2013-11-07T18:00Z; live storms Cempaka (25°N 138°E) and Pena (11.7°N 162.7°W) on 10 Nov 2026 matching GDACS's and NHC's own figures.
- Selection uses only the U.S. agencies' 1-minute winds (USA_WIND), the one series on the Saffir-Simpson scale's averaging time in every basin. Five early-1980s southern-hemisphere storms with a WMO 10-minute wind of 85 kt or more and no U.S. wind are therefore absent. Track legs with no U.S. wind are drawn grey-blue.
- The list of storms named first (33: Katrina, Haiyan, Patricia, Tip…) is an editorial pick in `generate_cyclones.py`; every one is resolved in IBTrACS by name, year and basin, and all figures in labels are IBTrACS's.
- Live winds are whatever the warning centre reports, converted from GDACS's m/s to knots and rounded to 5 kt. NHC/CPHC/JTWC winds are 1-minute; a storm GDACS takes from a WMO RSMC (source "RSMC", e.g. La Réunion) has 10-minute winds, and its Saffir-Simpson class in the label is then an understatement. Not corrected, not flagged per storm in the UI.
- "Under way" is decided by the app clock: within 12 h of the latest advisory, or within 36 h while the latest forecast still runs past the clock. Between advisories the symbol stays at the last reported position; it is not moved along the forecast.
- With ?time= in the past the live layer asks GDACS's archive for that week (works back to at least 2013; older timelines use another date format, handled) and cuts each track at the clock. No forecast is drawn then: GDACS keeps only each storm's final one.
- The cyclone symbol's rotation (counter-clockwise in the northern hemisphere seen from above, mirrored when seen from under the surface) is a drawing, not data.

## Impacts, natural events now, tsunamis

| Layer | What | Source + citation | Licence | URL | Baked or live (script / endpoint, cadence) | Attribution |
| --- | --- | --- | --- | --- | --- | --- |
| Fireballs (bolides) since 1988 (`fireballs`) | 888 fireballs with a reported position (of 1,074 in the table; 602 with an altitude): time of peak brightness, lat/lon, altitude, speed, total impact energy (kt), radiated energy | NASA/JPL Center for Near Earth Object Studies (CNEOS), Fireball and Bolide Data, Fireball Data API v1.2 (U.S. Government sensors) | NASA/JPL data, free use with credit | https://cneos.jpl.nasa.gov/fireballs/ · https://ssd-api.jpl.nasa.gov/fireball.api | Baked: `tools/pipeline/generate_fireballs.py` → `app/public/geo/fireballs.json` (108 kB). The API sends no `access-control-allow-origin`, so no live refresh; the chip shows the fetch date. Re-run a few times a year. | Courtesy NASA/JPL-Caltech (CNEOS) |
| Meteorites: falls and great masses (`meteorite-falls`) | 1,096 located observed falls and the 48 finds of ≥ 1 t: name, year, mass, class, place of recovery | "Meteorite Landings", NASA Open Data Portal; a 2013 export of The Meteoritical Society's Meteoritical Bulletin Database (45,716 records) | **none stated** by the portal ("License not specified") — see notes | https://data.nasa.gov/dataset/meteorite-landings | Baked: `tools/pipeline/generate_meteorites.py` → `app/public/geo/meteorites.json` (51 kB). Static (the export ends in 2013). | Meteorite Landings, NASA Open Data Portal; The Meteoritical Society, Meteoritical Bulletin Database |
| Natural events now (live) (`hazards-live`) | Wildfires, erupting volcanoes, severe storms, floods, icebergs: title, category, latest position and date, magnitude where given | NASA Earth Observatory Natural Event Tracker (EONET) v3; EONET curates from GDACS, InciWeb/IRWIN, Smithsonian GVP, U.S. National Ice Center, BYU, JTWC, NOAA NHC | NASA open data, no restrictions on use | https://eonet.gsfc.nasa.gov/docs/v3 | Live: `https://eonet.gsfc.nasa.gov/api/v3/events` with two queries (`status=open&category=volcanoes,seaLakeIce,severeStorms` and `status=all&days=14&category=wildfires,floods,…`), every 30 min while shown, cached in localStorage. Fallback baked by `tools/pipeline/generate_hazards_snapshot.py` → `app/public/geo/hazards-snapshot.json` (92 kB, 377 events of 10 Nov 2026), shown under a stale chip with its date. | NASA EONET |
| Tsunamis in history (`tsunamis`) | 641 tsunami source events (of 3,140): date, source position, cause, maximum water height, deaths from the tsunami, earthquake magnitude | National Geophysical Data Center / World Data Service: NCEI/WDS Global Historical Tsunami Database. NOAA National Centers for Environmental Information. doi:10.7289/V5PN93H7 | public domain (U.S. Government work) | https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/tsunamis/events | Baked: `tools/pipeline/generate_tsunamis.py` → `app/public/geo/tsunamis.json` (104 kB). The API is CORS-enabled but the history changes a few times a year: re-run then. | NOAA NCEI/WDS Global Historical Tsunami Database, doi:10.7289/V5PN93H7 |

Notes

- **CORS, checked with `curl -H "Origin: …"` and in headless Chromium.** EONET answers `Access-Control-Allow-Origin: *` and the
  layer loaded 377 events live in the browser ("live · 377 events"); with EONET blocked in the browser the chip read
  "offline · snapshot 10 Nov 2026". The CNEOS fireball API sends no CORS header: baked only. The NCEI HazEL API sends
  `access-control-allow-origin: *` but is baked anyway (history, not news).
- **Fireballs.** Pinned in `test_fireballs.py`: Chelyabinsk 2013-02-15 03:20:26 UTC at 54.8 N 61.1 E, 23.3 km, 18.6 km/s,
  441 kt, the table's largest; Bering Sea 2018-12-18 at 56.9 N 172.4 E, 26 km, 49 kt. Those two are the only named events
  (the table has no names; both names are NASA's). In the screenshot the Chelyabinsk spark sits in the southern Urals just
  north of Kazakhstan. Events without a position (186) are left out; events without an altitude (286) are drawn on the
  ground at half opacity, not at a guessed height. CNEOS positions are given to 0.1°. The table is not a complete census:
  CNEOS says it holds only what the sensor operators release.
- **Meteorites — licence needs the owner's decision.** The NASA portal entry states no licence. The table is facts
  compiled by The Meteoritical Society (whose own database page asks for citation) republished by a U.S. Government
  portal; it is in its own file (`meteorites.json`) and its own layer folder and can be dropped without touching anything
  else. The export is frozen at 2013 (Chelyabinsk is the newest fall): falls since then are missing. Records at exactly
  0 N 0 E (missing positions written as zeros) and records without a position are left out (11 of 1,107 falls). One known
  discrepancy is kept as the table has it: Ensisheim is dated 1491 (it fell in November 1492). Pinned in
  `test_meteorites.py`: Hoba 60 t at 19.58 S 17.92 E, Cape York, Canyon Diablo, Willamette, Sikhote-Alin 23 t 1947,
  Allende 2 t 1969, Chelyabinsk, Murchison, Peekskill. Positions are places of recovery, to the table's precision.
- **Natural events.** EONET is a curated list, not a census: wildfires outside the U.S. come from GDACS (large fires
  only), U.S. ones from IRWIN; floods are GDACS alerts; "volcanoes" are eruptions the Smithsonian lists as continuing.
  Each event is one marker at its latest report (a flood polygon at the middle of its bounding box); storm tracks are not
  drawn here (the cyclone layers do that). EONET's `closed` date is kept but not drawn: GDACS-fed events are closed the day
  they open. Fires and floods fade with the age of their latest report instead. Events dated after the app clock are
  hidden; ages count from the app clock. The EONET list carries no build time, so the "live" chip shows the fetch time.
  The snapshot test pins any of Fuego, Etna, Sakurajima, Popocatépetl, Kīlauea present to their GVP positions (Fuego was).
- **Tsunamis.** Positions are of the SOURCE (epicentre, slide, volcano), not of the coasts reached: Lituya Bay 1958 is
  NCEI's 58.37 N 136.67 W on the Fairweather Fault, about 60 km from the bay (the test allows that). Kept: validity 3–4
  (probable/definite), located, and run-up ≥ 1 m or deaths from the tsunami itself — NCEI's `deaths`, not `deathsTotal`,
  so the 2023 Türkiye earthquake's toll does not appear as a tsunami's. Four events whose NCEI location name is only a
  region are shown under the name they go by (`KNOWN_AS` in the script: Lituya Bay, Indian Ocean (Sumatra), Tōhoku, Chile
  (Valdivia)); all other names are NCEI's, re-cased. Pinned in `test_tsunamis.py`: Lituya Bay 524.6 m / 5 dead; 2004
  50.9 m / 227,899 dead / M9.1 at 3.30 N 95.98 E; 2011 39.26 m / 18,423 / M9.1; 1960 25 m / 2,226 / M9.5; Krakatau 1883
  41 m / 34,417, cause volcano. Historical death tolls and pre-instrumental heights are as uncertain as NCEI's sources.
- **Frame time** (412×892 @2x, Iris Xe, measured while four sibling agents loaded the machine to a load average of 17):
  default layers 18.6–25 ms, with all four layers on 16.7–30 ms — no difference beyond the noise. The four layers are
  ~3,000 point sprites in four draw calls with no per-frame CPU work.

## Earth overlays and ice

Layers in `app/src/layers/earth-overlays/` (ten GIBS products, one at a time, exclusive group `earth-overlays`)
and `app/src/layers/ice/` (four layers). All default OFF, section Surface, orders 82–96.

| Layer | What | Source + citation | Licence | URL | Baked or live (script / endpoint, cadence) | Attribution |
| --- | --- | --- | --- | --- | --- | --- |
| `overlay-sea-ice` | Sea ice concentration 0–100 %, both poles, daily 0.25° analysis | JPL MUR MEaSUREs Project, GHRSST Level 4 MUR 0.25deg Global Foundation Sea Surface Temperature Analysis (v4.2), NASA/JPL PO.DAAC, doi:10.5067/GHM25-4FJ42; GIBS layer `GHRSST_L4_MUR25_Sea_Ice_Concentration` | NASA EOSDIS data: free and open, cite the source | https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi | Live: GIBS WMS GetMap, 2048×1024 PNG, newest date of the product's time domain (WMTS DescribeDomains); checked hourly while shown | JPL MUR MEaSUREs Project / NASA PO.DAAC; imagery by NASA GIBS |
| `overlay-snow` | Snow cover, mean % of the latest whole month, 0.05° | MODIS/Terra Snow Cover Monthly L3 Global 0.05Deg CMG V061 (MOD10CM), NASA NSIDC DAAC, doi:10.5067/MODIS/MOD10CM.061; GIBS `MODIS_Terra_L3_Snow_Cover_Monthly_Average_Pct` | NASA EOSDIS: free and open, cite | as above | Live, newest month (P1M domain) | NASA NSIDC DAAC (MOD10CM); imagery by NASA GIBS |
| `overlay-fires` | Active fires and thermal anomalies, 375 m, day + night | VIIRS NOAA-20 (JPSS-1) 375m I-Band Active Fire Product NRT (VJ114IMGT_NRT), NASA LANCE/FIRMS, doi:10.5067/FIRMS/VIIRS/VJ114IMGT_NRT.002; GIBS `VIIRS_NOAA20_Thermal_Anomalies_375m_All` | NASA EOSDIS: free and open (LANCE NRT disclaimer applies: not for tactical use) | as above | Live, 4096×2048 PNG, newest complete UTC day (the surface-imagery layers' rule: now − 29 h) | NASA LANCE / FIRMS; imagery by NASA GIBS |
| `overlay-aerosol` | Total aerosol optical thickness 550 nm, monthly mean | NASA GMAO, MERRA-2 tavgM_2d_aer_Nx V5.12.4 (M2TMNXAER), NASA GES DISC, doi:10.5067/FH9A0MLJPC7N; GIBS `MERRA2_Total_Aerosol_Optical_Thickness_550nm_Extinction_Monthly` | NASA EOSDIS: free and open, cite | as above | Live, newest month | NASA GMAO MERRA-2 / GES DISC; imagery by NASA GIBS |
| `overlay-no2` | Tropospheric NO₂ column, daily | Copernicus Sentinel data processed by ESA and KNMI, Sentinel-5P TROPOMI Tropospheric NO2 1-Orbit L2 (S5P_L2__NO2____HiR), NASA GES DISC, doi:10.5270/S5P-9bnp8q8; GIBS `TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column` | Copernicus Sentinel data: free, full and open with attribution ("contains modified Copernicus Sentinel data") | as above | Live, two days before the product's newest date (the newest two are still filling in) | Contains modified Copernicus Sentinel-5P data (ESA/KNMI); NASA GES DISC; imagery by NASA GIBS |
| `overlay-carbon-monoxide` | CO volume mixing ratio at 500 hPa, monthly mean, daytime | AIRS Science Team / J. Teixeira, AIRS/Aqua L3 Monthly Standard Physical Retrieval (AIRS-only) 1°×1° V006 (AIRS3STM), NASA GES DISC, doi:10.5067/Aqua/AIRS/DATA321; GIBS `AIRS_L3_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Monthly_Day` | NASA EOSDIS: free and open, cite | as above | Live, newest month | AIRS Science Team / NASA GES DISC; imagery by NASA GIBS |
| `overlay-ozone` | Total column ozone, daily | G. Jaross, OMPS-NPP L2 NM Ozone (O3) Total Column swath orbital V2 (OMPS_NPP_NMTO3_L2; NRT stream NMTO3NRT), NASA GES DISC, doi:10.5067/0WF4HAAZ0VHK; GIBS `OMPS_Ozone_Total_Column` | NASA EOSDIS: free and open, cite | as above | Live, the day before the product's newest date | NASA OMPS / GES DISC; imagery by NASA GIBS |
| `overlay-water-vapour` | Total precipitable water vapour, monthly mean | NASA GMAO, MERRA-2 instM_2d_int_Nx V5.12.4 (M2IMNXINT), NASA GES DISC, doi:10.5067/KVTU1A8BWFSJ; GIBS `MERRA2_Total_Precipitable_Water_Vapor_Monthly` | NASA EOSDIS: free and open, cite | as above | Live, newest month | NASA GMAO MERRA-2 / GES DISC; imagery by NASA GIBS |
| `overlay-soil-moisture` | Surface (0–5 cm) soil moisture, 12:00 UTC analysis | SMAP L4 Global 3-hourly 9 km EASE-Grid Surface and Root Zone Soil Moisture Analysis Update V008 (SPL4SMAU), NASA NSIDC DAAC, doi:10.5067/02LGW4DGJYRX; GIBS `SMAP_L4_Analyzed_Surface_Soil_Moisture` | NASA EOSDIS: free and open, cite | as above | Live, newest date | NASA SMAP / NSIDC DAAC; imagery by NASA GIBS |
| `overlay-lightning` | Lightning flash rate climatology, 0.5° (GIBS dates it 1995-05-04 + 6817 d) | LIS/OTD 0.5 Degree High Resolution Full Climatology (HRFC) V2.3.2015, NASA GHRC DAAC, doi:10.5067/LIS/LIS-OTD/DATA302; GIBS `LIS_High_Resolution_Full_Climatology_Combined_Flash_Rate_Climatology` | NASA EOSDIS: free and open, cite | as above | Live from GIBS (2048×1024, undated); baked fallback `app/public/geo/overlay-lightning.png` 1024×512, 137 KB (`generate_overlay_snapshot.py`) shown with an "offline · low-resolution copy" chip | NASA GHRC DAAC (LIS/OTD HRFC); imagery by NASA GIBS |
| `glaciers` | Glaciers, ice caps, ice sheets (mask, red) and Antarctic ice shelves (green); 60 names with outline areas | Natural Earth 1:10m physical vectors: glaciated areas, Antarctic ice shelves | public domain | https://www.naturalearthdata.com/downloads/10m-physical-vectors/ | Baked: `generate_ice.py` → `geo/ice-mask.png` (4096×2048, 87 KB), `geo/ice.json` (5 KB) | Made with Natural Earth |
| `sea-ice-extent` | Edge of the sea ice (15 % concentration) at both poles on a day, the 1981–2010 median edge for that day of year, and the extents in million km² | Fetterer, F., Knowles, K., Meier, W. N., Savoie, M., Windnagel, A. K. & Stafford, T. (2025), Sea Ice Index, Version 4 (G02135), National Snow and Ice Data Center, doi:10.7265/a98x-0f50 | Free to use with citation (NOAA@NSIDC; "you must cite the use of this data set") | https://nsidc.org/data/g02135 · files under https://noaadata.apps.nsidc.org/NOAA/G02135/ | Baked: `generate_ice.py` → `geo/sea-ice-extent.json` (301 KB): 25 days = newest (8 Nov 2026) + the 1st and 15th of the 12 months before. Not live: the NSIDC file server sends no `access-control-allow-origin` (checked with `curl -sI -H "Origin: https://example.org"`). Re-run the script to refresh | Sea Ice Index v4, NOAA@NSIDC (Fetterer et al. 2025) |
| `antarctic-ice-thickness`, `antarctic-bed` | Thickness of the Antarctic ice (grounded and floating) and elevation of the bed under it | Pritchard, H., Fretwell, P., Fremand, A., Bodart, J., Kirkham, J., Aitken, A., et al. (2024), BEDMAP3 – Ice thickness, bed and surface elevation for Antarctica – gridding products (Version 1.0), NERC EDS UK Polar Data Centre, doi:10.5285/2d0e4791-8e20-46a3-80e4-f5f6716025d2; paper: Pritchard et al. (2025), Sci. Data 12, 414, doi:10.1038/s41597-025-04672-y | CC BY 4.0 | https://doi.org/10.5285/2d0e4791-8e20-46a3-80e4-f5f6716025d2 | Baked: `generate_antarctic_ice.py` (needs h5py: venv documented in the script; 2.5 GB keyless download) → `geo/antarctic-ice-thickness.png` (181 KB), `geo/antarctic-bed.png` (161 KB), `geo/antarctic-ice.json` (<1 KB); 2048×256 strips, lat −58…−90, 4 km block means | Bedmap3, Pritchard et al. (2024), UK Polar Data Centre, CC BY 4.0 |

Baked assets for this part total 0.87 MB.

### How the overlays are fetched and dated

- Reuse, not copies: `overlay.ts` imports `imagerySource`/`undatedStatus` from `surface-imagery/imagery.ts`,
  `ProductWatcher`/`cacheStore`/`fetchOk`/`decodeImage` from `weather/live.ts` and the time-domain helpers from
  `weather/gibs.ts`. No shared file was changed. The image goes on a `SurfaceShell` at ground level
  (render order surfaceShell + 0.03: over the night side, under air temperature, clouds and rain), not into the
  globe's base-map slot, so any base map stays underneath.
- CORS verified: `curl -sI -H "Origin: https://example.org"` on a GIBS WMS GetMap returns
  `access-control-allow-origin: *`; all ten products were fetched and drawn in headless Chromium (status chips
  in the screenshot runs: "live · 8 Nov 2026" etc.).
- Every product id, its date range and its colour map come from `tools/pipeline/gibs_overlay_legends.py`
  (GIBS WMTS GetCapabilities + colour-map XML v1.3; run it before adding or renaming a product; it fails if a
  product is gone). Legends in `layer.ts` are those colour maps reduced to nine stops; ranges and units are the
  colour maps' own. As read on 9–10 Nov 2026 the newest dates were: sea ice 2026-11-08, snow 2026-10 (month),
  fires 2026-11-09, aerosol 2026-08, NO₂ 2026-11-10, CO 2026-09, ozone 2026-11-02, water vapour 2026-08,
  soil moisture 2026-11-06.
- Chips: daily products "live · <date>" (or "latest · <date>" when older than 10 days against the app clock,
  "offline · cached <date>" from the Cache API copy); monthly means "mean of Aug 2026", tone info, never
  'live'. `?time=` works: the newest date at or before the pinned instant is asked for. Dated products have
  no baked fallback (an old day must not pass for today): offline with no cached copy they show "unavailable".
- Three drawing choices that depart from GIBS's rendering, all stated in captions:
  1. `overlay-snow`: GIBS's yellow→red palette is read back from its green channel and redrawn blue-grey→white,
     in the palette's five steps (0 % — drawn green by GIBS — is dropped). The legend is the redrawn ramp.
  2. `overlay-aerosol`, `-no2`, `-carbon-monoxide`, `-water-vapour`: GIBS colours unchanged, but opacity falls to
     14 % where the palette is pale (low values), so the base map shows through gapless fields.
  3. `overlay-fires`: detections are 1–2 texels, drawn at full strength at any coverage (colour sampled from
     the image: #f02828; the product has no colour map).
- `overlay-ozone` uses the Suomi-NPP OMPS stream, whose newest listed day on 10 Nov 2026 was 2 Nov (several
  SNPP products stop there — the stream may be interrupted). The chip shows the true date (1 Nov 2026). If the
  stream has ended, switch the product to `OMI_Ozone_DOAS_Total_Column` (has permanent row-anomaly stripes).

### Verified

- Sea-ice projection: `test_ice.py` pins the polar stereographic inverse (Hughes 1980, EPSG:3411/3412) to the
  eight grid corners in NSIDC's projection guide: worst error 0.005°. Grid orientation is pinned to the grids'
  own land mask at 10 places (Greenland summit, Hudson Bay, South Pole, Weddell Sea …). Every baked extent and
  median figure equals the Sea Ice Index CSV value (re-read in the test). September edge is ~15° of latitude
  poleward of March's in the Arctic (mean 76.9°N vs 61.8°N); the September median edge passes 0.6° from
  75°N 15°W (East Greenland) and stays 8° clear of the southern Barents Sea.
- Land ice: mask checked at 6 ice places, 5 ice-free places and 3 ice shelves; Vatnajökull outline 8,492 km²
  (≈7,700 km² today; Natural Earth is generalised), Greenland Ice Sheet 1.77 M km², Ross Ice Shelf 501,000 km².
- Bedmap3: thickest ice comes out 4,757 m at 76.052°S 118.378°E, the paper's own figure; Vostok 3,780 m
  (the borehole met the lake at about 3,770 m), Dome C 3,240 m (EPICA core about 3,260 m), South Pole 2,800 m
  - these three reference depths are widely reported figures used as wide test brackets, not fetched values; bed at Vostok −302 m; Bentley trench below −2,000 m; Gamburtsev
  mountains +1,568 m; mean thickness 1,954 m; 13.56 M km² under ice (nominal cell areas).
- Lightning: opaque pixels are 100 % colours of the product's colour map; Congo basin and Lake Maracaibo read
  at the top of the scale, open South Pacific at the bottom.
- Screenshots (`~/review-loop/shots/events/overlays-*.png`): coastlines line up with the ice mask, the Bedmap3
  strip and the sea-ice edges at both poles; the Antarctic median edge lies outside the 8 Nov 2026 edge,
  consistent with 15.31 vs 16.84 M km².

### Approximate, unverified, licence notes

- Frame time at 412x892 dpr 2 on this machine: 16.7 ms with only coastlines; 16.7 ms with any one overlay; 16.7 ms
  with glaciers + sea-ice edges; 16.7 ms with thickness + glaciers + edges + sea-ice overlay; 16.7 ms with the
  default layers, and with the defaults plus aerosol, glaciers and edges (all at the vsync floor).
- Swath products keep their real gaps: the ozone and NO2 maps have a thin seam and a wedge at the 180th
  meridian where one day's orbits begin and end, and NO2 is speckled where retrievals failed (cloud).
- The layers panel's legends were not screenshotted (the Surface section is collapsed by default in the
  polish agent's panel); legends were checked as CSS strings in tests only.

- Sea ice is NOT live. It is a baked year of days; past the newest baked day the layer keeps showing it with
  its date and age in the chip ("snapshot · 8 Nov 2026 · 47 d old"). Before the first baked day, or for dates
  with no day within 9.5 d, nothing is drawn and the chip says so.
- The ice edge is traced through midpoints of the 25 km grid and thinned to 8 km: good to about a grid cell.
  Squares touching land are skipped, so the line stops short of coasts by up to 25 km.
- Glacier areas in labels are the area of Natural Earth's generalised outline, to two significant figures.
- "Deepest bed under grounded ice" (−2,973 m at 80.71°S 155.58°E) is the minimum of Bedmap3's bed grid over
  mask class 1; BedMachine's often-quoted −3,500 m under Denman Glacier is a different model and is not shown.
- Antarctic strips average 8×8 cells (4 km) and quantise to 20 m (thickness) / 34 m (bed).
- Greenland thickness/bed: not done. BedMachine Greenland needs an Earthdata login; no keyless equivalent was
  found.
- Licences: everything is public domain, NASA open data, CC BY 4.0 (Bedmap3), cite-to-use (NSIDC Sea Ice
  Index) or Copernicus open (TROPOMI NO₂ — attribution "contains modified Copernicus Sentinel data"). Nothing
  NC/SA. The LANCE near-real-time fire product carries NASA's NRT disclaimer.
- Not chosen from GIBS (checked in the capabilities): chlorophyll (only daily L2 swaths with cloud gaps — PACE
  OCI, MODIS, VIIRS), sea-surface height anomaly (newest 2019), OSCAR currents (2024), AMSR2 sea ice (ends
  Sep 2025), daily MAIAC aerosol and AIRS L2 CO (swath gaps), sea-surface salinity (large gaps).

## Small bodies of the solar system (sky)

Layer folder `app/src/layers/small-bodies/`; all four layers are in the **Sky** section (orders 56–59), default off.

| Layer | What | Source + citation | Licence | URL | Baked or live (script / endpoint, cadence) | Attribution |
| --- | --- | --- | --- | --- | --- | --- |
| Dwarf planets and asteroids (`dwarf-planets-asteroids`) | Osculating elements (q, e, i, Ω, ω, Tp; heliocentric, ecliptic J2000) at epoch JD 2461406.5 TDB (1 Jan 2027) of 66 bodies: the 5 IAU dwarf planets, Gonggong, Quaoar, Sedna, Orcus, the 50 main-belt asteroids of lowest H, and Eros, Apophis, Bennu, Ryugu, Didymos, Hektor, Chiron | NASA/JPL Horizons On-Line Ephemeris System (Giorgini et al.), Solar System Dynamics group, JPL | public domain (U.S. Government work; JPL asks for credit) | https://ssd.jpl.nasa.gov/horizons/ (API https://ssd.jpl.nasa.gov/api/horizons.api) | Baked: `tools/pipeline/generate_small_bodies.py` → `app/public/sky/small-bodies.json` (21 KB). Re-bake before 2028 with a new epoch. | NASA/JPL Horizons |
| same | Names, classes, absolute magnitude H and slope G, diameters; the selection of the 50 brightest (lowest H) main-belt asteroids | NASA/JPL Small-Body Database (SBDB Query API) | public domain (as above) | https://ssd.jpl.nasa.gov/tools/sbdb_query.html (API https://ssd-api.jpl.nasa.gov/sbdb_query.api) | Baked, same script and file | NASA/JPL Small-Body Database |
| Comets (predicted brightness) (`comets`) | Elements at the same epoch of 36 comets whose JPL magnitude law (M1 + 5 log Δ + K1 log r) puts them at magnitude ≤ 15, ≥ 20° from the Sun, at some time in 2026–2027 | Elements: JPL Horizons. Candidate list, M1, K1, last-observed dates: JPL SBDB | public domain (as above) | as above | Baked, same script and file | NASA/JPL Horizons; NASA/JPL Small-Body Database |
| Asteroid belt, Trojans, Kuiper belt (`asteroid-belt-cloud`) | Elements (a, e, i, Ω, ω, M carried to the epoch) and H of 35,846 minor planets, the lowest-H members of: near-Earth 800, Mars-crossers 700, main belt 24,946, Hildas 1,500, Jupiter Trojans 5,000, centaurs 400, trans-Neptunian 2,500 | NASA/JPL Small-Body Database (SBDB Query API) | public domain (as above) | https://ssd-api.jpl.nasa.gov/sbdb_query.api | Baked: same script → `app/public/sky/small-bodies-cloud.bin` (455 KB, 13 bytes a body) + `small-bodies-cloud.json` (1 KB) | NASA/JPL Small-Body Database |
| Asteroids passing the Earth (`neo-approaches`) | 307 close approaches within 10 lunar distances, 10 Sep 2026 – 9 Nov 2027, as known on 9 Nov 2026: time, nominal and 3σ distance, speed, H, time uncertainty, measured diameter where there is one | NASA/JPL Center for Near-Earth Object Studies (CNEOS), Close-Approach Data API | public domain (as above) | https://cneos.jpl.nasa.gov/ca/ (API https://ssd-api.jpl.nasa.gov/cad.api) | Baked: `tools/pipeline/generate_neo_approaches.py` → `app/public/sky/neo-approaches.json` (410 KB). Not live: the API sends no `access-control-allow-origin` (checked with curl, `Origin: https://example.org`). Re-bake (`--bake YYYY-MM-DD`) as often as wanted; the chip turns "stale" 3 days after the bake date. | NASA/JPL CNEOS |
| same | Geocentric positions (ICRF, km) of 271 of those objects round closest approach: ±2 d at 3 h steps (1 h inside 2 LD; ±1 d at 10 min inside 0.3 LD; ±0.5 d at 2 min inside 0.1 LD) | NASA/JPL Horizons | public domain (as above) | https://ssd.jpl.nasa.gov/api/horizons.api | Baked, same script and file | NASA/JPL Horizons |

Earth and Sun positions used to turn heliocentric places into directions are the app's own VSOP87 (packages/core, already credited under *Planets*).

### How the places are computed, and how good they are

- Named bodies and comets: two-body (Kepler) motion from the baked osculating elements, ellipse / parabola / hyperbola, with light-time; geocentric astrometric direction. `app/src/layers/small-bodies/kepler.ts`.
- Why Horizons elements rather than SBDB's: SBDB holds each orbit at the epoch it was last fitted for (Pluto 2016, Encke Oct 2024 …); two-body motion from there is degrees out for comets. Horizons gives JPL's own perturbed orbit osculated at one chosen epoch in the middle of the period of use.
- **Validity: 1 Jan 2026 – 1 Jan 2028** (a year either side of the epoch). Outside it the three orbit layers draw nothing and their chips read "hidden · orbits good 1 Jan 2026 – 1 Jan 2028 only" (tone error). Nothing is extrapolated. **The data must be re-baked (new `EPOCH_JD`, `VALID_*`) before 2028.**
- Measured against JPL Horizons geocentric astrometric RA/Dec on 8 dates (epoch −365, −240, −120, −53, 0, +120, +240, +365 d), every baked body, in the generator (which refuses any body over 0.25°) and again in `test_small_bodies.py` / `kepler.test.ts`:
  - worst of all 102 bodies: C/2024 E1 (Wierzchos) 386″ (6.4′); worst asteroid: Sylvia 377″; median of the worst cases 29″, 90th percentile 196″
  - Ceres 98.5″, Vesta 40″, Pluto 1.3″, Eris 1.4″, Hektor (Trojan) 13.4″, Eros 103″, Chiron 7.3″, 2P/Encke 12.4″, 10P/Tempel 2 13.9″
  - at the epoch itself: ≤ 0.08″ in the pipeline (Horizons' Earth), < 6″ in the app test (VSOP87 Earth)
- Magnitudes: asteroids by the IAU H,G law (Bowell et al. 1989) with JPL's H and G; G is absent in SBDB for most TNOs and 0.15 is assumed (flag `gAssumed` in the file). Not compared with Horizons' magnitudes numerically; sanity-pinned in `bodies.test.ts` (Pluto 14–15.6, Eris 18–19.2, Vesta, Ceres).
- Comet magnitudes are **predictions** from JPL's M1/K1, shown with "~" and described as such in the caption; real comets differ by a magnitude or two and no observed-brightness source (COBS etc.) is used. The comet "tail" line only shows the anti-solar direction; its length is schematic, and the caption says so.
- Cloud: same two-body motion in the vertex shader, single precision, no light-time (arcminute-level; no point is named). Elements quantised to 16 bits (log a to 1.3e-4, angles to 0.0055°). Brightness within a class follows H and distance; Hildas, Trojans, centaurs and TNOs are lifted by 2.5 / 4.5 / 6 / 9 mag so they show beside the main belt - a drawing choice, stated in the caption. Tests: the 3:1 Kirkwood gap at 2.50 au is empty; the Trojans fall in two camps 25–110° ahead of and behind Jupiter (VSOP87) at three dates, < 2 % elsewhere; shader arithmetic matches the double-precision propagator to 2e-4 of the orbit size.
- NEO approaches: positions are cubic interpolation of the Horizons tables, then made topocentric for the user's place (core `observerIcrsM`). Checks: every table interpolated at CNEOS's time of closest approach gives CNEOS's miss distance (worst 0.08 %); interpolation between samples vs Horizons midpoints < 0.05° for the five fixture objects including 2026 TP128 (0.0195 LD = 7,490 km from the Earth's centre on 15 Oct 2026); topocentric direction from Austin vs Horizons' own topocentric astrometric place 0.004°–0.007°. Light-time (a few seconds to a minute) is ignored.

### Caveats and things not done

- Comet limit is magnitude 15, not the ~12 first asked for: at 12–13 JPL's magnitude law leaves the layer empty most of the time (0 comets on the bake date, 2 at magnitude 15). Decide whether that is wanted.
- Comet candidates are restricted to orbits observed since 2020 (numbered periodic comets) or 2024 (everything else), and D/ and X/ comets are excluded, so that a fragment or a SOHO-only object with a stale orbit is not "predicted" bright.
- 36 of the 307 approaches (time uncertain by > 1 h, typically old poorly-observed objects predicted to return) are listed for the "next approach" chip but have no sky position.
- The approach list is a snapshot: objects discovered after 9 Nov 2026 are missing, and most small close approachers are found only days ahead. Caption and chip say so.
- Horizons quirks worked around in the scripts: CSV vector tables come back without numbers (labelled format parsed instead); a one-entry TLIST fails for bodies with their own SPK (Pluto, Bennu); Pluto's heliocentric elements are those of the Pluto-system barycentre (2,000 km from Pluto, 0.1″).
- No licence concerns: everything is JPL (U.S. Government work, credit requested).

## Transient and multi-messenger sky, interstellar directions

Layers in `app/src/layers/transients/` (section Deep sky, orders 70–75, all off by default). Everything is baked by
`tools/pipeline/generate_transients.py` into `app/public/sky/transients/` (270 KB in all) and checked by
`tools/pipeline/test_transients.py`. Every row carries its time; the app clock hides events that had not happened yet.

| Layer | What | Source + citation | Licence | URL | Baked or live (script / endpoint, cadence) | Attribution |
| --- | --- | --- | --- | --- | --- | --- |
| Gamma-ray bursts (`gamma-ray-bursts`) | 4,417 Fermi GBM bursts: trigger time, position, T90, 10–1000 keV fluence | Fermi GBM Burst Catalog (FERMIGBRST), NASA HEASARC; von Kienlin et al. 2020, ApJ 893, 46 | public domain (U.S. Government work) | https://heasarc.gsfc.nasa.gov/W3Browse/fermi/fermigbrst.html | baked (`generate_transients.py grb`; HEASARC TAP; catalogue grows weekly, snapshot of 9 Nov 2026, last burst 8 Nov 2026) | Fermi GBM Burst Catalog, NASA HEASARC |
| Gamma-ray bursts (`gamma-ray-bursts`) | 1,760 Swift bursts: names, XRT/BAT positions, T90, 15–150 keV fluence, redshift; 572 are the same events as Fermi's and are merged | Swift GRB Table, NASA GSFC | public domain (U.S. Government work) | https://swift.gsfc.nasa.gov/archive/grb_table/ | baked (same script; HTML table) | Swift GRB Table, NASA GSFC |
| Fast radio bursts (`fast-radio-bursts`) | 492 sources (474 one-off, 18 repeaters): position, first time, dispersion measure | CHIME/FRB Collaboration (2021), ApJS 257, 59, via VizieR J/ApJS/257/59 table2 | published catalogue, free use with citation | https://www.chime-frb.ca/catalog | baked (`… frb`; VizieR CfA mirror); static (2018-07-25 to 2019-07-01) | CHIME/FRB Collaboration 2021 |
| Fast radio bursts (`fast-radio-bursts`) | FRB 20200428 at the magnetar SGR 1935+2154 | CHIME/FRB Collaboration (2020), Nature 587, 54 (arXiv:2005.10324); position SIMBAD `PSR J1935+2154` | free use with acknowledgement | https://arxiv.org/abs/2005.10324 | baked | CHIME/FRB Collaboration 2020; SIMBAD, CDS |
| Bright supernovae since 1895 (`supernovae`) | 204 supernovae to 2015: those with catalogued magnitude ≤ 14, plus SN 2011fe by name | Asiago Supernova Catalogue, Barbon et al. (1999), A&AS 139, 531, as served by HEASARC (ASIAGOSN) | published catalogue, free use with citation | https://heasarc.gsfc.nasa.gov/W3Browse/all/asiagosn.html | baked (`… supernovae`); static | Asiago Supernova Catalogue (Barbon et al. 1999) |
| Bright supernovae since 1895 (`supernovae`) | 44 supernovae of 2016–2020 with peak ≤ 14 | ASAS-SN bright supernova catalogues: Holoien et al. 2017 (MNRAS 471, 4966), 2019 (MNRAS 484, 1899); Neumann et al. 2023 (MNRAS 520, 4356), via VizieR | published catalogue, free use with citation | https://vizier.cfa.harvard.edu/viz-bin/VizieR?-source=J/MNRAS/520/4356 | baked; static | ASAS-SN (Holoien et al.; Neumann et al.) |
| Bright supernovae since 1895 (`supernovae`) | position of SN 2023ixf | SIMBAD, CDS (Wenger et al. 2000) | free use with acknowledgement | https://simbad.cds.unistra.fr/simbad/ | baked | SIMBAD, CDS Strasbourg |
| High-energy neutrinos (`neutrino-alerts`) | 340 alert-track neutrinos 2011–2023: direction, 90% rectangle, energy, gold/bronze (8 flagged CR_VETO left out) | IceCube Collaboration (2023), IceCat-1, Harvard Dataverse V4, doi:10.7910/DVN/SCRUCD; Abbasi et al. 2023, ApJS 269, 25 | CC0 1.0 | https://doi.org/10.7910/DVN/SCRUCD | baked (`… neutrinos`); static until IceCat-2 | IceCube Collaboration, IceCat-1 |
| Gravitational-wave events (`gw-events`) | 391 confident detections (GWTC-1, -2.1, -3, -4.x, -5.0): names, GPS times, masses, distances | LIGO Scientific, Virgo and KAGRA Collaborations, Gravitational Wave Open Science Center | CC BY 4.0 | https://gwosc.org/eventapi/ | baked (`… gw`; needs astropy + astropy-healpix in `.cache/venv-transients`); re-bake on a new catalogue release | LIGO-Virgo-KAGRA / GWOSC |
| Gravitational-wave events (`gw-events`) | sky maps of 325 of them: 90% area, most probable direction, and for the 37 within 150 deg² the pixels of the 90% region | GraceDB public superevents (O3, O4: PublicationSamples > Bilby > LALInference > BAYESTAR > cWB, newest version) and the GWTC-1 sky-map release LIGO-P1800381 | public LVK data release; no licence text on the files | https://gracedb.ligo.org/superevents/public/O4/ | baked (314 files from GraceDB, 11 from dcc.ligo.org) | LIGO-Virgo-KAGRA Collaborations |
| Interstellar visitors and wind (`interstellar-directions`) | arrival and departure asymptotes and v∞ of 1I, 2I, 3I from their osculating elements | JPL Small-Body Database | public domain (U.S. Government work) | https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html | baked (`… interstellar`); re-bake if 3I's orbit is refined | NASA/JPL SBDB |
| Interstellar visitors and wind (`interstellar-directions`) | interstellar helium inflow: ecliptic (255.8°, +5.16°), 25.8 km/s, 7,440 K | Bzowski et al. (2015), ApJS 220, 28 (arXiv:1510.04835), read from the abstract by the script | published measurement, cited | https://arxiv.org/abs/1510.04835 | baked | Bzowski et al. 2015 (IBEX) |

### Verified (test_transients.py, 77 checks; numbers from the last run)

- GRB 221009A, 130427A, 080319B, 090423: 0.000–0.001° from SIMBAD's positions; GRB 170817A 0.002° from NGC 4993 and found
  by its time (Fermi trigger 2 s after GW170817's GPS time from GWOSC), not by name. 221009A has the highest fluence.
  Sky distribution: mean direction of 5,605 bursts 0.016 (isotropic); 15% short. No excess toward the Galactic centre
  (109 within 15° against 95 expected).
- FRB 20121102A and 20180916B: 0.000° from SIMBAD (which carries CHIME's positions - weak as an independent check);
  FRB 20200428 at SIMBAD's PSR J1935+2154; nothing south of −15° (CHIME's sky).
- SN 2014J 0.016° from M 82, SN 1993J 0.047° from M 81, SN 1972E 0.031° from NGC 5253, SN 2017cbv 0.045° from NGC 5643,
  SN 2011fe 0.000° from SIMBAD's SN 2011fe, SN 2023ixf 0.073° from M 101.
- IceCube-170922A (found by date): 0.12° from TXS 0506+056; 340 + 8 vetoed = IceCat-1's 348 rows.
- GW170817: dated 2017-08-17 12:41:04 UTC, 16 deg², its 90% region reaches within 0.21° of NGC 4993 (most probable
  pixel 2.3° away); GW190814 19 deg²; first event GW150914. In the app: 3 events at the end of 2016, 9 on 18 Aug 2017.
- 1I, 2I, 3I arrival directions: 0.13°, 0.18°, 0.17° from where JPL Horizons has each body in 1900 as seen from the Sun;
  v∞ 26.41 / 32.28 / 57.98 km/s against Horizons' range rates 26.44 / 32.32 / 57.97 km/s. 1I's radiant is 4.9° from Vega.

### Approximate, unverified, licence-sensitive

- Fermi-only GRB positions are GBM localisations, good to a few degrees (the caption says so). Fluences are 10–1000 keV
  for Fermi bursts and 15–150 keV for Swift-only ones: sizes of the two are not strictly comparable.
- CHIME positions are good to ~0.2°; a repeater sits at the catalogue's position of its first listed burst.
- Supernova magnitudes: the Asiago catalogue gives the magnitude at maximum for older events but only the discovery
  magnitude for many after ~2000 (flag `D`), so the 2000–2015 sample misses events that brightened after discovery
  (SN 2011fe is in by name, without a magnitude). ASAS-SN covers 2016–2020 properly. Nothing keyless was found for
  2021 on (TNS needs an API key, the Open Supernova Catalog stopped in 2022, the ZTF BTS explorer answered HTTP 500
  for most queries): SN 2023ixf is in by name only, dated 1 Jan of its year. SN 1987A and SN 1885A are left out
  because Sky landmarks already shows them.
- Gravitational waves: 66 of 391 catalogue events have no public sky map (found only in offline searches, no GraceDB
  superevent) and 288 more are localised worse than 150 deg²: those are not drawn at all. Maps for most O4 events are
  the rapid BAYESTAR localisation, not final parameter estimation. 81 events have no published masses yet
  ("unclassified"). The sky-map files carry no licence statement: GWOSC's catalogue data is CC BY 4.0, GraceDB public
  alert products are simply "public" - needs the owner's decision if a stricter reading is wanted. GW170817 also
  appears (as its host) in Sky landmarks; here it is the localisation patch.
- Interstellar asymptotes are two-body, from osculating elements at the SBDB epoch; planetary perturbations and
  non-gravitational forces move them by the 0.1–0.2° measured above. The "heliosphere nose" is identified with the
  helium inflow direction; no separate heliopause measurement is used.
- CHIME/FRB Catalog 1 and the ASAS-SN/Asiago tables are used as published catalogues via VizieR/HEASARC with
  citation; none states an explicit data licence.
- Not shipped: TeVCat (HEASARC serves a copy, but TeVCat's own terms are unclear - skipped); FRBs after 2019
  (CHIME Catalog 2 not on VizieR/HEASARC when checked); IBEX ribbon centre (no fetched source).
- frameMs at 412×892 dpr 2: 18.7–20.3 ms with all six on against 22.7 ms with defaults only, measured while sibling
  agents were loading the same machine - the layers add 6,700 points and no per-frame work beyond a binary search;
  desktop runs with one or two of them on read 16.5–17.1 ms.
