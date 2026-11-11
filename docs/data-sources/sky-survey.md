# Sky surveys as pictures: data sources and verification

What the seven `survey-*` layers draw, where it comes from and what was
checked. Numbers are as measured on 2026-11-10 (UTC).

Before this the app's deep sky was outlines and markers over a 2048-pixel
Milky Way: Andromeda was an ellipse. These layers draw real survey images,
fetched as HiPS tiles for just the patch in view, down to each survey's own
resolution.

## Datasets shown (all fetched live; nothing is baked or redistributed)

| Layer | What | Source and citation | Licence / terms | Tile URL | Attribution string |
| --- | --- | --- | --- | --- | --- |
| Photographed sky (`survey-dss`) | Digitized Sky Survey 2, red and blue plates as colour, whole sky, to ~0.8″/pixel (order 9) | Palomar (POSS-II) and UK Schmidt plates digitised at STScI under NASA grant NAG W-2166; Lasker et al. 1996, ASP Conf. 101:88; coloured and cut into HiPS by CDS (Oberto, Fernique) | **Copyright of the plate-owning institutions** (AURA/STScI, Caltech, AAO, ROE, …); STScI's terms allow use with acknowledgement — https://archive.stsci.edu/dss/copyright.html. **Not re-read line by line; for Andy to confirm.** | `https://cdn.skies.esac.esa.int/DSSColor` (mirror: CDS `alasky.cds.unistra.fr/DSS/DSSColor`) | Digitized Sky Survey — STScI/NASA; coloured and healpixed by CDS |
| Near-infrared sky (`survey-2mass`) | 2MASS J, H, K as blue, green, red, whole sky, order 9 | Skrutskie et al. 2006, AJ 131:1163; University of Massachusetts and IPAC/Caltech, funded by NASA and NSF | Survey data public domain with acknowledgement; the HiPS itself is marked `hips_license = ODbL-1.0`, copyright CNRS/Unistra (in the IRSA copy of its properties file) | `https://cdn.skies.esac.esa.int/2MASSColor` (mirror: CDS) | 2MASS — UMass & IPAC/Caltech; HiPS by CDS |
| Mid-infrared sky (`survey-wise`) | AllWISE W1, W2, W4 as blue, green, red, whole sky, order 8 | Wright et al. 2010, AJ 140:1868; UCLA and JPL/Caltech, funded by NASA | Public domain with acknowledgement | `https://cdn.skies.esac.esa.int/AllWISEColor` (mirror: CDS) | WISE — UCLA & JPL/Caltech, NASA; HiPS by CDS |
| Hard X-ray sky (`survey-xray-bat`) | Swift-BAT 70-month survey image, 14–24 / 24–50 / 50–194 keV as red, green, blue, whole sky, order 6 | Baumgartner et al. 2013, ApJS 207:19; Swift-BAT team, NASA GSFC | `hips_copyright = public`; acknowledgement requested | `https://cdn.skies.esac.esa.int/swift_bat_flux` | Swift-BAT team |
| X-ray pictures (`survey-xray-xmm`) | XMM-Newton EPIC images, colour composition, the 13% of the sky XMM has pointed at, order 7 | ESA XMM-Newton Science Archive, ESAC Science Data Centre | The properties file states no licence; ESA's usual terms are free use with credit "ESA/XMM-Newton". **Assumed, not stated — for Andy.** | `https://esdchips.esac.esa.int/XMM-Newton/EPIC-RGB` | ESA/XMM-Newton |
| Webb close-ups (`survey-jwst`) | JWST NIRCam images, every public field since the 2022 Early Release Observations, about 1.5–2.4 deg² in all (0.006% of the sky or less), drawn to its own order 15 | NASA/ESA/CSA JWST; original data from the European JWST Archive (eJWST) at ESA/ESAC | The properties file states **no licence and no copyright**; the archive data are public after their proprietary period and the eJWST acknowledgement is given. **Assumed, not stated — for Andy.** | `https://cdn.skies.esac.esa.int/JWST/NIRCam_Imaging` | Original data from the European JWST Archive (eJWST) at ESA/ESAC |
| Euclid deep fields (`survey-euclid`) | Euclid VIS + NISP colour mosaics: Quick Release 1 deep fields South (56.0 deg²), Fornax (30.0), North (46.7), March 2025, and the Galactic bulge outreach field (5.2 deg², April 2026); drawn to order 11 | ESA Euclid mission and Euclid Consortium, Euclid Science Archive at ESAC; bulge HiPS by J.-C. Cuillandre (U. Hawaii) and J. Espinosa (Starion for ESA) | The three deep-field properties files state **no licence and no copyright**; the bulge field's states copyright ESA. Public release data; credit ESA/Euclid/Euclid Consortium. **Assumed, not stated — for Andy.** | `https://cdn.skies.esac.esa.int/Q1-EDF{S,F,N}-R4-PNG-RGB_HIPS`, `https://esdchips.esac.esa.int/EuclidOutreach/Q2-EGBS-PNG-RGB_HIPS` | ESA/Euclid/Euclid Consortium |
| All seven | Tile service | ESASky HiPS node, ESAC Science Data Centre, ESA; HiPS: Fernique et al. 2015, A&A 578:A114 | Public service; its hipslist asks that HiPS not be **mirrored** without the owner's agreement — the app mirrors nothing, it links | https://sky.esa.int/ | ESASky / ESAC |

