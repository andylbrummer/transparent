# Earth extras: data sources and verification

What the "earth-extras" layers draw - mantle tomography and the bodies and
patches of the deep mantle, volcanoes, impact craters, the geophysical
fields, ocean currents, the named seabed, and the depth ladder - where each
comes from, under what terms, and what was checked against what. All of it
is baked; nothing here is fetched at run time, so there is no CORS or
privacy question. All layers are lazy and off by default. Numbers are as
measured on 2026-11-09/10 (UTC).

## Datasets shipped

| Layer | What | Source and citation | Licence, as the source states it | URL fetched | Baked by → file (size) | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Mantle at 150 / 400 / 700 / 1,250 / 2,050 / 2,850 km (`tomography-<depth>`, one at a time) | Shear-velocity anomaly dVs/Vs at six depth layers of the model, coloured slow red … fast blue; coastlines projected down for bearings | SEMUCB-WM1: French, S.W. & Romanowicz, B.A. (2014), Whole-mantle radially anisotropic shear velocity structure from spectral-element waveform tomography, Geophys. J. Int. 199, 1303–1327, doi:10.1093/gji/ggu334. Read as the spherical-harmonic expansion to degree 31 (`tomography/semucb-wm1.31.m.ab`, 41 layers) distributed with hc (Becker, O'Neill & Steinberger), pinned to commit 7bb6d03 | **No licence stated for the model.** The EarthScope EMC record gives only "To cite the original work behind this Earth model: French & Romanowicz (2014)"; the authors' own repository has no licence file. hc's README: "All of the HC code is distributed under the GNU General Public License" (GPL-2.0) - the code, which is neither run nor shipped | https://raw.githubusercontent.com/geodynamics/hc/7bb6d0385d88e25510f5e4646e835d8b018f2073/tomography/semucb-wm1.31.m.ab | `generate_tomography.py` → `geo/tomography/dvs-*.png` (6 × 55–68 kB), `geo/tomography.json` (1 kB) | SEMUCB-WM1, French & Romanowicz (2014), doi:10.1093/gji/ggu334; expansion as distributed with hc |
| Deep mantle in 3-D: slow provinces (`tomography-slow-bodies`) | The −0.8 % surface of the same model from 1,050 km to the core-mantle boundary, as a closed mesh: the African and Pacific large low-shear-velocity provinces (LLSVPs) and the columns on them | as above | as above | as above | `generate_tomography_bodies.py` → `geo/tomography-bodies-slow.bin` (241 kB), `geo/tomography-bodies.json` (1 kB) | as above |
| Ultra-low velocity zones on the core (`ulvz`) | Every location of the compilation's "Raw" database: 4,973 pierce points, 456 paths and 62 outlines on the core-mantle boundary, each as found / not found / uncertain; four mega-ULVZs named | Yu, S. & Garnero, E.J. (2018), Ultralow Velocity Zone Locations: A Global Assessment, Geochem. Geophys. Geosyst. 19, 396–414, doi:10.1002/2017GC007281; data set "ULVZ Distribution Database from 54 studies" v1.0.1, Zenodo, doi:10.5281/zenodo.1064217. Galápagos mega-ULVZ: Cottaar, S., Martin, C., Li, Z. & Parai, R. (2022), The root to the Galápagos mantle plume on the core-mantle boundary, Seismica 1(1), doi:10.26443/seismica.v1i1.197 | **No named licence.** Zenodo: "Rights: License: Other (Open). No further description." No licence file in the archive. Seismica paper: CC BY 4.0 | https://zenodo.org/api/records/1064217/files/ULVZ-Database-1.0.1.zip/content | `generate_ulvz.py` → `geo/ulvz.json` (191 kB) | Yu & Garnero (2018), doi:10.1002/2017GC007281; ULVZ Distribution Database v1.0.1, doi:10.5281/zenodo.1064217 |
| Volcanoes by last eruption (`volcanoes`); Greatest eruptions (`eruptions-great`) | 1,214 Holocene and 1,452 Pleistocene volcanoes with type, height and last eruption year; the 59 confirmed Holocene eruptions of VEI 6 and 7 | Global Volcanism Program (2026), [Database] Volcanoes of the World (v. 5.4.0; 7 Aug 2026), distributed by Smithsonian Institution, compiled by Venzke, E., doi:10.5479/si.GVP.VOTW5-2026.5.4 | **Non-commercial.** Smithsonian terms of use: "The Smithsonian invites visitors to use its online content for personal, educational and other non-commercial purposes"; "You may not use the Content for commercial purposes … you must obtain prior written permission"; "You must cite the author and source of the Content" | https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows (WFS 1.0.0; `Smithsonian_VOTW_Holocene_Volcanoes`, `_Pleistocene_Volcanoes`, `_Holocene_Eruptions`) | `generate_volcanoes.py` → `geo/volcanoes.json` (105 kB) | the citation above, in full, with a link to volcano.si.edu |
| Impact craters (`impact-craters`) | The 187 proven impact structures of 100 m and more: position, diameter, recommended age | Schmieder, M. & Kring, D.A. (2020), Earth's Impact Events Through Geologic Time: A List of Recommended Ages for Terrestrial Impact Structures and Deposits, Astrobiology 20(1), 91–141, doi:10.1089/ast.2019.2085, Table 1 | CC BY 4.0 ("distributed under the terms of the Creative Commons License (http://creativecommons.org/licenses/by/4.0)", in the article) | https://www.ebi.ac.uk/europepmc/webservices/rest/PMC6987741/fullTextXML | `generate_craters.py` → `geo/craters.json` (27 kB) | Schmieder & Kring (2020), Astrobiology 20, 91, doi:10.1089/ast.2019.2085 |
| Magnetic anomaly of the crust (`magnetic-anomaly`) | Crustal magnetic anomaly, ±400 nT on a square-root scale | Meyer, B., Saltus, R. & Chulliat, A. (2017), EMAG2v3: Earth Magnetic Anomaly Grid (2-arc-minute resolution), Version 3, NOAA National Centers for Environmental Information, doi:10.7289/V5H70CVX | Public domain: "Produced by the NOAA National Centers for Environmental Information. Not subject to copyright protection within the United States." | https://gis.ngdc.noaa.gov/arcgis/rest/services/EMAG2v3/ImageServer/exportImage | `generate_earth_fields.py` → `geo/fields/magnetic-anomaly.jpg` (503 kB, 2048 × 1024) | Meyer, Saltus & Chulliat (2017), EMAG2v3, NOAA NCEI, doi:10.7289/V5H70CVX |
| Geoid height (`geoid`) | Height of the geoid above the ellipsoid, −107 … +85 m | EGM96: Lemoine, F.G. et al. (1998), The Development of the Joint NASA GSFC and NIMA Geopotential Model EGM96, NASA/TP-1998-206861; the 15-arc-minute grid as packaged by PROJ | Public domain, per PROJ-data's `us_nga_README.txt` ("Source: NGA … License: Public Domain") - the packager's statement; no NGA page was fetched | https://cdn.proj.org/us_nga_egm96_15.tif | same script → `geo/fields/geoid.png` (72 kB) | EGM96, NASA GSFC / NIMA (Lemoine et al. 1998) |
| Gravity anomaly (`gravity-anomaly`, added 2026-11-11) | Free-air gravity anomaly, −360 … +688 mGal, 0.25° cells | XGM2019: Zingerle, P., Pail, R., Gruber, T. & Oikonomidou, X. (2019), The experimental gravity field model XGM2019e, GFZ Data Services, doi:10.5880/ICGEM.2019.007 (the degree-760 member) | CC BY 4.0, stated in the file's own header and in its DataCite record | https://datapub.gfz-potsdam.de/download/10.5880.ICGEM.2019.007/XGM2019.zip | `generate_earth_fields.py` + `spherical_harmonics.py` → `geo/fields/gravity-anomaly.jpg` (246 kB) | XGM2019, Zingerle et al. 2019, GFZ (CC BY 4.0) |
| Crust: depth of the Moho (`moho-depth`); Sediment thickness (`sediment-thickness`) | Depth of the base of the crust; thickness of the three sediment layers; 1° cells (both from the model's `crust1.bnds`) | CRUST1.0: Laske, G., Masters, G., Ma, Z. & Pasyanos, M. (2013), Update on CRUST1.0 - A 1-degree Global Model of Earth's Crust, Geophys. Res. Abstracts 15, Abstract EGU2013-2658 | **No licence stated.** The model's page says only "Please refer to the REM web site if you use this model … or to Laske, G., Masters, G., Ma, Z. and Pasyanos, M., Update on CRUST1.0 …"; the readme in the archive has no terms | https://igppweb.ucsd.edu/~gabi/crust1/crust1.0.tar.gz | same script → `geo/fields/moho-depth.png` (37 kB), `sediment-thickness.png` (50 kB) | Laske, Masters, Ma & Pasyanos (2013), CRUST1.0, EGU2013-2658 |
| Heat flow, measured (`heat-flow`) | Median of the measurements in each 1° cell: 91,058 measurements in 10,214 cells | Global Heat Flow Data Assessment Group et al. (2024), The Global Heat Flow Database: Release 2024, v. 2026.03, GFZ Data Services, doi:10.5880/fidgeo.2024.014 | CC BY 4.0 (DataCite record of the DOI) | https://datapub.gfz-potsdam.de/download/10.5880.FIDGEO.2024.014-VEueRf/GHFBD-R2024_v.2026-03.zip | same script → `geo/fields/heat-flow.png` (24 kB); all five described in `geo/fields.json` (1 kB) | Global Heat Flow Data Assessment Group (2024), Global Heat Flow Database Release 2024, doi:10.5880/fidgeo.2024.014 |
| Ocean currents (`ocean-currents`) | Mean surface current, Dec 2011 – Sep 2014 (39 five-day composites averaged), 1° grid; names of eleven currents | OSCAR third-degree surface currents, Earth & Space Research: Bonjean, F. & Lagerloef, G.S.E. (2002), Diagnostic model and analysis of the surface currents in the tropical Pacific Ocean, J. Phys. Oceanogr. 32, 2938–2954; served by NOAA CoastWatch ERDDAP, dataset `jplOscar`. Names and positions: Wikidata | ERDDAP record: "The data may be used and redistributed for free but is not intended for legal use, since it may contain inaccuracies." Wikidata: CC0 | https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplOscar.nc ; https://query.wikidata.org/sparql | `generate_ocean_currents.py` → `geo/ocean-currents.bin` (130 kB), `ocean-currents.json` (1 kB) | OSCAR, Earth & Space Research (Bonjean & Lagerloef 2002), via NOAA CoastWatch ERDDAP; Wikidata |
| Features of the ocean floor (`undersea-features`) | 412 named features (all trenches and deeps; the largest of each other kind) and the gazetteer's lines for trenches, fracture zones and ridges | IHO-IOC GEBCO Gazetteer of Undersea Feature Names, www.gebco.net (the citation GEBCO asks for), read from the gazetteer's API at NOAA NCEI | **No licence stated.** GEBCO's page: "Please include the following citation when data from the gazetteer are used or reproduced in reports, presentations and other products: IHO-IOC GEBCO Gazetteer of Undersea Feature Names, www.gebco.net"; the page is "Copyright © 2020-2026, GEBCO" | https://www.ngdc.noaa.gov/gazetteer/api/v1/feature | `generate_undersea.py` → `geo/undersea.json` (65 kB) | IHO-IOC GEBCO Gazetteer of Undersea Feature Names, www.gebco.net |
| Depth ladder (`depth-ladder`) | Pressure, density and temperature at eight depths down the line under the user's feet | PREM: Dziewonski, A.M. & Anderson, D.L. (1981), Preliminary reference Earth model, Phys. Earth Planet. Inter. 25, 297–356. Geotherm: Anderson, O.L. (1982), The Earth's core and the phase diagram of iron, Phil. Trans. R. Soc. A 306, 21–35. Both as tabulated with BurnMan (`input_seismic/prem.txt`, `input_geotherm/anderson_82.txt`), pinned to commit c3b396d. The antipode's nearest city: Natural Earth | Facts from the literature. BurnMan is "released under the GNU GPL v2 or newer": only the two tables are read (see the notes). Natural Earth: public domain | https://raw.githubusercontent.com/geodynamics/burnman/c3b396d091a5985f22fb3f981dd155957e667015/burnman/data/ | `generate_depth_ladder.py` → `geo/depth-ladder.json` (1 kB) | PREM, Dziewonski & Anderson (1981); Anderson (1982) |

Every source above is in the layer's `credits` (the in-app "Data credits"
list) and in `app/public/geo/ATTRIBUTION.md`. New in this slice's second
session: the two deep-mantle layers (`tomography-slow-bodies`, `ulvz`); the
rest were built in the first session and audited in the second. Total
shipped: 1.83 MB in 22 files, the largest the 503 kB magnetic-anomaly image.

## Licence-sensitive items: what needs a decision

None of these stops a public, non-commercial, open-source app from using
the data with the credit given. They are listed because the repository
cannot re-license them, and one of them forbids commercial use.

1. **Volcanoes of the World (GVP) - non-commercial only.** The Smithsonian's
   terms allow "personal, educational and other non-commercial purposes"
   with citation and a link, and require written permission for anything
   commercial. The same page says the database compilation "is a product of
   employees of the United States, and falls under (2)" - content "never
   eligible for copyright protection" - but the terms of use still bind.
   `geo/volcanoes.json` is kept in its own file for this reason: if the
   app is ever used commercially it must go, or permission be asked. The
   freer alternative already in the app is NOAA NCEI's Volcano Locations
   Database (public domain; names and positions only, in `geology.json`).
   **Needs Andy's decision** only if the project's own licence is meant to
   permit commercial reuse of everything in the repository.
2. **SEMUCB-WM1 - no licence.** A published model, redistributed by
   EarthScope and inside the hc repository, with a request to cite and no
   grant of rights. What ships is derived (six 720 × 360 images of the
   degree-31 expansion and one iso-surface), not the model's files. hc's
   GPL-2.0 covers "the HC code"; the bake runs none of it (the synthesis is
   reimplemented in numpy and pinned against hc's own `sh_syn` output), and
   GPL-2.0 section 0 covers a program's output only "if its contents
   constitute a work based on the Program", which a re-expression of a
   third party's published coefficients is not. This is a reading, not
   legal advice. `mantle-flow.json` (tectonics slice) rests on the same file.
3. **ULVZ Distribution Database - "Other (Open)", no named licence.** Open
   access on Zenodo; the authors name no licence and ask for no particular
   citation. The paper and the data DOI are cited. In its own file
   (`geo/ulvz.json`). The archive's folder of screenshots of other papers'
   figures is not used.
4. **CRUST1.0 - no licence.** The authors ask to be cited; nothing else is
   said. Two small derived images.
5. **GEBCO gazetteer - no licence; citation required.** The names are
   approved international names; the gazetteer's own text (histories,
   proposers) is not reproduced, only names, generic terms, label points,
   depths and line geometry. The required citation is the credit.
6. **BurnMan (GPL-2.0-or-later).** Checked: the bake fetches exactly two
   data files from the BurnMan repository, both tables of numbers published
   in the cited papers (the PREM file's header: "PREM (Dziewonski and
   Anderson, 1981) and QL6 (Durek and Ekstrom, 1996) (without an ocean)";
   only its depth, pressure and density columns are read). What is baked is
   eight rows of values interpolated from them, with rung names written in
   this repository. No BurnMan code or text is used or shipped.
