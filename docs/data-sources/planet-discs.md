# Planets close up: data sources and verification

What the `planet-discs` layer draws, where it comes from and what was
checked. Numbers are as measured on 2026-11-10 (UTC).

## Datasets shipped

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Planets close up (`planet-discs`, lazy, off by default) | Radii, north-pole directions and prime-meridian rotations of Mercury to Neptune; radii of ten moons | Archinal, B.A. et al. (2018), Report of the IAU Working Group on Cartographic Coordinates and Rotational Elements: 2015, Celest. Mech. Dyn. Astron. 130:22 (with its 2019 erratum), as transcribed in NAIF's planetary constants kernel `pck00011.tpc` (N. Bachman, JPL, 2022) | NAIF kernels: free to use (naif.jpl.nasa.gov/naif/rules.html) | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc | Baked: `generate_planet_constants.py` → `packages/core/src/astro/planet-rotation-data.ts` | IAU WGCCRE 2015; NAIF/JPL |
| same | Orbits of Io, Europa, Ganymede, Callisto, Tethys, Dione, Rhea, Titan, Iapetus and Triton | JPL Horizons satellite ephemerides (Giorgini et al., JPL Solar System Dynamics), compressed here to one precessing ellipse per moon | US Government work; free use with acknowledgement | https://ssd.jpl.nasa.gov/horizons/ | Baked: `generate_planet_moons.py` → `packages/core/src/astro/planet-moons-data.ts` (6 kB) | JPL Horizons |
| same | Maps of Mars (Viking orbiter mosaic), Jupiter, Saturn and Neptune (Voyager mosaics) | NASA 3D Resources, "Images and Textures": the JPL Solar System Simulator's planet maps; NASA/JPL-Caltech | "free and without copyright" (the collection's README); NASA media guidelines ask for credit | https://github.com/nasa/NASA-3D-Resources | Baked: `generate_planet_maps.py` → `app/public/sky/planets/*.jpg` (171 kB in all) | NASA/JPL-Caltech |
| same | Edges, optical depths and albedos of Saturn's C, B and A rings and the Cassini division | Saturnian Rings Fact Sheet, D. R. Williams, NASA Space Science Data Coordinated Archive (last updated 19 April 2022) | US Government work, public domain | https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html | In code: `SATURN_RINGS` in `packages/core/src/astro/planet-discs.ts` | NASA NSSDCA |
| Test fixtures only | Horizons' own values for each planet's disc at 16 instants over 1950–2050, and for each moon at 29 | JPL Horizons API | as above | https://ssd.jpl.nasa.gov/api/horizons.api | `fetch_planet_disc_fixture.py`, `fetch_planet_moon_fixture.py` → `packages/core/src/astro/planet-*.fixture.ts` | JPL Horizons |

Nothing is fetched at run time.

## What is computed, what is a picture, what is a drawing choice

- **Computed, and held to Horizons:** each disc's angular size, flattening,
  the direction of its pole on the sky, which longitude and latitude face the
  Earth, where the Sun stands over it (hence the phase and the terminator),
  the opening of Saturn's rings, each moon's place beside its planet and
  whether the planet hides it, shadows it or carries it across its face.
- **Pictures:** the four maps. Mars's is tied to the ground and is right
  for any date. **The giants' are not:** belts and zones are at their true
  latitudes, but clouds drift, the maps are from 1979–1989, and the app's
  rotation for the giants is the magnetic field's (System III). The Great
  Red Spot is on the map; its longitude on the disc is not today's. The
  layer's caption says so.
- **No map:** Mercury (would need another source), Venus and Uranus (no
  markings in visible light). They are one flat tone, the same drawing-choice
  colour the planets' points already use, lit by the real geometry.
- **Rings:** the fact sheet gives each ring's optical depth and albedo as a
  range; the app uses the middle of each range, so each ring is one flat
  tone. Brightness is single scattering by a thin layer (reflection on the
  sunlit face, diffuse transmission on the dark one); the planet's shadow
  falls on the rings and the rings' on the planet. The Encke and Keeler gaps
  and all ringlets are left out. The rings' tint and overall brightness
  against the disc are drawing choices.
- **Drawing choices:** everything is drawn **40× life size** (Jupiter is at
  most 50″ across, a thirtieth of the Moon: at life size 50 pixels at the
  app's old narrowest field of 0.2°, and invisible in a headset, which cannot
  zoom), the moons' spacing by the same factor, so at this scale a moon can
  stand in front of unrelated stars. The caption says "drawn 40× life
  size". Saturn's map is pulled 45% toward grey because the source is far
  more orange than the planet. Moon colours are chosen, not measured; moons
  are dots (never under 3 px).

## Why the moons' orbits are a fit

