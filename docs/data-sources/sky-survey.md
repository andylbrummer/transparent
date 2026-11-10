# Sky surveys as pictures: data sources and verification

What the five `survey-*` layers draw, where it comes from and what was
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
| All five | Tile service | ESASky HiPS node, ESAC Science Data Centre, ESA; HiPS: Fernique et al. 2015, A&A 578:A114 | Public service; its hipslist asks that HiPS not be **mirrored** without the owner's agreement — the app mirrors nothing, it links | https://sky.esa.int/ | ESASky / ESAC |

Every tile host answers cross-origin requests with
`Access-Control-Allow-Origin: *` (checked with an `Origin` header on a tile
of each). No key, no sign-up.

Looked at and left out: Gaia DR3 colour map (CC BY-NC 3.0 IGO, and 730 kB
per tile); Hubble and JWST mosaics (cover a ten-thousandth of the sky, so a
layer of their own would be black almost everywhere — worth doing as an
overlay on another survey, not built); SDSS (36% of the sky); Fermi, H-alpha,
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
  (these five and the twelve baked maps share an exclusive group).

## Loading, caching, failure

- The order is chosen so a tile's 512 pixels are stretched at most 1.25×:
  the whole sky in 12–48 tiles at a 60° field, order 7 at 1°, order 9 (the
  deepest DSS and 2MASS have, about an arcsecond a pixel) at the narrowest
  field, 0.2°. The zoom limit was 1° before these layers; it was lowered so
  their resolution can be reached (M51 at 0.3° and M57 at 0.2° looked at). A screen needs
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
  windows), `surveys.test.ts` (11: every survey https, credited, off by
  default).
- Pipeline: `test_hips_orientation.py`, 16 checks on live tiles.
- Looked at (`~/review-loop/shots/sky-survey/`, 13 shots): M31 at 8° and 1°,
  Orion Nebula at 3° and on a phone-sized screen (390×844, 3×), a 60° field,
  the Galactic centre in DSS / 2MASS / WISE, BAT with its catalogue, XMM's
  fields round M31, looking down through the Earth. 16.6–16.8 ms a frame on
  the shared desktop GPU.

## Not done, not checked

- Not run on a phone or headset; texture memory at the cap is untested on a
  real device, and stereo was not looked at.
- Tile seams: none seen, but edges are clamped per tile, so a faint line is
  possible at high contrast.
- Surveys in galactic coordinates are supported in code (the group is
  turned) but none of the five uses it, so that path is **untested**.
- No offline copy: without a connection these layers show nothing.