7. **OSCAR via ERDDAP** - "may be used and redistributed for free"; a
   snapshot of 2011-2014, which is all that dataset holds, and the layer
   says "mean, 2011-2014", not "now".

No source here is share-alike.

Corrected in the audit (the credits as first merged were wrong or loose):

- GVP: the credit paired "(2025)" with the DOI of v. 5.2.0 (June 2024). Now
  v. 5.4.0 (7 Aug 2026), the version the database page gave as current.
- CRUST1.0 "freely distributed by the authors", GEBCO "freely available" and
  SEMUCB-WM1 "published model, cited": none of the three sources says so.
  Now "no stated licence" with what each does ask.
- The depth ladder fetched BurnMan's `main`; now pinned to the commit whose
  two files are byte-identical to those baked.
- `ATTRIBUTION.md` had no rows for any earth-extras file; added.

## What is derived, and what is a model

- **Tomography slices** are a model - an inversion of seismograms - and each
  caption says "a model (SEMUCB-WM1), smoothed to ~650 km". The six depths
  are layers of the file itself; nothing is interpolated in depth.
- **Slow provinces (3-D).** A contour, not an object: the −0.8 % surface of
  the same degree-31 expansion on a 2.5° grid of the model's own layers
  from 1,050 km down (every 100 km), by marching cubes. The deepest layer
  (2,850 km) is taken to hold down to the core-mantle boundary at 2,891 km,
  where the mesh has a flat base; at 1,050 km it is cut flat, so a column
  that goes on up is seen cut. Another threshold or another model draws a
  different body, and the caption and both labels ("… · −0.8 % contour
  (model)") say so. Inside the contour: 23.1 billion km³, 2.6 % of the
  mantle; the African piece 11.2, the Pacific 9.8, and 91 % of the volume
  in those two. The names "African LLSVP" and "Pacific LLSVP" are attached
  by rule to the two largest pieces from where their centres of volume fall
  (16.6°E 17.4°S and 158.8°W 13.6°S), following Garnero, McNamara & Shim
  (2016), Nature Geoscience 9, 481–489, doi:10.1038/ngeo2733.
  Drawing choices that are not data: depth is shown as colour (light at the
  cut, dark on the core) and as a line every 250 km; the base is left open
  where it faces the viewer so the roof can be seen from below; a body seen
  through the core is dimmed; nearer than ~4,500 km it thins.
  The fast side (+0.8 %, old slabs) was baked and drawn and **left out**:
  twenty-odd pieces, two of them walls across the default view from Austin
  (the Farallon body overhead and the one under the eastern Indian Ocean at
  the antipode). It hid more than it showed.
- **ULVZs.** Not a map of ULVZs but of where 54 studies looked. Positions
  are Yu & Garnero's digitisations of each study's figures, kept as given
  (longitudes brought to −180…180): a point is a ray's pierce point, a line
  the two ends of a diffracted path, an outline a studied region. Their
  0.5° Fresnel-zone grids are not used, so a mark is thinner than the patch
  of boundary a wave actually sensed. Empty means not looked at; the caption
  says so. Mega-ULVZ labels: Hawaii and Iceland are measured from their
  outlines in the database (centre; width from the mean radius × the core's
  radius, 3,480 km), with height and velocity drop from the database's
  `Details` table; Samoa's size is its paper's wording ("roughly 250 × 800 km
  … 10–15 km thick", Thorne et al. 2013); Galápagos is later than the
  database and is the paper's own best-fitting cylinder (105°W 2°N, 600 km,
  20 km, −25 %; stated uncertainties at least 2°, 100 km, 5 km, 5 %), drawn
  as a ring of that width. The Marquesas ULVZ (Kim et al. 2020) is not
  drawn: the paper says its data "does not constrain its precise location
  and characteristics".
- **Volcanoes.** "Last eruption" is the database's year on the day of the
  bake (9 Nov 2026): a snapshot, and the caption says so.
- **Geoid, Moho, sediment** are models (EGM96, CRUST1.0) and say so; the
  magnetic anomaly is a compilation with gaps left clear; heat flow is
  measurements only, the unmeasured planet left clear.
- **Ocean currents** are a satellite-derived analysis averaged over three
  years, animated as drifting trails; the trails are an animation of that
  mean field, not tracked water.
- **Depth ladder.** A scale, not structures; PREM is a radial average, and
  the temperature is one author's estimate, flagged as such.

## Verification

Pipeline checks, all passing on 2026-11-09: `test_tomography.py` (70
checks), `test_tomography_bodies.py` (28), `test_ulvz.py` (25),
`test_volcanoes.py` (90), `test_craters.py` (58), `test_earth_fields.py`
(91), `test_ocean_currents.py` (29), `test_undersea.py` (58),
`test_depth_ladder.py` (30). App: 652 vitest tests, lint, typecheck, build.

**Slow provinces against the model and the literature.** The checks read the
baked mesh back as the app does and ask whether points are inside it (parity
of crossings of a ray straight up):

- At 691 lattice points through the lower mantle (five depths 1,210-2,810 km,
  19.7° × 23.3° spacing, kept off the grid's nodes and at least 0.15 % from
  the threshold) the mesh's inside/outside equals the model's dVs < −0.8 %,
  691 of 691.
- Inside, on the core: under southern Africa (20°E 20°S, model −2.67 %), the
  south-east Atlantic (5°E 25°S, −2.74 %), the central Pacific (165°W 10°S,
  −1.54 %), the south Pacific superswell (150°W 18°S, −1.17 %); and 1,000 km
  above the core under southern Africa (−1.64 %).
- Outside: under east Asia (120°E 40°N, +1.11 %), northern North America
  (95°W 60°N, +1.15 %), the Southern Ocean south-west of Australia (+0.82 %),
  South America (−0.40 %), and in the mid mantle where the Farallon slab lies
  under eastern North America (+0.91 % at 1,400 km) and the Tethyan slabs
  under India (+1.11 % at 1,200 km) (van der Meer et al. 2018,
  Tectonophysics 723, 309, doi:10.1016/j.tecto.2017.10.004).
- The mesh is closed and consistently wound (each of 80,184 directed edges
  has its opposite; none shared by more than two triangles), lies between
  1,049.4 and 2,891.9 km, and is 241 kB.
- The numpy synthesis it rests on reproduces hc's own `sh_syn` at 24 points
  to 2 × 10⁻⁴ % (`test_tomography.py`).

**ULVZ database.** The baked counts equal an independent walk of the
unpacked archive: 121 files, 54 studies, 17,129 coordinate rows (points
1,986 / 2,508 / 479; path ends 370 / 436 / 106; outline vertices 8,475 /
1,142 / 1,627 for found / not found / uncertain). The first bake silently
dropped five files whose region code has an underscore; the script now
refuses any `Data.*` file it cannot parse. Pinned: Vidale & Benz's (1992)
"none" outline under the Gulf of Alaska; a path of Helmberger, Ni & Wen
(2000) under Africa; the Hawaiian outline measures 910 km across at the
core, the paper's "~ 910 km in diameter", and its centre is 11.7° south-west
of Kilauea, the paper's "~11° to the southwest of Hawaii" (Cottaar &
Romanowicz 2012, abstract); Iceland's centre is under Iceland.

