# The human world: data sources and verification

What the "Human world" layers (and "Rivers and lakes" under "Surface lines")
draw, where it comes from, and what was checked against what. Numbers are as
measured on 2026-11-10 (UTC). All fifteen layers are lazy, off by default, and
baked: nothing here is fetched at run time, so there is no CORS or privacy
question.

## Needs Andy's decision

1. **Undersea cables: CC BY-NC-SA 3.0, and frozen at November 2022.**
   TeleGeography's Submarine Cable Map is the only complete source of cable
   routes. Its data were published on GitHub under CC BY-NC-SA 3.0
   (non-commercial, share-alike) until TeleGeography deleted the repository;
   its FAQ now says "the raw, geocoded data underlying TeleGeography's
   interactive maps is available via an annual license" and "we no longer
   maintain or update a GitHub repository" (read 2026-11-10; the FAQ puts
   only the *maps and screen captures* under CC BY-SA 4.0). The JSON the
   live site serves today is therefore not openly licensed, and is **not
   used**. What is baked is the last commit of the repository that a public
   fork still holds (`91265d812a`, 14 November 2022), whose `README.md` and
   `LICENSE` state CC BY-NC-SA 3.0. Consequences: the layer is
   non-commercial and share-alike (`app/public/geo/cables.json` is kept
   apart from everything else for that reason); it lacks cables laid since
   2022 and shows 66 cables as "planned" that were planned then (2Africa
   among them, now lit); and it cannot be refreshed. The layer's label
   ("Undersea cables (2022)"), chip ("as of 14 Nov 2022", stale tone) and
   caption say so. If non-commercial data are unacceptable, delete
   `cables.json` and the `undersea-cables` definition; the freer
   alternative, OpenStreetMap (ODbL), was measured and is not good enough
   (below).
2. **Air routes: ODbL 1.0 (share-alike database licence), and of June 2014.**
   OpenFlights' `routes.dat` is the only open route database found; it has
   not been maintained since June 2014. Kept in its own file
   (`air-routes.json`); label "Air routes (2014)", chip "routes of June
   2014" (stale tone).
3. **Wikipedia text facts.** The depths of the Mponeng and TauTona mines
   ("over 4 km", "about 3.9 km") are read from the lead of their English
   Wikipedia articles (CC BY-SA 4.0), because Wikidata has no depth for
   either. Two numbers, credited; the wording is kept as the article has it.

## Datasets shipped

