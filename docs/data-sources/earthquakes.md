# Earthquakes: data sources and verification

Everything the earthquake layers draw, where it comes from, and what was
checked against what. Numbers are as measured on 2026-11-10 (UTC).

## Datasets shipped or fetched

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Earthquakes, M5+ since 1973 (always loaded) + "Great earthquakes, M8+" labels | 89,548 hypocentres with origin time (to the minute), depth and magnitude | USGS ANSS Comprehensive Earthquake Catalog (ComCat), FDSN event web service | Public domain (US Government) | https://earthquake.usgs.gov/data/comcat/ · https://earthquake.usgs.gov/fdsnws/event/1/ | Baked: `tools/pipeline/generate_seismicity.py --only quakes` → `app/public/geo/quakes.json` (1.89 MB, 689 KB gzipped) | USGS ANSS Comprehensive Earthquake Catalog (ComCat) |
| same | 333 of those events (0.4 %), which ComCat carries from ISC-GEM (networks `iscgem`, `iscgemsup`) — among them the M8.3 Sumba earthquake of 1977 | International Seismological Centre (2026), ISC-GEM Earthquake Catalogue, https://doi.org/10.31905/d808b825 | **CC BY-SA 3.0** | https://www.isc.ac.uk/iscgem/ | Baked, in the same file (`iscGem` holds the count) | ISC-GEM Global Instrumental Earthquake Catalogue, International Seismological Centre |
| Recent earthquakes (live) | M4.5+ of the past 30 days and M2.5+ of the past 7 days | USGS Earthquake Hazards Program, real-time GeoJSON summary feeds of ComCat | Public domain (US Government) | https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php (`summary/4.5_month.geojson`, `summary/2.5_week.geojson`) | Live: fetched in the browser on switch-on and every 5 minutes while shown (USGS rebuilds the feeds every minute and sends `cache-control: max-age=60`); last answer kept in `localStorage` | USGS Earthquake Hazards Program, real-time feeds |
| same, offline fallback | The same two feeds as they stood at bake time (896 earthquakes, 2026-11-10 00:44 UTC) | as above | Public domain | as above | Baked: `tools/pipeline/generate_quake_sets.py --only recent` → `app/public/geo/quakes-recent-snapshot.json` (202 KB) | as above |
| Notable earthquakes since 1900 | 19 events: every M8.5+ since 1900 (17), plus San Francisco 1906 and Türkiye 2023 (the presets of `spec/seismic.md` below M8.5) | USGS ComCat, by event id; magnitudes are USGS "official" values | Public domain (US Government) | https://earthquake.usgs.gov/fdsnws/event/1/ | Baked: `tools/pipeline/generate_quake_sets.py --only notable` → `app/public/geo/quakes-notable.json` (5 KB) | USGS ANSS Comprehensive Earthquake Catalog (ComCat) |
| same | Locations of the 11 pre-1973 events whose `locationSource` is `iscgem` | ISC-GEM, as above | **CC BY-SA 3.0** | https://www.isc.ac.uk/iscgem/ | Baked, same file | as above |

CORS, checked with `curl -sI -H "Origin: https://example.org"`: both the feeds
and the FDSN service answer `access-control-allow-origin: *`, and the fetch
works in headless Chromium.

Privacy: the live layer makes two anonymous GETs of global feeds; nothing
about the user or their location is sent.

## Used for verification only (not shipped)

| What | Source | Terms |
| --- | --- | --- |
| Independent hypocentres for 12 named earthquakes and 498 M5–6 events | ISC Bulletin, International Seismological Centre, fdsnws event service, https://www.isc.ac.uk/fdsnws/event/1/ | Free access; the ISC asks to be cited. Event ids are in `tools/pipeline/test_seismicity.py`. (The Bulletin's DOI was not confirmed from the ISC site, so none is given here.) |
| Independent entries for the 12 pre-1973 notable events | NOAA NCEI/WDS Global Significant Earthquake Database, doi:10.7289/V5TD9V7K, https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/earthquakes | Public domain (US Government) |
| ak135 travel times (spot checks of the unwired travel-time pipeline) | ObsPy TauP 1.5.1, in `tools/pipeline/.cache/venv` | LGPL-3.0; not distributed |

## Licence-sensitive: needs Andy's decision

ISC-GEM is CC BY-SA 3.0. It reaches the app two ways:

1. **333 of the 89,548 catalogue events** are ISC-GEM records inside ComCat
   (343 before duplicates of NEIC records were dropped).
   They are kept, because dropping them leaves real holes (the M8.3 Sumba
   earthquake of 1977 has no other record in ComCat), credited, and
   `quakes.json` is declared shared under CC BY-SA 3.0 in
   `app/public/geo/ATTRIBUTION.md`. To ship a purely public-domain file
   instead, set `EXCLUDED_NETWORKS = {"iscgem", "iscgemsup"}` in
   `generate_seismicity.py` and re-bake: 333 fewer events, 39 M8+ labels
   instead of 40.
2. **The pre-1973 locations of the notable set** (11 of 19 events) are
   ISC-GEM's, because ComCat has no other location for them. NOAA NCEI's
   database is public domain but carries the same ISC-GEM coordinates for 8
   of the 12 pre-1973 events, so it is not a clean alternative.