**Licences.** Each source's own terms page was fetched and read on
2026-11-09; the quotations in the table are from those pages. Citations of
papers were checked against Crossref.

**By eye** (headless Chromium, 412 × 892 at dpr 2, from Austin; screenshots
in `~/review-loop/shots/earth-extras/`): see the list under "Screenshots".

## Unverified, approximate, or left out

- **GVP version.** The WFS has no version field. The cited v. 5.4.0 is what
  the database page showed on 30 Oct 2026 (Wayback Machine; the live site
  refuses scripted requests); the download is of 9 Nov. Not confirmed for
  those ten days.
- **Smithsonian and GVP terms** were read from Wayback snapshots (9 Jul and
  30 Oct 2026), not the live pages, for the same reason.
- **EGM96's public-domain status** is PROJ's statement about NGA's data.
- **SEMUCB-WM1 terms.** Berkeley's own model page needs a login and could
  not be read.
- **ULVZ `Details` units** are not stated in the database; they are read as
  per cent and km because the Hawaii row (−20, 20) and the Samoa row (−45,
  10) match those papers' "20%", "~ 20 km", "45%" and "10-15 km". The
  Iceland label's 15 km and −23 % rest on the table alone: the paper's
  abstract gives no numbers and its text could not be fetched.
- **CMB topography** (Muir, Tanaka & Tkalčić 2022, Zenodo
  doi:10.5281/zenodo.6525050, CC BY 4.0) was downloaded and **not shipped**:
  the record does not state the unit of the radius perturbation.
- **D″ discontinuity observations**: no machine-readable global table was
  found. **Inner-core facts** (anisotropy axis etc.): not attempted.
- **ULVZ near and far side.** Marks on the near and the far half of the core
  are drawn alike; which half a mark is on has to be read from the globe.
- **Frame times** below are from a shared machine with other headless
  browsers running; see the note there.

## Frame times

