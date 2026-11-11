# Data sources: the deep-sky slice

Catalogued objects of the faint and invisible sky (panel section "Deep
sky": 16 switches) and all-sky maps at other wavelengths (panel section
"Sky maps": 12 switches, one at a time). Also the seven bright binaries
the `stars` layer was missing.

Everything is free and keyless, and everything is baked: nothing in this
slice is fetched from a third party at run time. Baked files are
committed under `app/public/sky/deep/` (0.95 MB) and
`app/public/sky/maps/` (2.72 MB).

Services used by the pipeline: NASA HEASARC (TAP), NASA LAMBDA, NASA
SkyView, NASA/IPAC IRSA (files and TAP), the NASA Exoplanet Archive
(TAP), JPL Horizons, the CfA mirrors of VizieR and SIMBAD (the Strasbourg
hosts time out from the build machine), and OpenNGC on GitHub.

## Catalogues (`tools/pipeline/generate_deepsky.py` → `app/public/sky/deep/`)

All positions ICRS/J2000. "HEASARC `x`" means NASA HEASARC's table `x`,
queried with ADQL.

| Layer (id) | What | Source and citation | Licence / terms | Where fetched | Baked file (bytes) | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| `deep-sky-objects` | 1,313 Messier / NGC / IC objects: all with a Messier number or a common name, all to V (else B) 11.5, nebulae over 15′; type, magnitude, axes, position angle | OpenNGC, Mattia Verga and contributors (built from NED, HyperLEDA, SIMBAD, HEASARC) | **CC BY-SA 4.0** (share-alike: see notes) | https://github.com/mattiaverga/OpenNGC (`NGC.csv`, `addendum.csv`) | `dso.json` 49,752 | OpenNGC by Mattia Verga and contributors, CC BY-SA 4.0 |
| `globular-clusters` | All 157 Milky Way globulars: V, distance, half-light radius | Harris W.E. 1996, AJ 112, 1487 (2010 edition) | published catalogue, citation requested | HEASARC `globclust` | `globulars.json` 6,280 | Harris 1996 (2010 edition) |
| `supernova-remnants` | 295 Galactic remnants: type, 1 GHz flux, angular size | Green D.A., A Catalogue of Galactic Supernova Remnants (June 2017 version); 2019, J. Astrophys. Astron. 40, 36 | published catalogue, citation requested | HEASARC `snrgreen` | `snr.json` 12,837 | Green D.A., Cavendish Laboratory, Cambridge |
| `nearby-stars` | 439 stars, brown dwarfs and white dwarfs within 10 pc (planets left out), carried by proper motion to 2026.0; distance from parallax | Reylé C. et al. 2021, A&A 650, A201, "The 10 parsec sample in the Gaia era" (2023 update) | CDS VizieR: free use with citation | VizieR `J/A+A/650/A201/tablea1` (CfA mirror) | `nearby.json` 11,780 | Reylé et al. 2021, the 10 parsec sample |
| `exoplanet-hosts` | 4,857 host stars of confirmed planets: number of planets, discovery method of the first | NASA Exoplanet Archive, Planetary Systems Composite Parameters (`pscomppars`), doi:10.26133/NEA13 | public; acknowledgement text requested | https://exoplanetarchive.ipac.caltech.edu/TAP | `exoplanets.json` 88,019 | This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with NASA |
| `exoplanet-candidates` | 8,259 planet candidates on 7,961 stars, one ring per star per mission, sized by count: TESS (TFOPWG disposition PC or APC, 5,307), Kepler (cumulative KOI table, CANDIDATE, 1,977), K2 (default rows, CANDIDATE, 975); read 2026-11-11 | NASA Exoplanet Archive tables `toi`, `cumulative`, `k2pandc` | public; acknowledgement text requested | https://exoplanetarchive.ipac.caltech.edu/TAP | `exoplanet-candidates.json` 137,413 (49 kB gzipped) | This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with NASA |
| `pulsars` | 4,503 pulsars: period, type (magnetar = `AXP` in the type column) | ATNF Pulsar Catalogue, Manchester R.N., Hobbs G.B., Teoh A., Hobbs M. 2005, AJ 129, 1993 | free use with acknowledgement of the paper and web address | HEASARC `atnfpulsar` | `pulsars.json` 87,832 | ATNF Pulsar Catalogue (Manchester et al. 2005), https://www.atnf.csiro.au/research/pulsar/psrcat |
| `xray-sources` | 1,891 hard X-ray sources, 14-195 keV: flux, counterpart, class | Swift-BAT 157-Month All-Sky Hard X-ray Survey (Lien A. et al. 2025) | NASA data, public | HEASARC `swbat157m` | `xray-hard.json` 38,403 | Swift-BAT 157-month survey, NASA/GSFC |
| `xray-binaries` | 114 high-mass and 187 low-mass X-ray binaries: peak 2-10 keV flux | Liu Q.Z., van Paradijs J., van den Heuvel E.P.J. 2006, A&A 455, 1165; 2007, A&A 469, 807 | published catalogues, citation requested | HEASARC `hmxbcat`, `lmxbcat` | `xray-binaries.json` 7,618 | Liu, van Paradijs & van den Heuvel 2006, 2007 |
| `xray-uhuru` | The 339 sources of the Fourth Uhuru catalogue (1970-73), 2-6 keV | Forman W. et al. 1978, ApJS 38, 357 | NASA data, public | HEASARC `uhuru4` | `xray-uhuru.json` 7,969 | Forman et al. 1978, the 4U catalogue |
| `xray-rosat` | 18,811 soft X-ray sources, 0.1-2.4 keV: count rate | ROSAT All-Sky Survey Bright Source Catalogue, Voges W. et al. 1999, A&A 349, 389 (MPE) | published catalogue, citation requested | HEASARC `rassbsc` | `xray-rosat.bin` 112,866 | Voges et al. 1999, ROSAT All-Sky Survey (MPE Garching) |
| `gamma-sources` | All 7,195 sources of 4FGL-DR4, 0.1-100 GeV: energy flux, class, association | Fermi-LAT Fourth Source Catalog DR4, Abdollahi S. et al. 2022, ApJS 260, 53; Ballet J. et al. 2023 | NASA data, public | HEASARC `fermilpsc` | `gamma.json` 139,527 | Fermi-LAT Collaboration, 4FGL-DR4 |
| `nearby-galaxies` | 868 galaxies within 11 Mpc: distance, B magnitude, Holmberg diameter | Karachentsev I.D., Makarov D.I., Kaisina E.I. 2013, AJ 145, 101, Updated Nearby Galaxy Catalog | CDS VizieR: free use with citation | VizieR `J/AJ/145/101/catalog` (CfA mirror) | `galaxies.json` 21,099 | Karachentsev, Makarov & Kaisina 2013 |
| `galaxy-survey` | 43,533 galaxies with redshifts (Ks ≤ 11.75, \|b\| ≥ 5°) | 2MASS Redshift Survey, Huchra J.P. et al. 2012, ApJS 199, 26 | published catalogue, citation requested | HEASARC `twomassrsc` | `lss.bin` 261,198 | Huchra et al. 2012, 2MASS Redshift Survey |
| `galaxy-clusters` | 5,250 Abell clusters (north and south, with the supplement): richness and distance class; plus the Virgo cluster's position from SIMBAD | Abell G.O., Corwin H.G., Olowin R.P. 1989, ApJS 70, 1 | published catalogue, citation requested | HEASARC `abell` | `clusters.json` 91,488 | Abell, Corwin & Olowin 1989 |
| `quasars` | 456 quasars and blazars to magnitude 16.5 and 9 famous active galaxies: redshift | Véron-Cetty M.-P., Véron P. 2010, A&A 518, A10 (13th edition) | published catalogue, citation requested | HEASARC `veroncat` | `quasars.json` 10,863 | Véron-Cetty & Véron 2010 |
| `sky-landmarks` | 23 named objects (black holes, historic supernovae, multi-messenger sources, deep fields, large structures) | Positions: SIMBAD, CDS Strasbourg (Wenger M. et al. 2000, A&AS 143, 9) | free use with acknowledgement | SIMBAD TAP (CfA mirror) | `landmarks.json` 1,956 | This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France |
| `sky-landmarks` | CMB dipole direction (l, b) = (264.021°, +48.253°) | Planck Collaboration 2020, A&A 641, A1 (arXiv:1807.06205, table 3: 3362.08 µK, 369.82 km/s) | published value | typed into the script from the paper | same | Planck 2018 results I |
| `sky-landmarks` | Solar apex from (U, V, W) = (11.1, 12.24, 7.25) km/s | Schönrich R., Binney J., Dehnen W. 2010, MNRAS 403, 1829 (abstract of arXiv:0912.3693) | published value | typed into the script from the abstract | same | Schönrich, Binney & Dehnen 2010 |
| `sky-landmarks` | CMB Cold Spot at (l, b) = (209°, −57°) | Cruz M. et al. 2005, MNRAS 356, 29 | published value | typed into the script | same | Cruz et al. 2005 |
| `sky-landmarks` | Directions and distances of Voyager 1 and 2, Pioneer 10, New Horizons on 2026-01-01 (geocentric, astrometric) | JPL Horizons, Solar System Dynamics Group | public | https://ssd.jpl.nasa.gov/api/horizons.api | same | JPL Horizons |
| `stars` (fix) | J2000 positions and proper motions of 7 binaries with no Hipparcos astrometry (HIP 31067, 52800, 55203, 59273, 78727, 80579, 115125) | SIMBAD, CDS Strasbourg | free use with acknowledgement | SIMBAD TAP (CfA mirror), in `generate_stars.py` | `stars.json` (+7 stars) | SIMBAD, CDS Strasbourg |

