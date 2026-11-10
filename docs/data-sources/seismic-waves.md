# Seismic wave playback: data sources and verification

What the "Seismic waves" layer plays, where its numbers come from and what
was checked. Measured on 2026-11-10 (UTC). The agent that built this was cut
off by a usage limit just before its final test run and report; the
coordinator ran the checks, looked at the result and wrote this document, so
it is shorter than the others and lists plainly what was not looked at.

## Datasets shipped

| Layer | What | Source and citation | Licence | URL | Baked or live | Attribution string |
| --- | --- | --- | --- | --- | --- | --- |
| Seismic waves (`seismic-waves`, lazy, off by default) | Ray paths and travel times of P and S waves (including the core phases PKP and PKIKP) for a fan of take-off angles from several source depths, in the ak135 radial Earth model | Kennett, B.L.N., Engdahl, E.R. & Buland, R. (1995), Constraints on seismic velocities in the Earth from traveltimes, Geophys. J. Int. 122, 108–124; rays traced with ObsPy TauP (Crotwell, Owens & Ritsema 1999) | No stated licence: a published model, cited. ObsPy (LGPL-3.0) is used offline in the pipeline only; none of it ships | https://rses.anu.edu.au/seismology/ak135/intro.html | Baked: `tools/pipeline/generate_seismic_waves.py` → `app/public/geo/seismic-waves.bin` (1.35 MB) and `.json` (4 kB) | ak135, Kennett, Engdahl & Buland (1995) |
| Seismic waves: surface-wave rings | Group speeds: Rayleigh 3.72 km/s, Love 4.38 km/s | Dziewonski, A.M. & Anderson, D.L. (1981), Preliminary Reference Earth Model, Phys. Earth Planet. Inter. 25, 297–356, Table V | Two published figures, cited | https://doi.org/10.1016/0031-9201(81)90046-7 | Constants in the bake | PREM, Dziewonski & Anderson (1981) |
| Seismic waves: the earthquakes played | Hypocentres and origin times of the presets and deep events; the latest M6+ from the live feed the recent-earthquakes layer already loads | USGS ComCat and real-time feeds; the Valdivia 1960 hypocentre is ISC-GEM's | Public domain; ISC-GEM is CC BY-SA 3.0 | https://earthquake.usgs.gov/data/comcat/ ; https://doi.org/10.31905/D808B825 | As audited in `earthquakes.md` | USGS; ISC-GEM |

## What is shown and what is not

- **Shown:** the P wavefront (through the mantle and, as PKP and PKIKP,
  through the core) and the S wavefront, each as the surface the wave has
  reached at the playback time, built by turning the baked rays about the
  source axis; S ends at the core–mantle boundary (the outer core is liquid),
  which leaves its shadow; Love and Rayleigh rings on the surface; a readout
  of when each phase reaches the user's position and the antipode.
- **Not traced:** reflections (PP, PcP, ScS, pP…), conversions (SKS, PS…),
  the reflection off the inner core (PKiKP), diffraction round the core
  (Pdiff and Sdiff are kept as arrival times only).
- **Approximations**, also in the layer's caption: a radially symmetric
  Earth (no 3-D structure, no ellipticity); a point source; no amplitudes,
  attenuation or radiation pattern — the fronts show where the wave is, not
  how strong; surface-wave rings move at one group speed each and are
  approximate. Playback time is its own clock, independent of the app clock.

## What was verified

`tools/pipeline/test_seismic_waves.py` (90 checks, all passing; needs the
pipeline venv with ObsPy):

- **Against published ak135 tables** (Kennett's summary tables, surface
  focus), not only against the library that made the bake:

  | Phase, distance | Baked (s) | Published (s) |
  | --- | --- | --- |
  | P, 30° | 370.21 | 370.27 |
  | P, 60° | 608.29 | 608.34 |
  | P, 90° | 781.36 | 781.40 |
  | S, 30° | 668.97 | 669.14 |
  | S, 60° | 1101.78 | 1101.89 |
  | S, 90° | 1435.40 | 1435.44 |
  | PKIKP, 160° | 1201.05 | 1201.11 |
  | PKIKP, 180° | 1212.49 | 1212.53 |
  | PKP, 170° | 1284.65 | 1284.67 |

- **Against an independent integral**: PKIKP straight through the centre,
  integrating dr/v through the published model table, gives 1212.48 s
  against the baked 1212.49 s.
- The remaining checks cover deep sources, shadow edges and the geometry of
  the stored rays (see the script).

App tests (in `app/src/layers/seismic-waves/`): the decoder, arrival times at
arbitrary points against a TauP fixture, the mesh builder, the control and
the readout wording.

The spec's acceptance test (spec/seismic.md): for Tōhoku 2011 (29 km deep)
the readout gives the antipode's first arrival, PKIKP, at 20 min 07 s, and
"no S (core shadow)" there; from Austin, 91.5° away, P at 13 min 03 s and S
at 24 min 00 s.

By eye (`~/review-loop/shots/seismic-waves/`, four shots taken by the
coordinator with `?quake=tohoku2011&t=<seconds>`): at 6 minutes the P and S
fronts are expanding shells around Japan with rings where they meet the
surface; at 10 minutes on a phone the S shell, the larger P front and the
surface-wave rings are distinct over the default layers; at 21 minutes the
core phases have crossed the planet. Frame time 16.7–16.8 ms at 1280×800 and
at 412×892 (pixel ratio 2) on Intel Iris Xe, with playback paused.

## Notes and gaps

- **Not looked at by anyone:** playback while running (frame time during
  animation), events other than Tōhoku, a deep-focus event, a quake near the
  user, the Cardboard stereo view, reduced-motion behaviour, the "latest
  M6+" entry, and whether the control and the deep-time control overlap when
  both layers are on.
- The control covers roughly the lower quarter of a phone screen.
- `seismic-waves.bin` is 1.35 MB, loaded only when the layer is switched on.
- Removed with this slice, as the earlier audit recommended: the unwired
  constant-velocity `app/src/render/seismic/wavefronts.ts` and the
  direct-P/S-only `generate_traveltime.py` texture, which could not show an
  arrival beyond about 98°.