`tools/screenshot/shot.mjs`, 412 × 892 at dpr 2, Intel Iris Xe through ANGLE,
from Austin; the vsync floor is 16.6-16.7 ms. Default layers only: 16.6-17.0
ms over four runs. Each layer was measured alone (everything else off), added
to the default layers looking straight down, and alone looking toward the
horizon (yaw 60°, pitch −25°).

| Layer | alone | with defaults | toward the horizon |
| --- | --- | --- | --- |
| `tomography-150` | 16.7 | 16.7 | 16.7 |
| `tomography-400` | 16.7 | 16.7 | 16.7 |
| `tomography-700` | 16.7 | 16.7 (20.4 once) | 16.7 |
| `tomography-1250` | 16.5 | 16.7 | 16.7 |
| `tomography-2050` | 16.4 | 16.8 | 16.7 |
| `tomography-2850` | 16.7 | 16.7-17.6 | 16.7 |
| `tomography-slow-bodies` | 16.7 | 16.7 | 16.7 |
| `ulvz` | 16.5 | 16.8 | 16.7 |
| `volcanoes` | 16.7 | 16.7 | 16.7 |
| `eruptions-great` | 16.7 | 16.7 | 16.7 |
| `impact-craters` | 16.7 | 16.7 | 16.7 |
| `magnetic-anomaly` | 16.7 | 16.8 | 16.7 |
| `geoid` | 16.7 | 16.6 | 16.7 |
| `moho-depth` | 16.7 | 16.7 | 16.7 |
| `sediment-thickness` | 17.0 | 16.9 | 16.7 |
| `heat-flow` | 16.7 | 16.8 | 16.7 |
| `ocean-currents` | 16.7 | 16.9 | 16.7 |
| `undersea-features` | 16.7 | 16.7 | 16.7 |
| `depth-ladder` | 16.7 | 16.7 | 16.7 |

With the 2,850 km slice, the 3-D provinces, the ULVZs and the slabs all added
to the default layers: 16.8 ms.

The machine was shared with other headless browsers while these were taken:
runs of the default layers alone read 19-23 ms at busy moments, and the one
20.4 ms above did not repeat (16.7 twice on re-measuring). So the table shows
that no layer leaves the vsync floor here; it cannot show a cost smaller than
that noise, and it is not a phone measurement.

## Screenshots

In `~/review-loop/shots/earth-extras/` (412 × 892 at dpr 2, from Austin):

- `<layer>-alone.png`, `<layer>-default.png`, `<layer>-horizon.png` for each
  of the nineteen layers above: alone looking straight down through the
  Earth, added to the default layers, and alone toward the horizon.
- The slow provinces: `bodies-down-alone`, `bodies-down-2850-slice` (the
  bodies standing on the slice's red regions), `bodies-africa-alone`,
  `bodies-africa-2850-slice`, `bodies-africa-default-layers`,
  `bodies-pacific-alone`, `bodies-pacific-side-horizon`,
  `bodies-down-default-layers`, `bodies-with-slabs` (the Pacific province
  behind the Kermadec and Vanuatu slabs).
- ULVZs: `ulvz-down-alone`, `ulvz-hawaii-alone`, `ulvz-iceland`,
  `ulvz-down-with-2850-slice`, `ulvz-pacific-with-bodies`,
  `ulvz-hawaii-default-layers`, `all-deep-default` (slice, provinces and
  ULVZs over the default layers).
- `wip/` holds the first session's working shots.

What was changed after looking: the provinces went from clear glass with
bright edges (unreadable: every wall of every body at once) to shaded solids
with a depth pass of their own; the depth ladder's texts were moved off the
rings that struck them through. Left as it is: on the tomography slices the
near half of the shell is a veil over the far half, and where a slow patch
on one lies over a fast patch on the other the two mix to a purple that is
not on the legend.

## Wandering magnetic poles (added 2026-11-10)

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Wandering magnetic poles (`magnetic-pole-track`, lazy, off by default) | North and south magnetic (dip) pole positions, one a year 1590–2025, and forecast 2025–2030 | NOAA National Centers for Environmental Information, "Wandering of the Geomagnetic Poles": the files it labels "IGRF Pole Locations (1590–2025)" (`NP.xy`, `SP.xy`) and "WMM Pole Locations (2025–2030)" (`WMM2025_NP.txt`, `WMM2025_SP.txt`) | U.S. Government work, public domain | https://www.ncei.noaa.gov/products/wandering-geomagnetic-poles | Baked: `generate_magnetic_poles.py` → `app/public/geo/magnetic-poles.json` (20 kB, 884 positions) | NOAA NCEI |

- **These are computed positions, not surveyed ones**: where a field model's
  field is vertical. NOAA's page says the poles "are computed from all the
  Gauss coefficients using an iterative method". The caption says "computed
  from field models, not surveyed". The handful of surveyed positions (Ross
  1831, Amundsen 1904, the Canadian surveys to 2007) are on NOAA's map but not
  published as a file, so they are not drawn.
- **Which models**: NOAA's label is "IGRF Pole Locations (1590–2025)". IGRF
  itself begins in 1900; what NOAA used before that is not stated on the page
  (its older page named the historical model gufm1 — from memory, not
  re-read). The bake script's docstring says the same with the same caveat.
- The forecast years are drawn white and labelled "(forecast)".
- The star and its label ("North magnetic pole · 2026 · 32 km a year") are
  the track read at the app's clock; the speed is the distance between the
  positions a year before and a year after.

Checked:

- `tools/pipeline/test_magnetic_poles.py` (22): a position every year, no
  jump over 80 km, the 2025 WMM positions equal the ones quoted on NOAA's
  page (85.762°N 139.298°E; 63.851°S 135.078°E), north pole 4 km a year in
  1900–1910, 54 in 2000–2010, 40 in 2020–2025; south 9.
- `poles.test.ts` (14), including an independent check: for each forecast
  year NOAA's position and the one the app's own World Magnetic Model code
  finds (`magneticDipPole` in `packages/core`) are **under 3 km apart**, both
  poles, 2025–2030.
- Looked at from 55°N 100°W, from 45°S 140°E and from Austin on a phone-sized
  screen (`~/review-loop/shots/magnetic-poles/`, 3 shots): the northern track
  wanders among the Canadian Arctic islands until 1900, then runs straight
  across the Arctic Ocean to the star.
- Not checked: the southern track close up (my crop missed it; the full shot
  shows the rings and labels off Adélie Land), stereo.

## Ice age: the last glacial maximum (added 2026-11-10)

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Ice age (`ice-age`, lazy, off by default) | Northern Hemisphere ice-sheet extent at the Last Glacial Maximum, "best estimate" (913 polygons) | Batchelor, C.L., Margold, M., Krapp, M., Murton, D.K., Dalton, A.S., Gibbard, P.L., Stokes, C.R., Murton, J.B. & Manica, A. (2019), The configuration of Northern Hemisphere ice sheets through the Quaternary, Nature Communications 10, 3713, doi:10.1038/s41467-019-11601-2; LGM outline mainly from Ehlers, Gibbard & Hughes (2011) | The article is CC BY 4.0. **The data repository (osf.io/7jen3) states no licence** (checked through the OSF API: `node_license` is empty). Flagged in the index. | https://osf.io/7jen3/ | Baked: `generate_ice_age.py` → `app/public/geo/ice-age-mask.png` (129 kB), `ice-age.json` | Batchelor et al. (2019) |
| same | Sea-floor depths, every fourth point of ETOPO1 (1 arc-minute, ice surface) | Amante, C. & Eakins, B.W. (2009), ETOPO1 1 Arc-Minute Global Relief Model, NOAA Technical Memorandum NESDIS NGDC-24; from NOAA CoastWatch ERDDAP (`etopo180`) | U.S. Government work; ERDDAP's record: "may be used and redistributed for free" | https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180 | Baked, same script | NOAA NGDC ETOPO1 |
| same | The figure "sea level about 134 m lower" | Lambeck, K., Rouby, H., Purcell, A., Sun, Y. & Sambridge, M. (2014), PNAS 111, 15296–15303 — **cited from memory, the paper was not re-read this session** | — | https://doi.org/10.1073/pnas.1411762111 | — | — |

What is real and what is a simplification:

- **The ice is the published reconstruction**, rasterised. It is the
  authors' "best estimate" and they say it is for the general extent, not
  local-scale study. It covers **ice sheets over 50,000 km² in the Northern
  Hemisphere only**: Antarctica's larger ice, the Patagonian ice sheet and
  mountain glaciers are not in it. The caption says so.
- **The tan "new land" is today's sea floor shallower than 125 m and joined
  to the open ocean** — nothing more. It is *about* the land a sea 120–135 m
  lower left dry, with three known errors, all stated in the caption or
  here: the crust near the ice was pushed down and beyond it bulged; 20,000
  years of sediment lie on the shelves; and 125 m is one depth chosen from a
  range. The source paper's own maps make the same simplification.
- "Joined to the open ocean" matters: the Caspian's floor, the Dead Sea and
  Death Valley are below sea level too. The bake keeps only the largest
  connected body of below-sea-level cells; at a 4-arc-minute grid the
  Bosporus does not connect, so **the Black Sea's shelf is not drawn**
  (it was a lake then, at a level of its own).
- **Names are the usual ones; their positions are placed by hand** inside
  the mapped areas (the test checks each is inside). "Doggerland" is **not**
  used: in this reconstruction the Dogger Bank is under ice at the glacial
  maximum — the first version of the test asserted it was dry land and
  failed. It was dry only later.
- Areas on the chip ("ice 26 million km² · new land 18 million km²") are of
  the mask on a sphere.

Checked:

- `tools/pipeline/test_ice_age.py` (54): ice over Hudson Bay, Chicago,
  Toronto, Seattle, Stockholm, Edinburgh, Berlin, Svalbard, Reykjavik,
  Greenland's summit and the Dogger Bank; none at St. Louis, London, Paris,
  Fairbanks, Yakutsk, Madrid, Austin or the central Arctic Ocean; dry then:
  Bering Strait, southern North Sea, Sunda Shelf, Arafura Sea, Bass Strait,
  head of the Persian Gulf, Yellow Sea, Argentine shelf, the Channel off
  Dover; not drawn: the Caspian, the Dead Sea, Death Valley, the trenches;
  totals within published ranges (ice 24–29, shelves 14–22 million km²).
  Berlin under ice and London and Paris clear is the textbook limit of the
  last glaciation, which is some check on the outline's placing.
- `ice-age.test.ts` (8).
- Looked at from Austin, from Madrid, straight down from Austin (the Sunda
  and Sahul shelves joining Asia to Borneo and Australia to New Guinea) and
  on a phone-sized screen (`~/review-loop/shots/ice-age/`, 4 shots);
  16.7 ms.
- Not checked: stereo. (The other 17 time-slices are now baked; see the
  next section.)

## Ice sheets through time (added 2026-11-10)

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Ice sheets through time (`ice-sheets-time`, lazy, off by default) | Northern Hemisphere ice-sheet extent in all 18 of the paper's time-slices: the LGM, 30, 35, 40 and 45 ka, MIS 4, 5a–5d, 6, 8, 10, 12, 16, 20–24, the early Matuyama and late Gauss chrons (back to 3.59 Ma); best estimate of each | Batchelor et al. (2019), as above; age ranges from the repository's README | As above: article CC BY 4.0, **repository states no licence** | https://osf.io/7jen3/ | Baked: `generate_ice_sheets_through_time.py` → `app/public/geo/ice-sheets/*.png` (18 × 9–13 kB, 197 kB in all), `ice-sheets.json` | Batchelor et al. (2019) |

How it is drawn, and what that means:

- **One slice at a time**, stepped through with the deep-time control (the
  slices are irregular in time, so the control steps through slices, not
  years); `?ice=<slice id>` opens on one. Each picture is fetched when first
  shown. Exclusive with the LGM layer above, which adds the emerged land.
- **Best estimates only.** The repository also has minimum and maximum
  hypotheses for the 17 older slices; not drawn. Each slice is the
  largest ice within its span except 45 ka, MIS 5a and 5c, drawn at peak
  warmth — the control says which. Where a slice had no evidence for a
  region the authors borrowed another slice's ice with a similar d18O value;
  the largest extent may have come at different times in different places.
  No sea level is drawn for these slices (none is in the dataset).
- **Projection**: the 17 older files are in north-polar Lambert azimuthal
  equal-area on the WGS 84 ellipsoid (their `.prj` files are asserted). No
  projection library is in the pipeline's environment, so the forward
  formula is written out (Snyder 1987) and polygons are drawn on a polar
  raster that each output pixel samples: nothing crossing the date line or
  circling the pole needs cutting.

Checked (`tools/pipeline/test_ice_sheets_through_time.py`, 49):

- The projection against the ellipsoid itself: the area inside the
  projected circle at 80°, 60° and 40° equals the polar cap integrated on
  WGS 84 to 1e-6; longitudes land the right way round.
- The LGM drawn through the projection (26.1 million km²) agrees with the
  LGM layer drawn straight from longitude and latitude (26.2).
- MIS 6 has more ice than the LGM, as the paper finds; the three warm
  slices under half the LGM's.
- Places: ice over central Greenland in all 18 slices; over Hudson Bay in
  the eight full glacials; over Cambridge in MIS 12 (the Anglian) but not at
  the LGM; never over Paris, Beijing, Washington or Tokyo; MIS 6's north-east
  Asian ice continuous across the date line.
- **One check was dropped, not bent**: Utrecht under the MIS 6 (Saalian)
  ice, whose push moraine is there. The best estimate puts the margin 22 km
  north of the city; the README says the maps are for general extent, not
  local study, so a point that close to a margin tests nothing.
- `ice-sheets-time.test.ts` (9): the baked file, the labels (age ranges in
  ka or Ma, read out in years), the chip, the URL parameter, the switch.
- Looked at (`~/review-loop/shots/ice-sheets/`): the LGM, MIS 6 and MIS 5a
  through the planet from the antipode of Hudson Bay, with the control.

## Magnetic field on the core, 1900–2025 (added 2026-11-11)

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Magnetic field on the core (`core-field`, off) | Radial magnetic field on the core-mantle boundary (r = 3480 km), every five years 1900–2025, blended in between | International Geomagnetic Reference Field, 14th generation (IGRF-14), IAGA Division V Working Group V-MOD, December 2024 | Freely available international reference model; the coefficient file is served by NOAA NCEI (US Government). No licence text on the file. | https://www.ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt | Baked: `tools/pipeline/generate_core_field.py` → `app/public/geo/core-field/<year>.png` (26 × 512×256 grey, 21 kB each, 596 kB in all; one or two fetched at a time) and `core-field.json` | IGRF-14, IAGA V-MOD |

**What is computed.** The field measured at and above the surface is
continued down to the core as a potential field (the mantle is a near
insulator): Br = Σ (n+1)(a/r)^(n+2) P_n^m(cos θ)(g cos mφ + h sin mφ),
a = 6371.2 km, Schmidt semi-normalised. Continuing down multiplies degree
n by (a/r)^(n+2), so small scales grow most: every epoch is cut at degree
10, as all models before 2000 are, so the series does not jump in 2000
when the models gain degrees 11–13. The crust's own field (degree 14 and
up) is not the core's and is not in IGRF. Models before 1945 are not
definitive; the control says so before 1945. Grey 128 is no field, 1 and
255 are ∓1.2 mT; the shader stretches by 1.6 and leaves fields under 4%
of the scale clear.

**Checked** (`tools/pipeline/test_core_field.py`, 23 checks): the same
sum, at the surface with IGRF 2025 to degree 13, gives NOAA's published
WMM2025 test declinations (a different model of the same field) to within
0.2° at nine places from 82° N to 59° S; no net flux through the core in
1900, 1950 or 2020 (under 0.01% of the total, as there are no monopoles);
the strongest radial field 0.83–0.95 mT; inward flux lobes under Canada
(−0.62 mT) and Siberia (−0.67 mT) and an outward one south of Australia
(+0.79 mT) in 2020 (Jackson, Jonkers & Walker 2000); inward (reversed)
flux under the South Atlantic in 2020; the share of the southern core
under reversed flux growing, 13.6% in 1900, 19.7% in 1950, 21.1% in 2025;
the 2020 picture decodes to the field to one grey level. **One check
dropped, not bent**: a fourth lobe "south of Africa" was written from
memory, not from a source; the field there is +0.11 mT, eaten into by
the reversed patches. App: `core-field.test.ts` (6: epochs, blending,
status, `?core=<year>`, the switch).