| Layer (`id`) | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Undersea cables (2022) (`undersea-cables`) | 527 cables (461 in service, 1.38 million km; 66 planned) as 1,461 polylines; per cable name, length, ready-for-service year, planned or not; 1,257 landing points with the number of in-service cables at each | TeleGeography, Submarine Cable Map, GitHub repository `telegeography/www.submarinecablemap.com` at commit `91265d812a3e5f3734d48f6069ad600f3b0bdd66` (14 Nov 2022), read from the fork `jordi-farrpoint/www.submarinecablemap.com` | **CC BY-NC-SA 3.0** | https://www.submarinecablemap.com/ | Baked: `generate_cables.py` → `app/public/geo/cables.json` (230 kB). Frozen: see above. | TeleGeography, Submarine Cable Map (CC BY-NC-SA 3.0), data of November 2022 |
| Shipping lanes (`ship-density`) | Density of ship AIS position reports, Jan 2015 – Feb 2021, 85°S–85°N, summed from the 0.005° grid into 0.176° cells, log-coded over five decades | Cerdeiro, D.A., Komaromi, A., Liu, Y. & Saeed, M. (2020), World Seaborne Trade in Real Time: A Proof of Concept for Building AIS-based Nowcasts from Scratch, IMF Working Paper 20/57; "Global Shipping Traffic Density", World Bank Data Catalog, dataset 0037580 (`shipdensity_global.zip`) | CC BY 4.0 ("License: Creative Commons Attribution 4.0" on the catalogue page) | https://datacatalog.worldbank.org/search/dataset/0037580 | Baked: `generate_ship_density.py` → `app/public/geo/ship-density.jpg` (365 kB, 2048×1024 grey JPEG) | Cerdeiro et al. (2020), IMF / World Bank, Global Shipping Traffic Density (CC BY 4.0) |
| Sea ports (`ports`) | 1,081 ports with a scale rank | Natural Earth, `ne_10m_ports` | Public domain | https://www.naturalearthdata.com/ | Baked: `generate_waters.py` → `app/public/geo/ports.json` (60 kB) | Natural Earth |
| Rivers and lakes (`rivers-lakes`) | River centre lines of scale rank ≤ 7 (1,536 polylines, 630 names), shorelines of the 260 lakes over 300 km² | Natural Earth, `ne_10m_rivers_lake_centerlines`, `ne_50m_lakes` | Public domain | https://www.naturalearthdata.com/ | Baked: `generate_waters.py` → `app/public/geo/waters.json` (308 kB) | Natural Earth |
| Airports (`airports`) | 1,151 airports classed `large_airport` with scheduled service and an IATA code; rank for labels from Natural Earth's `ne_10m_airports` | OurAirports, `airports.csv`; Natural Earth | Public domain (both) | https://ourairports.com/data/ | Baked: `generate_air.py` → `app/public/geo/airports.json` (81 kB) | OurAirports; Natural Earth |
| Air routes (2014) (`air-routes`) | 2,608 airport pairs: flown non-stop by ≥ 3 airlines, or longer than 8,000 km; number of airlines per pair | OpenFlights route database, `routes.dat` (last updated June 2014); airport positions from OurAirports | **ODbL 1.0** | https://openflights.org/data.php | Baked: `generate_air.py` → `app/public/geo/air-routes.json` (47 kB) | OpenFlights (ODbL 1.0), routes of June 2014 |
| Power plants, 500 MW and more (`power-plants`); Nuclear power plants (`nuclear-plants`) | 3,235 plants ≥ 500 MW (position, capacity, primary fuel; names of the 250 largest); all 195 nuclear plants | Global Energy Observatory, Google, KTH Royal Institute of Technology in Stockholm, Enipedia, World Resources Institute (2021), Global Power Plant Database v1.3.0, Resource Watch and Google Earth Engine | CC BY 4.0 | https://datasets.wri.org/dataset/globalpowerplantdatabase | Baked: `generate_power_plants.py` → `app/public/geo/power-plants.json` (89 kB). The database's last release is June 2021. | Global Power Plant Database v1.3.0, WRI et al. (CC BY 4.0) |
| Highest mountains (`high-mountains`), Deepest holes (`deep-places`), Space launch sites (`launch-sites`), Telescopes and detectors (`observatories`), Particle accelerators (`particle-accelerators`), World Heritage Sites (`world-heritage`), Shipwrecks (`shipwrecks`) | 92 mountains, 16 deep places, 91 launch sites, 130 instruments, 20 accelerators, 1,400 heritage sites, 300 wrecks: name, position, elevation or depth where the set has one, number of Wikipedia language editions | Wikidata, by SPARQL (the queries are in `generate_landmarks.py`), asked 2026-11-10 | CC0 1.0 | https://www.wikidata.org/ | Baked: `generate_landmarks.py` → `app/public/geo/landmarks.json` (154 kB) | Wikidata (CC0) |
| Deepest holes (`deep-places`), two values | Depth of Mponeng ("over 4 km") and TauTona ("about 3.9 km") | English Wikipedia, "Mponeng Gold Mine" and "TauTona Mine", lead paragraphs (REST summary API) | CC BY-SA 4.0 | https://en.wikipedia.org/wiki/Mponeng_Gold_Mine | Baked, as above | Wikipedia (CC BY-SA 4.0) |

Total shipped: 1.34 MB in eight files (0.5 MB gzipped for the seven JSON
files; the JPEG does not compress further). `app/public/geo/ATTRIBUTION-human-world.md`
repeats the licences next to the files.

Every credit above is in the layer's `credits` and so in the app's "Data
credits" list.

## What was verified, against what

Run by the pipeline's tests (`tools/pipeline/test_cables.py`,
`test_landmarks.py`, `test_power_plants.py`, `test_ship_density.py`,
`test_waters.py`, `test_air.py`), which fetch the second sources themselves.

- **Cables.** MAREA: 6,605 km, 2018, ends within 60 km of Virginia Beach and
  Bilbao, drawn route 6,453 km against the stated 6,605. Landing points
  against Natural Earth's cities (a different source): Singapore 6 km,
  Mumbai 6 km, Lagos 4 km, Lisbon 9 km, Sydney 2 km. In screenshots the
  cables converge on Marseille, Singapore, Fortaleza, Jeddah and Mumbai and
  follow the coasts they should.
- **Mountains.** Against Natural Earth's elevation points: 63 summits are in
  both; all agree in height to 60 m (worst: Mount Cameroon, 4,095 m here,
  4,040 m there). Exactly fourteen eight-thousanders. Everest 8,849 m (the
  2020 survey's 8,848.86), K2 8,611 m.
- **Deep places.** Kola Superdeep Borehole 12,262 m, within 0.1 km of the
  position in its Wikipedia article.
- **Observatories.** Against the Minor Planet Center's observatory codes:
  Palomar (675), La Silla (809) and Siding Spring (413) agree to 0.005° in
  longitude and to the 0.2° that separates geocentric from geodetic
  latitude. LIGO is drawn at both Hanford and Livingston; IceCube at the Pole.
- **World Heritage.** Against UNESCO's own list (`whc.unesco.org/en/list/xml/`,
  1,270 sites with positions): Taj Mahal, Stonehenge, Sydney Opera House,
  Petra and the Statue of Liberty within 0.5 km; 1,183 of UNESCO's 1,270
  sites (93 %) have one of the layer's points within 30 km.
- **Launch sites, wrecks.** Baikonur and the Titanic within 1 km of the
  positions in their Wikipedia articles.
