# Slabs, trenches, ridges and seafloor age: data sources and verification

What the subducting-slab, plate-boundary and seafloor-age layers draw, where
it comes from, and what was checked against what. Numbers are as measured on
2026-11-09/10 (UTC).

## Datasets shipped

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Subducting slabs (`slabs`, lazy, on by default) | Depth of the top surface and plate thickness of all 27 slabs, 80,593 nodes; slab names | Hayes, G. P., et al. (2018), Slab2, a comprehensive subduction zone geometry model, Science 362, 58–61, doi:10.1126/science.aat4723; data release doi:10.5066/F7PV6JNV (depth grids `*_dep_*.grd`, thickness grids `*_thk_*.grd`; names are the region names of the release's 27 child items) | Public domain (US Government) | https://www.sciencebase.gov/catalog/item/5aa1b00ee4b0b1c392e86467 | Baked: `tools/pipeline/generate_slabs.py` → `app/public/geo/slabs.bin` (384 kB, 223 kB gzipped). Static: Slab2 is a 2018 release. | Hayes et al. (2018), Slab2, USGS |
| Plate boundaries (`boundaries`, always loaded): trench teeth | Which plate overrides at each of 68 subduction polylines | Bird, P. (2003), An updated digital model of plate boundaries, Geochemistry Geophysics Geosystems 4(3), 1027, doi:10.1029/2001GC000252 (PB2002): the `/` and `\` of each boundary's name, as defined in the data supplement's readme (http://peterbird.name/oldFTP/PB2002/2001GC000252_readme.txt); step file as converted by H. Ahlenius, Nordpil | ODC-By 1.0 | https://github.com/fraxen/tectonicplates | Baked: `tools/pipeline/generate_geology.py` → `subductionOverriding` in `app/public/geo/tectonics.json` | Bird (2003) PB2002; GIS conversion by H. Ahlenius, Nordpil |
| Seafloor spreading (`spreading`, always loaded): ridge ribbons and arrows | Relative plate speed (the full spreading rate) and its azimuth at each of 2,349 ridge and rift steps | PB2002 step file, as above (columns "velocity" and "velocity azimuth"; Bird computed them from the Euler poles of his Table 1) | ODC-By 1.0 | as above | Baked: same script → `ridgeSteps` in `tectonics.json` (the file grew from 273 to 294 kB) | as above |
| Seafloor age (`seafloor-age`, lazy, off by default) | Age of the oceanic crust | Seton, M., Müller, R. D., Zahirovic, S., Williams, S., Wright, N., Cannon, J., Whittaker, J., Matthews, K., McGirr, R. (2020), A global dataset of present-day oceanic crustal age and seafloor spreading parameters, Geochemistry, Geophysics, Geosystems 21, e2020GC009214, doi:10.1029/2020GC009214; grid `age.2020.1.GTS2012.6m.nc` (6 arc-minute, Ogg 2012 timescale) | CC BY 4.0 (`LICENSE.txt` beside the grids; the Zenodo record 10.5281/zenodo.6782543 says the same) | https://www.earthbyte.org/webdav/ftp/earthbyte/agegrid/2020/ | Baked: `tools/pipeline/generate_seafloor_age.py` → `app/public/geo/seafloor-age.png` (385 kB, 2048×1024) | Seton et al. (2020), EarthByte age grid 2020.1 |

Nothing here is fetched at run time, so there is no CORS or privacy question.
All four credits are in the app's "Data credits" list (the slab and PB2002
lines through `ui/credits.ts`, the age grid through its layer definition).

## What is derived, and what is schematic

- **Slab plates.** Top surface: Slab2's depth grid, point-sampled every 0.2°
  (0.1° for eight slabs: Calabria, Central America, Hindu Kush, Izu-Bonin,
  Puysegur, Solomon Islands, Sulawesi, Vanuatu). Underside: the top moved
  down its own normal by Slab2's thickness grid. Slab2 derives that
  thickness from the age of the subducting plate; it is a model value, not
  an image of the slab's base. The outline is cut where the source grid's
  mask ends, to sub-node precision.
- **Geometric error of the sampling**, measured by the bake against every
  one of the 1.02 million source nodes (written into the file's header):
  per slab, rms 0.08–0.86 km, 99th percentile 0.27–2.33 km, worst node
  0.5–6.7 km (the 6.7 km is on the near-vertical tip of the Central America
  slab; elsewhere the worst is 5.1 km). Depth is quantised to 12.5 m,
  thickness to 1 km. For scale, Slab2's own stated depth uncertainty is of
  the order of 10 km and more.
- **Ridge ribbon.** Not a mapped feature: at each ridge point it spans the
  distance the two plates part in 3 Myr at PB2002's present rate, along
  PB2002's direction of motion. It says "this much seafloor in 3 Myr if the
  rate held", which is what the caption says. From across the planet a slow
  ridge's ribbon would be a pixel or two wide, so it is drawn no narrower
  than 9 px: at that distance its width no longer measures anything, only
  its colour does.
- **Spreading arrows** point along PB2002's velocity azimuth; their length
  equals the ribbon's half-width, but never under 110 km, so on slow ridges
  the length is not to scale either.
- **Trench teeth** are a map symbol (110 km wide, 100 km long, every
  ~220 km), on the side PB2002 names as overriding.
- No upwelling curtain or other invented structure under the ridges was
  added.

## Verification

Pipeline checks (all pass): `test_slabs.py` (37 checks), `test_geology.py`
(50), `test_seafloor_age.py` (21), `test_seismicity.py` (unchanged
earthquake checks; `quakes.json` is byte-identical after the slab half was
moved out of `generate_seismicity.py`).

**Slab depths against the source grids.** Fourteen nodes read from the
`.grd` files and pinned in `test_slabs.py`; the baked file reproduces each
to its 12.5 m quantum: Pacific slab under Tokyo 68.06 km (and the
Philippine Sea slab above it at 29.53 km), under Sendai 67.75, under the Sea
of Japan 351.70; Nazca slab under the central Andes 88.71, Santiago 52.58,
northern Argentina 448.05; Juan de Fuca slab under Seattle 50.41 (32 km
thick), off Oregon 16.09; Tonga 154.29 and 578.34; Padang 78.99; Anchorage
30.54; Crete 76.89 (193 km thick). Between nodes, on the app's triangles:
90.98 km against the grid's 90.83 under the Andes, 61.50 against 61.51 under
north-east Japan. Deepest baked node 700.0 km (Kermadec–Tonga; the grid's
single deepest node, 701.16 km, falls between samples). The file is read by
`slab_file.py`, written from the layout's description rather than sharing
code with the bake; the app's reader has its own unit tests on synthetic
files.

**Trench polarity.** PB2002's convention was read from Bird's readme, not
assumed: the boundary name gives the plate on the left then the one on the
right of the digitising direction, `/` means the right-hand plate subducts.
Checked two ways:
- By compass at eight trenches (Japan, Cascadia, Chile, Tonga, Sumatra,
  Aleutians, Lesser Antilles, Marianas): teeth point onto the overriding
  plate at all eight.
- Against Slab2 at every trench step: where a slab lies shallower than
  100 km at 80 km to one side only, the teeth must point to that side. 905
  steps agree, 7 do not, none were changed. The seven: four on the Trobriand
  Trough (149–150° E, 7.6° S), one off western Greece (20.1° E, 37.9° N),
  two in the Molucca Sea (125.5° E, 0°). In each, the slab Slab2 models
  nearby belongs to a different, neighbouring subduction zone than the
  boundary PB2002 draws there; this reading rests on the geometry of the
  two datasets, not on a literature check of each place.

**Spreading rates** against PB2002's own figures (the test tolerances are in
brackets): Mid-Atlantic Ridge at 30° N 22.6 mm/yr toward 103°/283° [20–25];
East Pacific Rise at 20° S 148.1 [130–155]; Southwest Indian Ridge at 57° E
10.8 [9–16]; Southeast Indian Ridge at 98° E 71.2; Gakkel Ridge 10.7;
fastest step anywhere 202.1. These are PB2002's rates (2003, NUVEL-1A-era
poles); they were not cross-checked against NNR-MORVEL56. The brief's
expectation of ~14 mm/yr for the Southwest Indian Ridge is higher than
PB2002's 10.8–11.2 there.

**Seafloor age** against the source grid at eleven nodes, e.g. ridge axes
0.1–1.0 Myr (image 0.2–1.2), north-east Pacific 32.1 (31.8), off Japan 136.2
(135.5), western Pacific at 18° N 156° E 168.3 (167.5), eastern
Mediterranean 306.4 (308.8). Symmetry: along 30° S the 65 Myr crust lies
12.95° west and 13.5° east of the axis in the grid; the image reads 65.6 Myr
at both. Ocean crust covers 57.4 % of the sphere in grid and image. No seam
at the antimeridian. The western Pacific's oldest crust in this grid is
189.5 Myr, not the "~180" of the brief; the test pins grid values.

**Colours.** `depthColor`, the slab shader's ramp and the CSS legend are
compared at every km from −10 to 720 in `interior.test.ts`: all within half
an 8-bit step of each other (before: up to 28/255 apart between stops). The
same test pattern covers the spreading ramp and the age ramp against their
shaders. These tests run the generated GLSL's arithmetic in JavaScript;
pixel values were not read back from the GPU.

**Screenshots** (in `~/review-loop/shots/tectonics/`, before/after pairs
from Austin unless named): default down view; Japan–Kuril, Tonga–Kermadec,
Andes, Sumatra (with and without earthquakes for the first two); Cascadia
from Austin and from Seattle standing on it; the Andes slab edge-on from
Santiago; Mid-Atlantic Ridge, East Pacific Rise and the Indian Ocean triple
junction with and without the age layer; phone viewport (412×892 @2x) of
the default view, Japan and the layers panel; Cardboard stereo.

## Performance (Intel Iris Xe via ANGLE, 412×892 @2x, vsync floor 16.7 ms)

| View | frame ms | triangles / frame |
| --- | --- | --- |
| Default, slabs and spreading off | 16.7 | 0.80 M |
| Default (slabs, boundaries, spreading on) | 16.7 | 1.54 M |
| + seafloor age | 16.7 | 1.54 M |
| Standing on a slab (Seattle, Tokyo), looking down, + seafloor age | 16.7 | 1.54 M |

The slab mesh is 361 k triangles (top, underside and edge walls), drawn
twice a frame (depth, then colour): 0.72 M of the total. It has no
per-frame CPU work and nothing is sorted; heap growth over 3 s is the same
with the layers on and off. Not measured on a phone or a headset.

Bytes: before, the map's blocking fetch included `slabs.json` (43 kB) and
`tectonics.json` (273 kB); now `tectonics.json` (294 kB) only, so first
paint waits for 23 kB less. `slabs.bin` (384 kB) and its 11 kB code chunk
load after first paint, because the layer is on by default;
`seafloor-age.png` (385 kB) and its 5 kB chunk load when switched on.

## Known weak points

- With earthquakes on (the default) the dots cover much of each slab's
  shallow part and the trench teeth; the plates read best with earthquakes
  off. Slab fill is held under three quarters of the ramp's brightness so the dots still
  stand out.
- Slabs hide the slabs behind them (they share a depth pass), although they
  are translucent against the globe. A slab nearer than ~850 km is exempt
  and is drawn as a faint tint with contour lines so it does not wall off
  the view below a user who lives on one; the changeover is a visible step
  in the rare place where another slab lies behind that distance.
- Near-vertical slab tips (Central America under central Mexico) show a
  stepped edge: a single-valued depth grid cannot hold a vertical sheet, in
  Slab2's own grid as much as here. The overturned parts of four slabs,
  which Slab2 ships as loose points, are not drawn.
- The ribbon of a fast ridge is a row of offset blocks where transforms
  step the axis; that is what 3 Myr of crust looks like there, but it is
  busy. The seafloor-age layer shows ridges far better and is off by
  default because it recolours half the globe.
- Depth figures on the contours ("300 km") rank last among labels and
  rarely find room in a wide view.
- Trenches draw over the slabs but under the earthquakes.

## Geologic provinces, Archean crust and igneous provinces (added 2026-11-11)

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Geologic provinces (`geologic-provinces`, off) | 921 provinces tiling the Earth, coloured by province type (15 types in 11 colours) | Hasterok, D., Halpin, J.A., Collins, A.S., Hand, M., Kreemer, C., Gard, M.G. & Glorie, S. (2022), New maps of global geological provinces and tectonic plates, Earth-Science Reviews 231, 104069, doi:10.1016/j.earscirev.2022.104069; `global_gprv.shp` from the Zenodo record doi:10.5281/zenodo.6586972 (version 1, the latest) | CC BY 4.0 (Zenodo record). The same files on GitHub (dhasterok/global_tectonics) are GPL-3.0; not used. | https://doi.org/10.5281/zenodo.6586972 | Baked: `tools/pipeline/generate_geologic_provinces.py` → `app/public/geo/provinces.png` (2048×1024, 81 kB) and `provinces.json` | Hasterok et al. (2022) |
| Cratons: the oldest crust (`cratons`, off) | 114 polygons of crust with Archean (>2.5 Ga) basement, craton / shield / other, and whether reworked after the Archean; 38 names | as above, `cratons.shp` | CC BY 4.0 | as above | Baked: same script → `cratons.png` (55 kB) and `cratons.json` (names, centres, member provinces) | Hasterok et al. (2022) |
| Large igneous and volcanic provinces (`igneous-provinces`, off) | 2,526 polygons of magmatism apart from ordinary seafloor spreading, coloured by age, 21 named | Johansson, L., Zahirovic, S. & Müller, R.D. (2018), The interplay between the eruption and weathering of Large Igneous Provinces and the deep-time carbon cycle, GRL 45, doi:10.1029/2017GL076691; volcanic provinces v2 in the EarthByte GPlates 2.3 sample data (`IgneousProvinces.zip`) | CC BY 3.0 (EarthByte's GPlates 2.3 data page) | https://www.earthbyte.org/webdav/ftp/earthbyte/GPlates/GPlates2.3_GeoData/Individual/IgneousProvinces.zip | Baked: `tools/pipeline/generate_igneous_provinces.py` → `igneous-provinces.png` (105 kB) and `.json` | Johansson et al. (2018), EarthByte |

**Fetching only what is needed.** The Zenodo record is a single 1.17 GB zip.
The bake reads its central directory with HTTP Range requests (Zenodo
answers 206), then fetches and inflates just the four members it needs
(`global_gprv.shp/.dbf`, `cratons.shp/.dbf`, 1.8 MB packed), checking each
CRC. `cratons.dbf` has no code-page file and some names are Latin-1; they
are decoded as such ("Saõ Francisco Craton", spelt as the source spells it).

**What `cratons` means.** The repository README: "regions with geochemical
samples or that are known to have Archean (>2500 Ma) basement; the polygons
have largely been extracted from global_gprv.shp ... an additional column in
the attribute table has been added to identify post-Archean reworking". 59 of
the 114 are reworked; they are drawn in the same hue, fainter. Not every
polygon is typed craton: 55 cratons, 34 shields, and 25 orogenic belts, arcs,
rifts and basins with Archean basement under them.

**Province classes.** Wide and narrow rifts are one colour; basin, foredeep
basin and continental back-arc basin another; oceanic back-arc basins are
drawn with oceanic crust. Nothing else is merged. Oceanic crust is drawn at
0.3 opacity, the rest at 0.62, so the continents lead.

**Why Johansson and not Whittaker.** The same zip holds Whittaker et al.
(2015)'s 80 plume-related LIPs, the stricter set; but they stop at 200 Ma and
are all from a plume and ridge study, with no Siberian Traps, Emeishan or
Wrangellia. Johansson's README says what its 2,526 polygons hold: "a range of
emplacement modes, essentially any significant magmatism that is distinct
from typical seafloor spreading-related magmatism", age-progressive or not:
flood basalts, oceanic plateaus, dyke swarms, and seamount chains outlined
along depth contours. The layer is named for that. Ages are the file's
`FROMAGE` (the age each polygon appears in the plate model); the scale runs
to 300 Ma and the few older ones (to 650 Ma in the file) sit at its end and
carry no age in their names. Polygons are where the rocks are today.

**Drawing.** One shared bake (`tools/pipeline/province_raster.py`) draws
polygons of longitude and latitude on a 2048×1024 picture: R the class or
age, G outlines (cratons only: thin lines were most of the bytes elsewhere),
B anti-aliased coverage. Rings are unwrapped across the date line and drawn
at −360, 0 and +360°; a ring once round a pole is closed along it
(Antarctica, the Arctic). Larger polygons are drawn first (provinces,
cratons) and older first (igneous), so the smaller or younger lie on top.
The app reads the class unfiltered (`texelFetch`) and colours it from a
256-entry palette (`app/src/layers/geologic-provinces/drape.ts`), draws an
edge where the class changes or the coverage ends, and reads coverage
filtered.

**Checked** (`tools/pipeline/test_geologic_provinces.py`, 37 checks;
`test_igneous_provinces.py`, 16):
- the provinces' area column sums to 510.2 million km² (the Earth's area);
- the drawing covers 100.00% of the sphere;
- oceanic crust drawn over 57.5% of the Earth, the figure in the paper's
  abstract ("We estimate 57.5% of the Earth's surface is covered by oceanic
  crust"); the file's crust-type column alone gives 58.7%, because it counts
  oceanic back-arc basins;
- all 921 provinces and 114 Archean polygons are drawn, 59 reworked;
- places that sit on Archean cratons in every geology text are on Archean
  crust and named in the right group: Johannesburg (Kaapvaal in the Kalahari
  Craton), Kalgoorlie (Eastern Yilgarn) and Marble Bar (Pilbara) in the West
  Australian Craton, Yellowknife (Slave), Timmins (Wawa-Abitibi in the
  Superior Craton); Hawaii and Iceland are not;
- the file's ages within 5 Myr of U-Pb dates: Siberian Traps 248–251 Ma
  against 251.9 Ma (Burgess & Bowring 2015), CAMP 201 Ma against 201.6–201.0
  Ma (Blackburn et al. 2013), Deccan 65 Ma against 66.3–65.6 Ma (Schoene et
  al. 2019);
- Mahabaleshwar (Western Ghats) on the Deccan, drawn at 65 Ma; the island of
  Hawai'i on its chain under 3 Ma; Paris and Alice Springs on nothing.

**One check dropped, not bent**: Norilsk on the Siberian Traps. The file's
outlines stop about 17 km short of the town.

App tests: `provinces.test.ts` (7: classes match the bake, palette layout,
unfiltered class read, legend), `cratons.test.ts` (3), `igneous.test.ts` (4).

**Looked at** (`~/review-loop/shots/geologic-provinces/`, `cratons/`,
`igneous-provinces/`): Africa and Asia through the Earth; North America's
cratons named; standing on the Kaapvaal looking north; India and Siberia
with the Deccan, Siberian Traps, Emeishan and Ontong Java named. With all
three on, the desktop GPU stayed at the 16.7 ms vsync floor; not measured on
a phone or headset. Each picture is 2048×1024, the size of the other
surface drapes: about 8 MB of GPU memory (RGBA) plus mipmaps while its
layer is on. They were baked at 4096×2048 first (32 MB each); all checks
pass at the smaller size.

**Not done**: province names (921 is too many to show; only the craton
groups and 21 igneous provinces are named); the provinces' last-orogeny and
crust-type columns; the plates file from the same record.