**Looked at** (`~/review-loop/shots/core-field/`): from Austin looking
down, and over the South Atlantic in 1900 and 2025, the coastlines
projected on the ball; the control reads "1900 · model less certain
before 1945".

**Not done**: the field's change (secular variation) and core-flow models
inferred from it; the inner core; anything finer than degree 10. Not run
on a phone or headset.

## Gravity anomaly (added 2026-11-11)

The row is in the table at the top. **What is computed.** XGM2019's
coefficients (12 MB zip, degree 760) are synthesised here to degree 719, the
limit to which the model combines satellite, ground and altimetry data in
full (its README), at the centres of 0.25° cells on the GRS80 ellipsoid:
each point's geocentric latitude and radius, the series continued to that
radius, GRS80's normal field (J2 … J10) taken away, and the free-air anomaly
Σ (n − 1)(a/r)^n … in the usual spherical approximation (Heiskanen & Moritz
1967). Plain numpy, four seconds (`tools/pipeline/spherical_harmonics.py`).
Stored as a grey JPEG on a signed square-root scale to ±300 mGal; the
shader leaves anomalies under about 12 mGal clear.

**Checked** (`tools/pipeline/test_earth_fields.py`, 8 new checks): the
geoid from the same synthesis sits 0.58 m above EGM96's grid (EGM96 carries
NGA's −0.53 m zero-degree term) and otherwise matches it to 0.60 m rms, an
independent model, which holds the normalisation, the normal field and the
ellipsoid; the worst place is 12 m at 29° N 96° E in Tibet, where EGM96 had
no ground gravity. The anomaly averages to nothing over the globe. Its
lowest point anywhere is at the Puerto Rico Trench (66.4° W, 19.4° N),
−360 mGal: USGS Open-File Report 2005-1066 gives "the most negative
free-air gravity anomaly on earth, −380 mGal", at finer resolution. The
Challenger Deep is under −200 mGal and Hawaii's volcanoes over +200. The
JPEG holds the anomaly to 4.7 of 127 codes rms, the bound the magnetic
JPEG was chosen to. App: `fields.test.ts` (the code and the pale zero).

**Looked at** (`~/review-loop/shots/gravity/`): the Caribbean, with the
trench's label, and the western Pacific. Over land the map is busy: there
the free-air anomaly mostly follows the topography; a Bouguer anomaly would
take that away, and is not built.

**Not done**: the Bouguer anomaly; degrees above 719 (XGM2019e goes to
5,540, but above 719 it is mostly topography, not measured gravity). Not run
on a phone or headset.

## The transition zone's boundaries: the 410 and the 660 (added 2026-11-11)

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Top of the transition zone (`transition-zone-410`, off); Base of the transition zone (`transition-zone-660`, off) | Depth of the 410 and 660 km discontinuities from SS precursors, corrected for 3-D structure above, each drawn as a ball at its average depth coloured by its departure from that average | Waszek, L., Tauzin, B., Schmerr, N.C., Ballmer, M.D. & Afonso, J.C. (2021), A poorly mixed mantle transition zone and its thermal state inferred from seismic waves, Nature Geoscience 14, 949–955, doi:10.1038/s41561-021-00850-w; data: ISC Seismological Dataset Repository, doi:10.31905/7M3LMG8X | **No stated licence.** The readme says only "When using this dataset, please cite Waszek et al., Nat. Geosci., 2021"; shipped on that citation, as CRUST1.0 and the ULVZ database are. Flagged in the progress file. | https://download.isc.ac.uk/datarepository/410660.tgz | Baked: `tools/pipeline/generate_transition_zone.py` → `app/public/geo/transition-zone/410.png` (34 kB) and `660.png` (37 kB), 512×256 grey, and `transition-zone.json` | Waszek et al. (2021), ISC Dataset Repository |

**What is drawn.** The archive (21 MB) holds SS and PP measurements, corrected
and not, on a complete, already smoothed 0.5° grid. The SS files are used: the
660 is mostly invisible to PP, which is the paper's finding. The two files are
read out of the archive without unpacking it (it carries macOS `._` files),
interpolated to pixel centres and written as the departure from the map's own
area-weighted mean: grey 128 is the mean, 1 and 255 are 30 km shallower and
deeper. The means are 410.0 km and **653.9 km**: from SS the "660" averages
654 km, and the ball for it sits there. Green is raised, violet pushed down,
±20 km at the ends; departures under 2 km are clear. The 410 ranges
396–425 km, the 660 634–679 km.

**Checked** (`tools/pipeline/test_transition_zone.py`, 21 checks): both grids
complete, 361 × 721, the ±180° columns equal; ranges and the 410's mean; the
zone's thickness follows the thermal model in the same archive, which was
made from it (r = −0.993, thin where hot), so the files were read the right
way round; mean thickness 244 km, against about 242 km in earlier global
studies (Flanagan & Shearer 1998; Lawrence & Shearer 2006); the 660 deeper
and the zone thicker than average under the Izu-Bonin (+7.5/+7.9 km), Tonga
(+2.7/+7.7) and South American (+13.0/+10.1) subduction zones, where cold
slabs reach it; the zone 10.8 km thinner than average under Hawaii (Li et al.
2000, Nature 405, 938); the deepest 660 at 15.5° S 89.5° W, off Peru over
the subducting slab; each picture decodes to the data within 1 km. **One
check dropped, not bent**: that the 410 and 660 move in opposite directions.
Over the globe this data has them moving together (r = +0.39), and the claim
was general knowledge, not from this paper. App: `transition-zone.test.ts`
(4).

**Looked at** (`~/review-loop/shots/transition-zone/`): the 660 from Lima and
from Tokyo, the 410 from Hawaii, each looking down; the label "the 660 · 654
km on average" sits where the ball passes under the viewer. The relief comes
in blobs thousands of km across: the bounce points of SS waves are averaged
over wide caps, so nothing smaller is real.

**Not done**: the PP measurements, the uncorrected depths, the amplitudes and
the thermal model, all in the same archive; the transition zone's thickness
as its own map. Not run on a phone or headset.

## Lithosphere thickness (added 2026-11-11)

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Lithosphere thickness (`lithosphere`, off) | Depth of the thermal lithosphere-asthenosphere boundary: how far down the cold, rigid plate reaches, drawn on the surface above | Priestley, K., Ho, T., Takei, Y. & McKenzie, D. (2024), The thermal and anisotropic structure of the top 300 km of the mantle, Earth Planet. Sci. Lett. 626, 118525, doi:10.1016/j.epsl.2023.118525 (model CAM2023); files from the EarthScope Earth Model Collaboration, CAM2023.emc.2025-01-13 | No stated licence: the README and the EMC ask that the paper and the EMC be cited. Recorded as an open question in the progress file. | https://data.earthscope.org/archive/seismology/products/emc/data/CAM2022/CAM2023.emc.2025-01-13.tgz (16.3 MB; only `CAM2023_lithosphere.xyz` is read) | Baked: `tools/pipeline/generate_lithosphere.py` → `app/public/geo/lithosphere.png` (180×90 grey, a pixel per 2° cell, 9 kB) | CAM2023 (Priestley et al. 2024) |

**What it is.** A surface-wave model's thermal plate: CAM2023 turns shear-wave
speeds into temperatures and puts the base of the lithosphere where they
meet the mantle's adiabat (the README calls it the "thermal
lithosphere-asthenosphere boundary"; its LAB file was updated from
CAM2022). A model on a 2° grid, smoothed over about 200 km: it shows the
cratons' keels and the oceans' cooling, not any single place's depth. Grey
= round(255 × depth / 300 km); 21–263 km in the file. Thin plate dark,
thick bright, a line every 50 km.