Total: 950,185 bytes in 18 files.

## All-sky maps (`tools/pipeline/generate_skymaps.py` → `app/public/sky/maps/`)

Each is a 2048×1024 JPEG, plate carrée in galactic coordinates, l = 0 at
the centre increasing to the left. One 2048×1024 texture is 8 MB of GPU
memory (RGBA8, no mipmaps); the layer frees it when its switch goes off,
and the switches are exclusive, so at most one is held.

| Layer (id) | What | Source and citation | Licence / terms | File fetched | Scaling | Baked (kB) |
| --- | --- | --- | --- | --- | --- | --- |
| `map-radio-408` | 408 MHz radio continuum, 56′ | Haslam C.G.T. et al. 1982, A&AS 47, 1, destriped and desourced by Remazeilles M. et al. 2015, MNRAS 451, 4311 | NASA LAMBDA: public, citation requested | LAMBDA `haslam408_dsds_Remazeilles2014.fits` (HEALPix 512) | log, 11 K → 600 K | `radio-408.jpg` 85 |
| `map-hi-21cm` | Neutral hydrogen column density, 16′ | HI4PI Collaboration 2016, A&A 594, A116 | LAMBDA: public, citation requested | LAMBDA `NHI_HPX.fits` (HEALPix 1024, averaged to 512) | log, 6×10¹⁹ → 2×10²² cm⁻² | `hi-21cm.jpg` 171 |
| `map-cmb-cobe` | CMB anisotropy, 53 GHz (A+B)/2, monopole and dipole fitted out at \|b\| > 20°, smoothed by 7° to 10° | COBE DMR 4-year sky maps, Bennett C.L. et al. 1996, ApJ 464, L1 | NASA, public domain | LAMBDA `dmr_4yr_healpix_imaps.tar.gz` (HEALPix 32) | linear, ±200 µK, black at 0 | `cmb-cobe.jpg` 129 |
| `map-cmb-dipole` | The same channel with the dipole restored from the archive header's vector (as the header instructs), antenna → thermodynamic ×1.0747 | COBE DMR 4-year sky maps in sky-cube pixels | NASA, public domain | LAMBDA `DMR_SKYMAP_53A_4YR.FITS`, `…53B…` | linear, ±3.6 mK | `cmb-dipole.jpg` 71 |
| `map-cmb-wmap` | CMB anisotropy, 1° | WMAP nine-year ILC map, Bennett C.L. et al. 2013, ApJS 208, 20 | NASA, public domain | LAMBDA `wmap_ilc_9yr_v5.fits` (HEALPix 512) | linear, ±300 µK | `cmb-wmap.jpg` 377 |
| `map-cmb-planck` | CMB anisotropy, 5′ (baked at 10.5′/pixel) | Planck 2018 SMICA, Planck Collaboration 2020, A&A 641, A4 | ESA/Planck: public, acknowledgement required | IRSA `COM_CMB_IQU-smica_2048_R3.00_full.fits` (2.0 GB; HEALPix 2048 averaged to 512) | linear, ±300 µK | `cmb-planck.jpg` 687 |
| `map-dust-100um` | IRAS 100 µm, 4.3′ | IRIS, Miville-Deschênes M.-A., Lagache G. 2005, ApJS 157, 302 | LAMBDA: public, citation requested | LAMBDA `IRIS_nohole_4_1024_v2.fits` (averaged to 512) | log, 0.6 → 1500 MJy/sr | `dust-100um.jpg` 156 |
| `map-near-ir` | 1.25 / 2.2 / 3.5 µm as blue / green / red, 0.7° | COBE DIRBE Zodi-Subtracted Mission Average, Hauser M.G. et al. 1998, ApJ 508, 25 | NASA, public domain | LAMBDA `DIRBE_BAND{1A,2A,3A}_ZSMA.FITS` (COBE sky cube, resolution 9) | asinh per band | `near-ir.jpg` 183 |
| `map-h-alpha` | Hα, 6′ | Finkbeiner D.P. 2003, ApJS 146, 407 (WHAM, VTSS, SHASSA) | LAMBDA: public, citation requested; the surveys ask for NSF acknowledgement | LAMBDA `lambda_halpha_fwhm06_0512.fits` | asinh, 0.3 → 500 R | `h-alpha.jpg` 171 |
| `map-xray-rosat` | Diffuse X-rays: R1+R2 (¼ keV) red, R4+R5 (¾ keV) green, R6+R7 (1.5 keV) blue, point sources removed, 12′ pixels | Snowden S.L. et al. 1997, ApJ 485, 125 (MPE) | **"permitted for scientific purposes as long as reference is made"** (see notes) | NASA SkyView surveys `RASSBCK1…7`, resampled to this layout | asinh per band from its 20th to 99.7th percentile | `xray-rosat.jpg` 330 |
| `map-gamma-fermi` | Gamma-ray intensity, 1-3 + 3-300 GeV, 2008-12 | Fermi LAT instrument team, NASA GSFC | public domain (SkyView's survey record) | NASA SkyView surveys `Fermi 4`, `Fermi 5` | log from the median to the 99.9th percentile | `gamma-fermi.jpg` 146 |
| `map-galaxies-2mass` | Surface density of the 546,973 galaxies with Ks < 13.5, smoothed to 1° | 2MASS Extended Source Catalog, Jarrett T.H. et al. 2000, AJ 119, 2498; Skrutskie M.F. et al. 2006, AJ 131, 1163 | public; acknowledgement text requested | IRSA TAP `fp_xsc` (glon, glat, k_m_k20fe) | asinh, 4 → 250 per square degree | `galaxies-2mass.jpg` 211 |

Total: 2,716,978 bytes in 12 files.

Attribution strings are those in `app/src/layers/sky-maps/specs.ts`
(the in-app credits), which carry the acknowledgement sentences Planck
and 2MASS ask for.

## What was verified, and how

### Catalogues (`tools/pipeline/test_deepsky.py`, 344 checks)

Known objects against their usual J2000 positions (SIMBAD's), which are
independent of the X-ray, gamma-ray and radio catalogues baked. Baked
positions are rounded to 0.001° (0.06′), so 0.00′ means "the same to
that rounding":

| Object | Catalogue | Offset found |
| --- | --- | --- |
| M31 (10.6847, +41.2687) | OpenNGC, Karachentsev | 0.02′; outline 177.8′ × 69.7′ at 35° |
| Crab (83.633, +22.014) | OpenNGC, BAT, 4U, ATNF, 4FGL, Green | 0.00′, 0.19′, 0.22′, 0.00′, 0.23′, 0.29′ |
| Sco X-1 (244.979, −15.640) | BAT, 4U, Liu | 0.00′, 1.12′ (inside the 4U error box), 0.00′ |
| Cyg X-1 (299.590, +35.202) | BAT, 4U, Liu | 0.06′, 1.42′, 0.00′ |
| Sgr A\* (266.417, −29.008) | SIMBAD | 0.00′ |
| 3C 273 (187.278, +2.052) | Véron, BAT, 4FGL | 0.00′, 0.31′, within 3′ |
| Vela pulsar (128.836, −45.176) | ATNF, 4FGL | 0.00′, 0.13′; the brightest 4FGL source |
| Coma cluster (194.95, +27.98) | Abell (precessed here) | 0.17′ |
| M87 (187.706, +12.391) | OpenNGC, Véron, SIMBAD | 0.00′ each |

Also checked: all Messier numbers 1-110 but 102 are present and
labelled; object classes (M57 planetary, M13 globular, Sco X-1 low-mass,
Cyg X-1 high-mass, B1937+21 millisecond, SGR 1806−20 magnetar); the
Crab's 33 ms period; the fastest pulsar found from the data (PSR
J1748−2446ad, 716 Hz); TRAPPIST-1's 7 and Kepler-90's 8 planets; a third
of all exoplanet hosts (1,993 of 4,857) within 8° of the Kepler field centre; Proxima
nearest at 4.25 ly; Barnard's Star and Sirius at their 2026 places
within 1.5″ (proper motion applied); M31 at 0.77 Mpc and M81 at 3.6 Mpc;
globulars crowd the Galactic centre (Shapley's argument); 9 in 10
supernova remnants within 5° of the plane; the CMB dipole and solar apex
at their published galactic coordinates; Voyager 1 in Ophiuchus and
Voyager 2 in Pavo.

**B1950 → J2000.** `sky_catalog_support.b1950_to_j2000` (FK4 → FK5 with
the E-terms removed) reproduces astropy's FK4→FK5 transform to 0.00002″
on two test positions. HEASARC serves J2000 for every table. For Abell
its J2000 columns turned out to be the catalogue's printed J2000 values,
whose declinations are cut (not rounded) to the arcminute: 30″ too near
the equator on average, in both hemispheres. The pipeline therefore
precesses Abell's B1950 columns itself; right ascension agrees with
HEASARC's to −0.3″ on average over 5,250 clusters. For 4U the HEASARC
J2000 positions are used and checked against Sco X-1, Cyg X-1 and the
Crab (all inside the catalogue's error boxes).

**Large-scale structure (2MRS).** The Zone of Avoidance is empty (under
0.2% of galaxies within 5° of the plane, which is 8.7% of the sky); half
of the galaxies nearer than cz 3000 km/s lie within 20° of the
supergalactic plane (34% of the sky); 206 galaxies within 6° of M87
against 6 at the antipode; the Coma cluster at cz 6000-8000 (118 within
3°); the Perseus cluster (202 within 4° at cz 4000-6500).

### Maps (`tools/pipeline/test_skymaps.py`, 76 checks)

A mirrored or shifted map still looks like the sky, so each image is
tested for features that are not symmetric: a known object must be
brighter at its galactic coordinates than at the mirrored longitude
(l → 360° − l).

| Map | Features checked (brightness at the place / at the mirrored place) |
| --- | --- |
| `radio-408` | Galactic centre brightest; Cassiopeia A (0.88 / 0.13); Cygnus A; North Polar Spur at l = 30°, b = 40° (0.21 / 0.12); LMC |
| `hi-21cm` | LMC (0.46 / 0.23); SMC (0.48 / 0.26) |
| `dust-100um` | LMC; SMC; Orion Nebula (0.60 / 0.18) |
| `near-ir` | brightest patch within 2° of the Galactic centre; LMC (0.14 / 0.02); thin disc; symmetric bulge |
| `h-alpha` | Orion Nebula (0.66 / 0.16); Barnard's Loop; the ζ Oph nebula; LMC |
| `gamma-fermi` | Vela pulsar (0.95 / 0.32); Crab (0.82 / 0.26); Geminga; 3C 454.3 (0.66 / 0.00); LMC |
| `xray-rosat` | Vela remnant (0.98 / 0.27); LMC (0.57 / 0.22); North Polar Spur at ¾ keV (0.50 / 0.27); the plane in shadow at ¼ keV (0.18 against 0.61 at b = 50°) |
| `galaxies-2mass` | Virgo; Perseus (0.38 / 0.02); Shapley; empty toward the Galactic centre |
| `cmb-cobe`, `cmb-wmap`, `cmb-planck` | colours recomputed from the source HEALPix map at some 17,000 random pixels off the plane: mean error 0.003 / 0.016 / 0.066 (JPEG loss), against 0.16 / 0.19 / 0.27 for the mirrored lookup; the Cold Spot at (209°, −57°) is blue in WMAP and Planck; the Milky Way is a hot band in COBE |
| CMB, across missions | at 10° and \|b\| > 30°, COBE correlates with WMAP at r = 0.78, Planck with WMAP at r = 0.986 |
| `cmb-dipole` | dipole fitted to the baked data: 3337 µK toward (264.4°, +48.2°), 0.24° from Planck's direction (Planck: 3362 µK) |

**COBE's sky cube.** DIRBE and the archived DMR maps are in COBE's
quadrilateralized spherical cube. `quadcube_vectors` (pixel number →
ecliptic direction; the cube's curvature comes from WCSLIB's CSC
projection through astropy) is checked against the coordinates COBE's
own DMR tables carry for all 6,144 resolution-6 pixels: worst
disagreement 0.6″ (ecliptic), 2.4″ after rotating to galactic.

**Exoplanet candidates** (added 2026-11-11) are checked against where
each mission looked, which is known apart from the archive: all 1,977
Kepler candidates within 8° of the Kepler field's centre; every K2
candidate within 15° of the ecliptic (the furthest 8.9°), the only
direction K2 could hold after its reaction wheels failed; TESS's in both
hemispheres (2,532 of 5,181 stars north). Counts per mission match the
archive's own totals. 473 candidate stars also have confirmed planets (the
two layers overlap there, as they should); 44 stars carry candidates from
two missions (37 TESS–K2, 7 TESS–Kepler), which may be the same signal
seen twice: not merged, so the total may count a few dozen twice.
Candidates are not planets, and many will be ruled out: of the TOIs
already settled, 1,417 were false (FP, FA) and 1,425 confirmed (CP, KP);
of the KOIs, 4,839 false positives and 2,748 confirmed (archive counts,
2026-11-11, which also include signals rejected before they were ever
candidates). The caption says "not yet confirmed or ruled out".

### In the app

Vitest (`app/src/layers/deep-sky/catalog.test.ts`,
`app/src/layers/sky-maps/sky-maps.test.ts`): outlines are ellipses of
the given angular size with the major axis turned from north through
east (M31's tips fall to the north-east and south-west); every class in
every baked file has a style; the Andromeda galaxy is in the baked file
with its label and outline; a map's texture is freed when switched off,
reloaded when switched on, and a late image is dropped.

Screenshots (`~/review-loop/shots/deep-sky/`): each map with the stars
and the sky grid on - the map's Galactic plane lies on the grid's
galactic-plane line and its bulge on the "Galactic centre" label in
Sagittarius.

## Notes: unverified, approximate, or licence-sensitive

- **OpenNGC is CC BY-SA 4.0** (share-alike). `dso.json` is a derived
  database and is therefore itself CC BY-SA 4.0; it is a separate data
  file, credited in the app. Needs the owner's decision if the project's
  data must stay under a more permissive licence; the alternative is to
  rebuild from NGC 2000.0 (Sky Publishing: research use only, worse) or
  from HyperLEDA and SIMBAD directly.
- **ROSAT diffuse maps**: "Use of this map is permitted for scientific
  purposes as long as reference is made to" Snowden et al. 1997. A
  public, non-commercial educational app is arguably within that, but it
  is not an open licence. Needs the owner's decision; removing
  `map-xray-rosat` from `sky-maps/specs.ts` and the JPEG is all it takes.
- **Planck** maps are public; ESA asks for the acknowledgement sentence,
  which the credit carries. **2MASS**, the **NASA Exoplanet Archive**,
  **SIMBAD/VizieR** and the **ATNF catalogue** likewise ask for
  acknowledgement, not permission.
- **Names of famous objects** (`FAMOUS_PULSARS`, `FAMOUS_HOSTS`,
  `FAMOUS_CLUSTERS`, `FAMOUS_QUASARS`, the landmark labels) are the
  names in common use, attached by hand to catalogue designations; the
  positions and numbers always come from the catalogue. Descriptions
  such as "first pulsar found" or "first black hole imaged" are common
  knowledge written by hand, not read from a source.
- **M102** is not drawn: OpenNGC takes it for a duplicate observation of
  M101 (and notes NGC 5866 "may be M102").
- **Outlines without an orientation**: where OpenNGC has no position
  angle but unequal axes, the circle of the major axis is drawn.
  Supernova remnants (Green gives no orientation) are circles of their
  mean diameter; nearby galaxies are circles of the Holmberg diameter;
  globulars are circles of the half-light radius. The captions say so.
- **4FGL class `GC`** (the Galactic centre source itself) is shown among
  the unidentified; lower-case 4FGL classes (associations, not firm
  identifications) are drawn like the firm ones.
- **Swift-BAT calls Cen A, 3C 273 and NGC 1275 "Beamed AGN"**; the layer
  follows the catalogue.
- **ROSAT sources**: Sco X-1 is absent from the Bright Source Catalogue
  (too bright for the survey's detector).
- **2MRS velocities** of the few approaching galaxies are stored as 0.
- **2MASS galaxy density** shows false counts along the outer Galactic
  plane (Galactic sources classed as extended), as the catalogue has
  them; the caption says so.
- **Planck SMICA** shows a faint seam along the Galactic plane (the
  component separation's residual), as the source map has it.
- **COBE**: the map shown is the 53 GHz (A+B)/2 sum map alone, not the
  team's 53+90 GHz weighted combination; the 4-year HEALPix files and
  the sky-cube files both have a nominal dipole removed, and
  `map-cmb-dipole` restores it from the header as documented there.
- **Fermi and ROSAT maps were resampled by NASA SkyView** (Clip
  sampler) from its own copies; their orientation is tested, their
  photometry is not compared with the original event data. The Fermi
  map is SkyView's 2008-12 product, not the full mission.
- **The CMB maps use different full scales** (COBE ±200 µK, WMAP and
  Planck ±300 µK): at one scale COBE's 10° map would be nearly black.
  The captions give each range.
- **Not built**: true-scale image billboards of showpiece objects
  (M31, M42, the Magellanic Clouds…) - no cut-out service with clear
  terms was verified for scale and orientation, so none is faked;
  eROSITA, MAXI, HEAO-1 and Swift-BAT all-sky images; Planck dust, CO
  and lensing maps (the Commander files are downloaded but not baked);
  SFD extinction, WISE, AKARI, GALEX; Gaia star density (the Milky Way
  layer is that); variable stars, novae, gamma-ray bursts; MCXC X-ray
  clusters; the Million Quasars catalogue; Local Group dwarfs found
  after 2013 (the Karachentsev catalogue predates them); Gaia BH1
  (SIMBAD's mirror did not resolve the name).
- **A 404 in the browser console** on every page load predates this
  slice (it appears with only `stars` on).