The full satellite theories run to hundreds of terms, and JPL's published
table of mean elements (ssd.jpl.nasa.gov/sats/elem) is rounded to 0.1°. The
bake samples Horizons' planet-centred vectors for each moon (4,800 two-hourly
points over 400 days and 6,000 points over 1950–2050) and fits eleven
numbers: a precessing ellipse whose plane precesses about a tilted Laplace
plane, plus for Tethys its 70-year libration with Mimas. What the fit loses
is written into the data file and tested:

| Moon | Worst distance from Horizons, 1950–2050 | As an angle along the orbit |
| --- | --- | --- |
| Io | 233 km | 0.03° |
| Europa | 1,599 km | 0.14° |
| Ganymede | 3,960 km | 0.21° |
| Callisto | 3,467 km | 0.11° |
| Tethys, Dione, Rhea | 363–418 km | 0.04–0.07° |
| Titan | 1,316 km | 0.06° |
| Iapetus | 10,527 km | 0.17° |
| Triton | 142 km | 0.02° |

Ganymede's 3,960 km is 1.3″ from the Earth, 1/30 of Jupiter's disc; in time,
an eclipse or occultation of a Galilean moon can be a few minutes off.
**Outside 1950–2050 the fit is not tested and drifts**; for Iapetus and
Callisto the split between the orbit's own tilt and the Laplace plane's is
not resolved by one century of data, so those two would go wrong soonest.

## Verification

`packages/core/src/astro/planet-discs.test.ts` (1,166 cases) against JPL
Horizons at instants the fit did not use:

- Poles: right ascension and declination within 0.0001° for all seven
  planets at all 16 instants.
- Angular diameter within 1 part in 100,000.
- Sub-Earth longitude within 0.005° and latitude within 0.002°; sub-solar
  longitude within 0.02°, latitude within 0.005°.
- Position angle of the pole within 0.01° (Uranus 0.03°).
- Illuminated fraction within 0.01 percentage points.
- Moons, as an offset from the planet on the sky: worst Io 0.07″, Europa
  0.34″, Ganymede 0.77″, Callisto 0.76″, Titan 0.12″, Iapetus 1.29″, Tethys,
  Dione and Rhea under 0.07″, Triton 0.04″.
- Moon events: 13 instants were picked as the middles of events the app's
  orbits predict for 10–16 November 2026 (each Galilean moon in Jupiter's
  shadow and behind it, three crossing its face, two of Saturn's). Horizons'
  visibility codes agree at every one, and at all other instants except
  where a moon is within its own width of the limb (Horizons judges limb to
  limb, the app by the moon's centre).

One difference from Horizons, deliberate: Horizons' "north pole distance"
is c·cos(planetographic latitude); the pole's place on the disc is
c·cos(planetocentric latitude), which is what the app draws. The test
reproduces Horizons' number its way to 0.001″ and checks the app's is the
larger of the two.

`tools/pipeline/test_planet_moons.py` (63 checks) reads the baked orbits
back and checks them against Horizons' vectors and against JPL's published
mean elements (semi-major axes within 0.15%, eccentricities within 0.0015,
the periods of Saturn's five moons to 1 part in a million, Io's 1.333-year
periapsis period, Triton's 157° inclination) and the Laplace resonance
n(Io) − 3 n(Europa) + 2 n(Ganymede) = 0. JPL's table gives periods for
Jupiter's moons and Triton that are not sidereal (its Io is 1.762732 d);
those are not used.

`tools/pipeline/test_planet_maps.py` (19 checks) checks Mars's map is the
right way round by named dark features against the deserts beside them
(Syrtis Major, Mare Acidalium, Mare Cimmerium, Mare Erythraeum, Hellas, the
north polar cap) and that the giants' maps are banded east–west.

Looked at in the running app (screenshots in `~/review-loop/shots/planet-discs/`):
Jupiter with its four moons in line with its belts; Io on Jupiter's face and
Io gone in its shadow; Saturn's rings 27° open (2017), 25° open showing the
other face (2003), a hairline when edge-on (March 2025), with the globe's
shadow on the rings and the rings' on the globe; Venus a 9% crescent; Mars
gibbous with its polar cap; Neptune and Triton; a phone-sized view at the
default 60° field. Frame time 16.5–16.8 ms on the shared Iris Xe desktop GPU.

## Not done, not checked

- Not run on a phone or a headset; not looked at in stereo.
- Uranus's and Neptune's rings, the moons of Mars and Uranus, and the
  moons' own faces and shadows on their planets are not drawn.
- Mercury has no map.
- The discs are seen from the Earth's centre; from the surface a planet
  shifts by under 35″, which at 40× is up to 0.4° against the stars.