**Checked** (`tools/pipeline/test_lithosphere.py`, 20 checks). Against an
independent dataset: under the oceans the plate thickens with the square
root of the seafloor's age, as plate cooling predicts (Parsons & Sclater
1977); with the app's seafloor-age picture (Seton et al. 2020, made from
magnetic stripes, not seismic waves) at 7,877 ocean cells, r = 0.81, and
the median thickness rises with every older band: 32, 41, 69, 78, 93 km
for 0–10, 10–30, 30–60, 60–100 and 100–200 Myr. Keels over 150 km under
the Superior (199 km), Slave (182), Siberian (175), Kaapvaal (166), West
African (189), Yilgarn (198) cratons and the Fennoscandian shield (216)
(Jordan 1978; Priestley & McKenzie 2006); under 50 km at the East Pacific
Rise (25), the Mid-Atlantic Ridge (29), Iceland (31) and Afar (31). The
picture decodes to the file within half a step (0.59 km). App:
`lithosphere.test.ts` (4: the scale matches the bake, thick brighter than
thin, the 50 km contour, the switch).

**Looked at** (`~/review-loop/shots/lithosphere/`): North America and
South America, and Africa with Arabia and India, each seen through the
Earth from its antipode; the keels stand out bright inside their 150 and
200 km contours, the ridges dark.

**Not done**: the other LAB models (LITHO1.0, LithoRef18) to show how much
models disagree; Tibet's 240 km is the model's and is debated. Not run on
a phone or headset.

## SKS splitting: the grain of the upper mantle (added 2026-11-11)

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Grain of the upper mantle (`sks-splitting`, off) | Shear-wave splitting of core-refracted phases (SKS, SKKS, PKS) at seismic stations: the fast direction and the delay, averaged per station; stations with only nulls | Barruol, G., Wüstefeld, A. & Bokelmann, G. (2009), SKS-Splitting-database, Université de Montpellier, Laboratoire Géosciences, doi:10.18715/SKS_SPLITTING_DATABASE; Wüstefeld, A., Bokelmann, G., Barruol, G. & Montagner, J.-P. (2009), Phys. Earth Planet. Inter. 176, 198–212, doi:10.1016/j.pepi.2009.05.006; and the published works it compiles (366 references, in `splittingDB_ref.txt`) | No named licence: "an open-access database … do not forget to cite the proper works & references". Recorded as an open question in the progress file. | http://splitting.gm.univ-montp2.fr/DB/public/splittingDB.txt (6.7 MB, last modified 2026-10-05) and `splittingDB_ref.txt` | Baked: `tools/pipeline/generate_sks_splitting.py` → `app/public/geo/sks-splitting.json` (13,620 stations × 7 integers, 345 kB, 115 kB gzipped) | SKS splitting database, Univ. Montpellier |