The repository already ships one share-alike dataset the same way (GEM
active faults, CC BY-SA 4.0), which is why these were kept rather than
dropped. The in-app credit for ISC-GEM sits on the "Notable earthquakes"
layer; the built-in credit "Earthquake hypocentres … public domain" in
`app/src/ui/credits.ts` (a shared file, left untouched) should gain an
ISC-GEM line if the records stay.

## What the catalogue file contains, and does not

- **Type:** only ComCat event type `earthquake`. Left out at M5+ since 1973:
  425 nuclear explosions, 55 "volcanic eruption" events (Kīlauea 2018
  collapses, Hunga Tonga 2022), 10 other explosions, 2 landslides, 1 rock
  burst, 1 mine collapse. Counts are in the file (`excluded`).
- **Duplicates:** ComCat lists 38 earthquakes twice under two networks it did
  not associate, and one origin under two ids (`ak0212o88mof` /
  `ak0212o88mqd`). Dropped: 18 Global CMT centroids and 10 ISC-GEM records
  that double a NEIC hypocentre, and 10 NEIC records that double a regional
  network's (mostly Alaska). A record is dropped when
  another network's record lies within 16 s, 200 km and 0.3 magnitude units
  — a heuristic, tuned on the list of candidate pairs, that keeps real
  doublets located by a single network. A handful of probable duplicates
  with larger magnitude differences (e.g. `usp000d3mb` M7.4 / `iscgem7398408`
  M6.5, 14 s and 3 km apart) are kept, because they cannot be told from
  sub-events.
- **Count:** ComCat's own count for the same query is 90,081 events of every
  type, 89,587 of them earthquakes; the eleven 5-year request pages sum to
  exactly 90,081, so nothing is lost at page boundaries or to the 20,000
  event cap (largest page 10,833). 89,587 − 38 − 1 = 89,548.
- **Magnitude:** ComCat's preferred magnitude, whatever its type: mb for
  47 % of events (saturates near M6.5), Mwc/Mww/Mw/Mwb for 49 %, Ms 3.6 %,
  others under 1 %. "M5+" is therefore a threshold on mixed scales, exactly
  as in a ComCat search. Stored to 0.1, halves rounded up.
- **Depth:** whole kilometres. 44 % of events sit at exactly 10, 33 or 35 km:
  default depths assigned when the depth could not be resolved, not
  measurements. They show as thin shells in the view. 27 events located
  above sea level (Mount St Helens 1980, Hawaii) are put at 0.
- **Quantisation:** 0.01° and 1 km: at most 0.93 km in 3-D (mean 0.44 km),
  measured over every event.
- **Stability:** ComCat revises events for weeks. Between the previous bake
  and this one, 14 events of late October 2026 moved and 2 appeared;
  nothing older changed.

## Verification summary

| Check | Result |
| --- | --- |
| Baked file vs ComCat, all 89,587 earthquakes | Exact to quantisation (≤ 0.93 km, depth ≤ 0.5 km, magnitude exact) |
| 12 named events vs ComCat (by event id) | ≤ 0.62 km |
| 12 named events vs ISC Bulletin | 4.1 – 23.9 km (depth differences up to 21.5 km for the deep Fiji and Bonin events) |
| 514 ordinary M5–6 events in ten random 12-day windows vs ISC | 498 matched: median 13.7 km in 3-D, 90 % within 29.6 km, worst 126 km; origin times within 9.6 s |
| Sphere vs WGS84 | Absolute position off by 7.1 km (equator) to 21.7 km (45°), identical for coastlines and hypocentres and at every depth; depth runs exactly along the ellipsoid normal; viewing direction from Austin wrong by ≤ 0.19° |
| Pixels | Aiming the camera at six catalogue hypocentres puts the dot within 0.1 px of the screen centre and its label on it |
| Hypocentres vs Slab2 contours (as drawn) | Median distance 21 – 39 km at 70–300 km depth, 35 – 53 km at 300–700 km (Slab2 is the slab's top surface; earthquakes occur inside the slab) |
| Live layer vs USGS event pages | Five current events: ring on the screen centre, label 15 px below as styled |
| 12 pre-1973 notable events vs NOAA NCEI | ≤ 27.3 km, magnitudes within 0.1 |

## Not verified, approximate, or out of scope

- The travel-time pipeline (`generate_traveltime.py`) passes its own spot
  checks against ObsPy TauP at low resolution (256 × 32), but that compares
  the texture with the library that made it; no independent table was
  consulted. Its texture holds direct P and S only, so nothing arrives
  beyond about 98°: the spec's "P reaches the antipode in ~20 min" (PKIKP,
  1212 s in ak135) cannot be shown from it. `wavefronts.ts` still uses
  constant velocities, not the texture. Wave playback was out of scope.
- The baked snapshot is only as fresh as the last bake.
- The M2.5+ feed is dominated by US regional networks (Alaska, Puerto Rico,
  California, Hawaii); small events elsewhere are simply not located. The
  layer's caption says so.