- **Power plants.** Three Gorges Dam 22,500 MW at 111.0°E 30.8°N;
  Kashiwazaki-Kariwa 8,212 MW. Against Wikidata's nuclear power plants
  (385 with positions): 194 of the database's 195 have one within 10 km.
- **Ship density.** Codes (0–255) in the Singapore Strait 207, Gibraltar
  244, Gulf of Suez 207, Dover Strait 251, approach to Panama 211, Hormuz
  226; Sahara, Tibet, central Australia and the Antarctic plateau 0; the
  great-circle track past the Aleutians 193 against 0 in the empty South
  Pacific. That fixes the orientation (north up, Greenwich central) as well
  as the content.
- **Rivers and lakes.** A river within 0.11° of Cairo, Khartoum, Shanghai,
  Baghdad, Paris and Kinshasa (Natural Earth's cities, another layer).
  Lake areas computed from the shorelines against published ones: Superior
  84,835 km² (82,100), Victoria 69,391 (68,900), Baikal 32,072 (31,700),
  Tanganyika 32,761 (32,900).
- **Airports.** Against Natural Earth's airports: of 629 IATA codes in
  both, 614 (97.6 %) lie within 5 km (worst: YNT, 45 km — Yantai moved to a
  new airport; OurAirports has the new one).
- **Air routes.** London–New York flown by 8 airlines in the 2014 data; no
  route longer than 16,500 km.

## Notes, limits and what is approximate

- **Cable routes are a drawing.** TeleGeography draws the routes in
  Illustrator (its own README says so); landing points are right to the
  town, the path between is stylised. Simplified here to 0.03° (3 km).
  Lengths are the operators' stated figures; 33 cables without one get the
  length of the drawn route, marked "~".
- **OpenStreetMap as a cable source was measured and rejected.** Overpass,
  2026-11-10: all ways tagged `communication=line` (with or without
  `submarine=yes` / `location=underwater` / `seamark:type=cable_submarine`)
  under water add up to about 240,000 km — a sixth of the 1.4 million km in
  service — almost all in European waters and the North Atlantic, with no
  MAREA, no 2Africa and no trans-Pacific system. It would be the fallback
  if the NC licence is refused, and it would look empty.
- **Ship density units.** The catalogue calls the values "the total number
  of AIS positions … reported by ships in each grid cell". Their sum, 6.6 ×
  10¹⁴, is more than hourly reports from the world's fleet could add up to,
  so the count is evidently weighted or interpolated in a way the summary
  does not explain. The layer shows a relative, logarithmic scale and makes
  no claim about ships per day. JPEG at quality 82 moves codes by a few of
  255 (a twentieth of a decade).
- **Wikidata sets are whatever Wikidata classes that way.** Membership is by
  class or property, not curated: the launch sites include a few that are
  not launch sites in any strict sense (Gorodomlya Island, a design
  bureau's island; Ernst Krenkel Observatory); telescopes that Wikidata
  classes as neither telescope nor observatory are missing (ALMA is not in
  the set); mountains without a stated prominence in Wikidata are missing
  from the "3,000 m prominence" part (Klyuchevskaya Sopka is not there).
  Ranking is by number of Wikipedia language editions, a measure of fame,
  not of importance. The captions say "as Wikidata lists them".
- **Wreck depths are not drawn.** Wikidata states a depth for 3 of the 300
  wrecks; all are drawn at the surface. The brief's "true depth where
  known" could not be met from an open source.
- **Mine depths.** Only Mponeng and TauTona (from Wikipedia) and four mines
  with a Wikidata depth are in the deep set; there is no open register of
  mine depths.
- **Power plants are as of 2017–2021.** The database is no longer updated.
  It splits Itaipu in two (by country), and so does the layer.
- **Ports.** Natural Earth's port list is old and misses some of the largest
  ports (Busan, Shenzhen, Jebel Ali). The better source, NGA's World Port
  Index (public domain), answered HTTP 503 throughout the session.
- **Air-route arcs are schematic.** Great circles lifted by 4 % of their
  length so they read as arcs; the caption says they are neither flight
  paths nor heights.

## Evaluated and not built

- **Live aircraft.** None of the keyless ADS-B APIs can be called from a
  browser on another origin (checked 2026-11-10 with `curl -H "Origin:
  https://example.org"`): OpenSky Network answers with
  `access-control-allow-origin: https://opensky-network.org` only;
  `api.adsb.lol` and `opendata.adsb.fi` send no CORS header;
  `api.airplanes.live` and `api.adsb.one` answer 403. A live layer would
  need a proxy, which this project does not have. Not built, no fallback
  faked.
- **Oil and gas pipelines.** Global Energy Monitor's trackers are CC BY 4.0
  but their downloads sit behind a form asking for name and e-mail: not
  keyless. Not attempted further.
- **Protected areas (WDPA).** Licence forbids redistribution; skipped as the
  brief said.
- **Time zones, railways, roads, Great Wall geometry.** Not reached.