**What is kept.** 69,277 rows; kept 66,458: those of a core-refracted
phase (a K in the phase's name, or no phase given). Dropped: 2,659 direct
S, ScS and local S rows (they split near the earthquake too), 134 rows
that are one layer of a two-layer model, 26 without a place or a value.
539 kept rows are nulls (phi "null" or dt 0): few authors publish their
nulls, so a station with no ring may simply not have reported any. Per
station (same place to 0.01°): the fast direction is the axial mean (the
mean of 2φ, halved, since φ and φ + 180° are the same direction), R its
strength, dt the mean delay of the split rows; every row counts once,
single measurement or published station mean alike. 13,352 stations
have a direction; 268 have only nulls.

**How it is drawn.** A bar through the station along the fast direction,
45 km each side per second of delay (no shorter than 0.25 s), coloured
cyan (0.3 s) → green (1 s) → yellow (2 s) and dimmed to 45% where R is
low; grey rings, 18 km across, at null-only stations. The splitting
happens somewhere along the path below the station, mostly in the top few
hundred kilometres; the bars sit on the surface because the depth is not
known.

**Checked** (`tools/pipeline/test_sks_splitting.py`, 14 checks): the axial
mean of 170° and 10° is 0°, and of 0° and 90° has no strength; over 95% of
rows kept; the median station delay about a second (1.01 s; Silver 1996);
southern California east-west (172 stations, 86°, R 0.82; inferred from
Polet & Kanamori 2002, whose abstract puts the fast directions orthogonal
to the maximum horizontal compressive stress, near north-south there); the Pyrenees along the range, about N100°E (122 stations,
96°, R 0.90; Barruol et al. 1998); the file decodes to what was computed.
**Not used as a check**: New Zealand's South Island came out at 28°, not
the Alpine Fault's ~55° that I expected from memory; my box takes in
stations well off the fault, and with no source to hand the check was
dropped, not tuned. App: `sks-splitting.test.ts` (5: the counts the
caption gives, bar orientation for φ 0° and 90°, length with delay,
dimming with scatter, rings only for null-only stations, the switch).

**Looked at** (`~/review-loop/shots/sks-splitting/`): North America (the
USArray's dense coverage), Europe, both layers on together, and southern
California at 10° field of view, where the bars run east-west.

**Not done**: per-measurement back-azimuths (the file has them only in
some remarks), which would show two-layer structure; other compilations
(Missouri S&T SWS-DB). Not run on a phone or headset.

## Inner core: rays through it (added 2026-11-11)

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Inner core: rays through it (`inner-core`, off) | 5,129 PKIKP rays through the inner core: entry, exit, turning depth and differential travel-time residual (PKP AB−DF or BC−DF) | Frost, D.A., Lasbleis, M., Chandler, B. & Romanowicz, B. (2021), Dynamic history of the inner core constrained by seismic anisotropy, Nature Geoscience 14, 531–535, doi:10.1038/s41561-021-00761-w; data compiled from Vinnik et al. 1994, Bréger et al. 2000, Tkalčić et al. 2002, Leykam et al. 2010, Cao & Romanowicz 2007, Romanowicz et al. 2015, Frost & Romanowicz 2019, Soergel 2015 and the paper itself | CC BY 4.0 (Zenodo record) | https://doi.org/10.5281/zenodo.4721364 | Baked: `tools/pipeline/generate_inner_core.py` → `app/public/geo/inner-core.json` (180 kB, 70 kB gzipped) | Frost et al. 2021, Zenodo (CC BY 4.0) |

**Why rays and not a map.** The inner core's structure is known from the
waves that cross it, and there are few: the sources and stations sit where
they sit, so most of the ball is crossed by no wave at all. Drawing the rays
shows both what is measured and where nothing is. Each ray is two straight
legs from where it enters the inner core to where it turns, at the file's
depth under the middle of its chord, and out; a straight chord turns within
12 km of the real ray. Colour is the residual: blue arrived early, red late,
the mantle slices' convention, dim grey near nothing so the few strong rays
show over the many weak ones (the strongest are drawn last). The Earth's axis
is the grey line through the ball.

**Checked** (`tools/pipeline/test_inner_core.py`, 14 checks): 5,144 rays,
5,129 with a residual (none has both kinds); every turning point on its ray's
great circle and midway along it; the file's angle to the axis (ξ) equal to
the chord's to within 0.4°, which is what the app computes in its place;
every ray turning inside the inner core; rays within 35° of the axis arrive
a median +3.18 s early, rays over 55° from it +0.02 s: the anisotropy found
by Morelli, Dziewonski & Woodhouse (1986, GRL 13, 1545) and the paper's
subject; the bake decodes to the file. App: `inner-core.test.ts` (6).

**Not claimed.** The paper finds the anisotropy strengthening with depth.
Binned simply here by turning depth, the polar-minus-equatorial difference
grows in seconds (3.1 → 4.0 s) but shrinks per 1,000 km of path (2.0 → 1.6
s), so the app does not say it either way. The east–west hemispheres and the
innermost inner core (radius ~300–650 km by different studies) exist only as
numbers in papers and are not drawn. AB−DF residuals carry more of the
lowermost mantle than BC−DF; both are drawn alike, and the file says which.

**Looked at** (`~/review-loop/shots/inner-core/`): from the equator and from
Austin, looking down; the polar rays a blue band along the axis. Not run on a
phone or headset.

## Ocean drilling: every cored hole (added 2026-11-11)

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Ocean drilling: 4,216 cored holes (`drill-holes`, off) | Every hole cored by the Deep Sea Drilling Project (legs 1–96, 1968–83), the Ocean Drilling Program (legs 100–210, 1985–2003) and IODP (expeditions 301 on): position, the programmes that worked it, how many cruises | International Ocean Discovery Program, Drilled Holes table (the table behind its Google Earth maps) | No licence stated; the programmes are publicly funded (NSF, JAMSTEC, ECORD and partners) and publish their data openly | https://kml.iodp.org/Drilled_Holes.csv | Baked: `tools/pipeline/generate_drill_holes.py` → `app/public/geo/drill-holes.json` (128 kB, 32 kB gzipped) | IODP Drilled Holes table (DSDP, ODP, IODP) |

**What is drawn.** A dot per hole (site and hole letter), coloured by the
programme that first cored it; a hole reopened on several cruises is one
point at its first-listed position. Holes worked on three or more cruises are
ringed and named: ten, led by Hole 504B on the Costa Rica Rift (nine cruises,
DSDP leg 69 to IODP expedition 384T), then 395A, U1309D, 1256D, 418A, 801C, 857D,
858G, C0002F and C0010A. A cruise's programme is from its number: under 100
DSDP, 100–210 ODP, 301 and up IODP.

**Not sized by depth, as first planned.** The table's `core_penetrated`
column is not one quantity across cruises: Hole 735B gives 500.7 m for leg
118 and 1,508 m for leg 176 (the hole's whole depth after both); U1503A
995.1 m then 1,710.1 m; while 504B's legs each give that cruise's own
interval. Summing or taking the largest would each be wrong for some holes,
so the dots are one size and the caption says why.

**Checked** (`tools/pipeline/test_drill_holes.py`, 14 checks): 4,283 rows,
4,216 holes, each hole–cruise pair once; the programme rules (78B is DSDP,
384T is IODP); over 1,000 holes from each programme; Site 1 in the Gulf of
Mexico (DSDP leg 1, 1968); 504B with nine cruises from DSDP to IODP at 1.23 N
83.73 W and the most visited; no hole near Kola (the table is ocean drilling
only); every position on the globe. App: `drill-holes.test.ts` (4).

**Licence.** The table states none. It is recorded as such in the credits,
not read as public domain.

**Looked at** (`~/review-loop/shots/drill-holes/`): the Pacific and the
Atlantic from the far side, the named holes legible. Not run on a phone or
headset.

## Caves with a known depth (added 2026-11-11)

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Caves with a known depth (`deep-caves`, off) | 253 caves with a position and a vertical depth (P4511, highest entrance to lowest point) | Wikidata, one SPARQL query (instance of cave, Q35509, or any subclass) at query.wikidata.org, asked on 2026-11-11 with the pipeline's generic User-Agent | CC0 1.0 | https://www.wikidata.org/wiki/Property:P4511 | Baked: `tools/pipeline/generate_deep_caves.py` → `app/public/geo/deep-caves.json` (9.5 kB, 4.4 kB gzipped) | Wikidata (CC0) |

**What is drawn.** A triangle per cave, coloured and sized by depth band
(under 100 m, 100–300 m, 300 m–1 km, over 1 km); the eight caves of 500 m and
more are named. Of several depths on one item the greatest is kept; two items
within 1 km are one cave entered twice and the deeper is kept. The query,
name rules (English Wikipedia title, else English label) and position parsing
are `generate_landmarks.py`'s, whose `deep-places` set already takes the
caves of a kilometre and more.

**Uneven coverage, said in the caption.** Wikidata has a depth for 507
cave items with positions; 171 of the 253 caves kept lie in and around
Bulgaria. Many
famous deep systems (the Lamprechtsofen, Réseau Jean Bernard, Sistema Huautla)
have no depth on Wikidata and are missing. The layer shows what Wikidata
states, not a census of deep caves.

**Wikidata and Wikipedia disagree at the top.** Wikidata gives Veryovkina
2,212 m and Krubera 2,199 m, so Veryovkina is first in the file; Krubera's
English article calls it "the deepest known cave on Earth" and Veryovkina's
gives 2,209 m "as of 2025", second after Krubera. The labels give Wikidata's
numbers and the caption claims no ranking, only that the three deepest
(Veryovkina, Krubera, Sarma) lie within 2 km of each other in the Arabika
Massif.

**Checked** (`tools/pipeline/test_deep_caves.py`, 14 checks): CC0 recorded;
over 200 caves; every depth positive and every position on the globe; deepest
first; no two caves within 1 km; the three deepest are the Arabika caves, in
the massif's box, each over 1.8 km; Veryovkina within 15 m of its article's
2,209 m; Hranice Abyss 520 m (its article: 519.5 m) near Hranice, Czech
Republic; the app's naming threshold. App: `deep-caves.test.ts` (4).

**Looked at** (`~/review-loop/shots/deep-caves/`): Europe, and the Arabika
Massif close up (Krubera and Veryovkina named; Sarma's label gives way to
theirs). Not run on a phone or headset.

## Permafrost zones (added 2026-11-11)

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Permafrost: ground frozen for years (`permafrost`, off) | Northern Hemisphere permafrost zones (continuous, discontinuous, sporadic, isolated patches), modelled at 1 km from MODIS land-surface temperature and ERA-Interim, 2000–2016 | Obu, J., Westermann, S., Kääb, A. & Bartsch, A. (2018), Ground Temperature Map, 2000–2016, Northern Hemisphere Permafrost, PANGAEA, doi:10.1594/PANGAEA.888600 (the PERZONES shapefile); method and areas: Obu, J. et al. (2019), Northern Hemisphere permafrost map based on TTOP modelling for 2000–2016 at 1 km² scale, Earth-Science Reviews 193, 299–316 | CC BY 3.0 | https://doi.org/10.1594/PANGAEA.888600 | Baked: `tools/pipeline/generate_permafrost.py` → `app/public/geo/permafrost.png` (2048×1024, 115 kB) and `permafrost.json` (areas) | Obu et al. 2018, PANGAEA (CC BY 3.0) |

**What the zones are.** Each 1 km cell's permafrost probability is the
fraction of 200 model runs with the ground below 0 °C, read as the share of
the cell underlain by permafrost, and classed as the IPA map does
(Brown et al.): continuous above 0.9, discontinuous 0.5–0.9, sporadic
0.1–0.5, isolated patches 0.005–0.1 (Obu et al. 2019, section 2). The classes
were smoothed with a 5×5 filter and vectorised; that file is what is baked.
Glaciers, Greenland's ice sheet among them, are not part of it.

**Reprojected by hand.** The polygons are in Arctic Polar Stereographic
(EPSG:3995: WGS 84, standard parallel 71° N, central meridian 0; the
`.prj` is checked for those). They are filled at 2 km in that plane, each
record's holes cut only from its own outer rings, and the equirectangular
picture is sampled by projecting each of its 2×2 subsamples forward with the
ellipsoidal polar stereographic formulas (Snyder 1987, USGS PP 1395, ch. 21)
in numpy, no projection library. R holds the zone (64 a step, spread a few
pixels past the edge so filtering keeps the colour), B the coverage.

**Checked** (`tools/pipeline/test_permafrost.py`, 22 checks): the projection
(pole at the origin, k = 1 on 71° N, k at the pole (1 + sin 71°)/2 to 0.001,
the central meridian down the plane, 180° up it); 79,239 polygons, four zones;
zone areas from the polygons (plane area over k² at each ring's centre)
against the paper's: continuous 11.56 v 10.7, discontinuous 3.24 v 3.1,
sporadic 3.68 v 3.5 million km², each within 10%; the picture covers what the
polygons do within 3% (23.5 v 23.2 million km²); nothing south of 15° N;
Prudhoe Bay on the North Slope continuous, where the paper finds its extent
"matches well" Jorgenson et al.'s map; none on Kodiak Island or in Spain's
Sierra Nevada (both stated in the paper); the middle of Greenland's ice sheet
not mapped. App: `permafrost.test.ts` (4).

**Not matched.** The file's isolated-patches zone is 4.74 million km²
against the paper's 3.5: the paper's figures are counts of probability
pixels, the file is smoothed polygons, and the paper itself finds isolated
patches overestimated in central Alaska. Checked only as "more than 3.5". The
chip's region total (23.2 million km²) is the polygons', larger than the
paper's 20.8 for the same reason.

**Not drawn.** The dataset's Southern Hemisphere products (Antarctica, the
Andes, New Zealand, East Africa) come as rasters in other projections, not as
zones; the caption says the southern hemisphere's permafrost is not drawn.
Permafrost depth and ground temperature (MAGT) are not shown.

**Looked at** (`~/review-loop/shots/permafrost/`): Siberia and the Tibetan
Plateau, and North America with the Arctic islands, from the far side. Not
run on a phone or headset.