Every tile host answers cross-origin requests with
`Access-Control-Allow-Origin: *` (checked with an `Origin` header on a tile
of each). No key, no sign-up. One trap: `skies.esac.esa.int` sends the
header with a tile but not with a 404, so in a browser an empty tile there
reads as a network failure (seen as CORS errors in the app); the Webb layer
uses the CDN host `cdn.skies.esac.esa.int`, which sends it with both.

Baked for the Webb and Euclid layers: `app/public/sky/closeups.json` (8 kB),
each survey's coverage map (`Moc.fits`, IVOA MOC 1.1; Webb's 68,484 cells to
order 15) coarsened to the order-8 cells (13.7′) that hold any of it, by
`tools/pipeline/generate_closeup_coverage.py`. Coarsening only adds sky:
30 deg² of cells for Webb's 2.37 deg², 6–10% more for Euclid's fields. The
app asks each field's server only for tiles touching its cells; Webb's
cells are ringed from a wide view (Euclid's fields are degrees across and
show without). The four Euclid fields are four HiPS on two hosts: one
switch runs a survey per field and merges their status chips.

Webb's properties file states `moc_sky_fraction = 1.025E-5` (0.42 deg²), but
its `Moc.fits`, written the same minute, sums to 2.37 deg²; the same sum
agrees to 0.1% with all four Euclid files' stated fractions. Checked against
the tiles themselves (2026-11-11): 20 order-8 cells drawn at random from the
coverage all had a tile with data, covering 5% of each on average — about
1.5 deg² over the 30 deg² of cells, so the true area lies between the two
figures and well above the stated one. A MOC is drawn a little generously
by design; the app uses it to choose which tiles to ask for, where erring
generous costs only a few 404s. The stated fraction is taken as stale.

Euclid's tiles are heavy: 0.4–0.6 MB of PNG each (Webb's 2–140 kB). A narrow
view needs 5–25, so up to about 10 MB per screenful; the layer is off by
default and fetches only inside its fields.

Hubble: ESA's HST/ACS survey (24.6 deg², to 2015) was tried and left out.
Its tiles are negatives — white sky, black stars — crossed by satellite
trails and chip gaps; drawn as added light they would wash the sky white,
and inverting them would still leave the trails. (The first Euclid tiles
sampled looked empty because they were outside the fields: picked from the
HiPS's initial view position, not its coverage.)

Looked at and left out: Gaia DR3 colour map (CC BY-NC 3.0 IGO, and 730 kB
per tile); SDSS (36% of the sky); Fermi, H-alpha,
HI, IRAS (the app already bakes all-sky maps of these). NASA/IPAC's own
node serves 2MASS but did not send the cross-origin header.

## How it works, and what that means for truth

- **Geometry is HEALPix**, implemented in `packages/core/src/astro/healpix.ts`
  and held to `healpy` (the reference library): centres and corners of 74
  pixels over five orders to 1e-9 rad, the pixel holding 40 directions at
  every order, discs against `query_disc`.
- **Which way up a tile is** was not taken from memory of the standard: of
  the eight ways an image can lie on its pixel, seven still look like sky.
  `tools/pipeline/test_hips_orientation.py` puts the app's own star
  catalogue on four real tiles each of DSS and 2MASS all eight ways; the
  stars fall on bright pixels for one layout only (e.g. level 68 against 13
  for the next best), and that is the one the app uses.
- **In the running app**, with the deep-sky catalogue switched on over DSS,
  M31's picture fills the catalogue's ellipse, M32 and M110 sit on their
  markers; the Swift-BAT dots sit under the BAT catalogue's rings.
- **Colours are the surveys' own composites**, not what an eye would see.
  The app subtracts a floor (the level taken as empty sky) and stretches
  what is above it, per survey — drawing choices, in `surveys.ts`.
- **Artefacts are the surveys'**: plate edges and bright-star halos in DSS,
  green scan stripes in 2MASS, mosaic steps along the galactic plane in
  WISE at wide fields, noise in BAT below the floor. None is added here.
- **The light is added to the sky**, as for the all-sky maps, so below the
  horizon it shows through the planet, dimmed; over the bright surface it
  is effectively invisible. Only one whole-sky picture is on at a time
  (the five whole-sky surveys and the twelve baked maps share an exclusive
  group). Webb's and Euclid's close-ups are outside that group and add
  over whichever is on.
- **Euclid's stretch** is floor 0.06, gain 1.3: its mosaics' empty sky sits
  at about 15 of 255 (median of three tiles inside EDF South).
- **Webb's stretch** is gain 2, floor 0: its fields are dark with small
  galaxies, and at the scales most views reach (order 9–10 at 0.2°) most
  are a few pixels. The same patch was compared at orders 9 and 12: same
  mean level (11.6 and 12.9 of 255, correlation 0.95), so the coarse tiles
  are not darkened by the HiPS build; the faintness is the sky's.

## Loading, caching, failure

- The order is chosen so a tile's 512 pixels are stretched at most 1.25×:
  the whole sky in 12–48 tiles at a 60° field, order 7 at 1°, order 9 (the
  deepest DSS and 2MASS have, about an arcsecond a pixel) at the narrowest
  field DSS needs, 0.2°. The zoom limit was 1° before these layers, then
  0.2° (M51 at 0.3° and M57 at 0.2° looked at); it is now 0.003° (11″), so
  Webb's own order 15 (about 0.03″ a pixel) and Euclid's order 12 are
  reached on a phone-height screen. Below 0.2° the whole-sky surveys are
  only stretched. A screen needs
  5–25 tiles; at most 40 are drawn and 56 kept (about 56 MB of texture at
  the cap, a megabyte each, no mipmaps).
- Six requests at a time, nearest the centre of view first; requests for
  tiles that have left the view are aborted. While a tile loads, the part
  of a coarser one already held stands in.
- A 404 is "the survey has nothing here" and is not retried. Any other
  failure is retried after 30 s; after four in a row the next server on the
  survey's list is tried once round; if none answers the chip beside the
  switch reads **no connection** and nothing more is asked until the 30 s
  are up. Checked by blocking both hosts in a headless browser: 19 requests
  in total, chip "no connection" at 5 s and still at 15 s, picture back
  within 36 s of unblocking.
- The browser's HTTP cache does the caching; tiles are static files.
- CDS's own servers (`alasky.cds.unistra.fr`) did not answer from the build
  machine on 2026-11-10; they are listed as the second server for the three
  surveys CDS made, untested from here.

## Verification summary

- Core: `healpix.test.ts`, 134 cases against healpy.
- App: `hips.test.ts` (13: URL layout, order choice, tile counts, ancestor
  windows), `surveys.test.ts` (17: every survey https, credited, off by
  default, Webb and Euclid outside the exclusive group with their fields),
  `coverage.test.ts` (13: cell decoding, coarser/finer tiles against the
  cells including pixel numbers past 2^31, cell centres against
  `healpixUnitToNested`, marker fade, merged status chips).
- Pipeline: `test_hips_orientation.py`, 16 checks on live tiles;
  `test_closeup_coverage.py`, 39 checks: cells sorted, in range, area
  bounds, each Euclid field's area against its stated sky fraction, the
  SMACS 0723 deep field, Stephan's Quintet, the Pillars of Creation and the
  centres of Euclid's three deep fields each inside a cell, placed with
  healpy.
- Webb looked at (`~/review-loop/shots/webb/`): SMACS 0723 from 40° (rings
  over DSS) to 0.2°, where both NIRCam modules and the lensing cluster show
  over the DSS stars, then at 0.03° (the cluster and its lensed arcs),
  0.01° and 0.003° (single faint galaxies at Webb's own pixel scale). Off-centre by about 90″ because the shot's aim was
  worked out by hand (precession, no aberration), not an app error.
- Euclid looked at (`~/review-loop/shots/euclid/`): EDF South at 8° (the
  footprint shows as a speckled field over DSS), 1° and 0.2° (colour
  galaxies, spiral arms resolved).
- Looked at (`~/review-loop/shots/sky-survey/`, 13 shots): M31 at 8° and 1°,
  Orion Nebula at 3° and on a phone-sized screen (390×844, 3×), a 60° field,
  the Galactic centre in DSS / 2MASS / WISE, BAT with its catalogue, XMM's
  fields round M31, looking down through the Earth. 16.6–16.8 ms a frame on
  the shared desktop GPU.

## Not done, not checked

- Not run on a phone or headset; texture memory at the cap is untested on a
  real device, and stereo was not looked at.
- The 0.003° zoom limit is for exploring on a desktop; on a phone's gyro
  such a narrow view will shake. Not tried on a device.
- Tile seams: none seen, but edges are clamped per tile, so a faint line is
  possible at high contrast.
- Surveys in galactic coordinates are supported in code (the group is
  turned) but none of the five uses it, so that path is **untested**.
- No offline copy: without a connection these layers show nothing.
