#!/usr/bin/env python3
"""
Content pipeline for Transparent Earth: mantle flow.

Writes app/public/geo/mantle-flow.json: the flow velocity of the mantle
on a few depth shells, from an instantaneous global flow model. It is a
model, not a measurement - nobody measures flow at 1500 km - so the app
labels it as one. The model:

    Solver: hc (Becker et al.; Hager & O'Connell 1981 semi-analytic flow
        in a radially layered viscous sphere), github.com/geodynamics/hc,
        GPL-2.0. Run here as a tool; none of its code ships with the app.
    Driving density: seismic tomography SEMUCB-WM1 (French & Romanowicz
        2014, GJI 199, 1303, doi:10.1093/gji/ggu334), as expanded in
        hc's tomography/ directory, converted to density with the
        depth-dependent scaling of Steinberger & Holme (2008).
    Viscosity: the radial profile of Steinberger & Holme (2008), JGR 113,
        B05403, doi:10.1029/2007JB005080 (hc's viscosity/visc.sh08).
    Surface: plates moving at their NNR-MORVEL56 velocities (Argus, Gordon
        & DeMets 2011), the same model as plate-motion.json, so the flow
        at the top meets the surface arrows.

Pipeline: plate velocities at the Gauss points sh_ana asks for -> sh_ana
expands them in spherical harmonics (degree 63) -> hc solves for flow ->
for each shell, hc_extract_sh_layer | sh_syn evaluates v_r and
(v_theta, v_phi) at an even Fibonacci grid of points.

Output (velocities in tenths of mm/yr = 0.1 km/Myr, integers):

    {source, quantumPerDegree, arrowMyr,
     shells: [{depthKm, lon[], lat[], east10[], north10[], up10[]}]}

Usage:
    python3 tools/pipeline/generate_mantle_flow.py --hc-dir HC --plates-dir DIR

HC is a checkout of github.com/geodynamics/hc at HC_COMMIT built with
`make all_no_gmt ADD_FLAGS=-DNO_GMT`, plus sh_ana, which that target
skips although it needs no GMT (see README.md for the two commands). DIR
is the platemotion data directory generate_plate_motion.py reads.
"""

import argparse
import math
import subprocess
import sys
import tempfile
from pathlib import Path

from generate_geo import OUTPUT_DIR, QUANTUM_PER_DEG, write_json
from generate_plate_motion import (SphericalPolygon, east_north_velocity, fibonacci_grid, load_sources,
                                   parse_outlines, parse_poles, unit)

HC_COMMIT = "7bb6d0385d88e25510f5e4646e835d8b018f2073"
TOMOGRAPHY = "tomography/semucb-wm1.31.m.ab"
DENSITY_SCALING = "dscale/dscale_sh08.dat"
VISCOSITY = "viscosity/visc.sh08"
# Degree of the plate velocity expansion; sh_ana needs 2**n - 1.
PLATE_LMAX = 63
# hc layer depths nearest these are kept: the asthenosphere the plates
# drag, the mid mantle, and the return flow just above D''.
SHELL_DEPTHS_KM = (300, 1450, 2750)
# ~6 degrees apart: sparse enough to read as a field at any depth.
POINTS_PER_SHELL = 1100
# Mantle flow is a few cm/yr; 5 Myr makes a 25 mm/yr arrow 125 km long.
ARROW_MYR = 5.0


def run(args: list, cwd: Path, stdin: str | None = None) -> str:
    result = subprocess.run([str(a) for a in args], cwd=cwd, input=stdin, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"{Path(args[0]).name} failed ({result.returncode}): {result.stderr.strip()[-2000:]}")
    return result.stdout


def check_hc(hc_dir: Path) -> None:
    head = subprocess.run(["git", "-C", str(hc_dir), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    if head != HC_COMMIT:
        raise RuntimeError(f"{hc_dir} is at {head or 'no git commit'}, expected hc {HC_COMMIT}")
    missing = [b for b in ("hc", "sh_ana", "sh_syn", "hc_extract_sh_layer") if not (hc_dir / "bin" / b).exists()]
    if missing:
        raise RuntimeError(f"build hc first (tools/pipeline/README.md); missing {missing}")


def plate_velocity_input(hc_dir: Path, work: Path, plates_dir: Path) -> str:
    """lon lat v_theta v_phi (cm/yr, theta pointing south) at sh_ana's sample points."""
    pole_text, outline_text = load_sources(plates_dir)
    poles = parse_poles(pole_text)
    polygons = {code: SphericalPolygon(ring) for code, ring in parse_outlines(outline_text).items()}
    lines = []
    for row in run([hc_dir / "bin" / "sh_ana", -PLATE_LMAX, 1], work).splitlines():
        lon, lat = (float(v) for v in row.split()[:2])
        p = unit(lon, lat)
        code = next((c for c, polygon in polygons.items() if polygon.contains(p)), None)
        if code is None:
            raise ValueError(f"no plate at sh_ana point {lon}, {lat}")
        east, north = east_north_velocity(poles[code]["omega"], lon, lat)
        lines.append(f"{lon:.7f} {lat:.7f} {-north / 10:.6f} {east / 10:.6f}")
    return "\n".join(lines) + "\n"


def solve_flow(hc_dir: Path, work: Path, plates_dir: Path) -> None:
    (work / "pvel.sh.dat").write_text(
        run([hc_dir / "bin" / "sh_ana", PLATE_LMAX, 1, 0, 0], work, plate_velocity_input(hc_dir, work, plates_dir)))
    run([hc_dir / "bin" / "hc", "-dens", hc_dir / TOMOGRAPHY, "-dshs", "-dsf", hc_dir / DENSITY_SCALING,
         "-vf", hc_dir / VISCOSITY, "-prem", hc_dir / "prem" / "prem.dat", "-pvel", work / "pvel.sh.dat"], work)


def layer_depths(hc_dir: Path, work: Path) -> dict[int, float]:
    """hc_extract_sh_layer's layer argument -> depth in km. Its listing
    numbers layers from 0 but the argument counts from 1."""
    rows = run([hc_dir / "bin" / "hc_extract_sh_layer", work / "vel.sol.bin", 1, 4], work).splitlines()
    return {int(index) + 1: float(depth) for index, depth in (row.split() for row in rows)}


def synthesize(hc_dir: Path, work: Path, layer: int, mode: int) -> list[list[float]]:
    """Rows of sh_syn output at the points in tmp.lonlat: mode 1 gives v_r, mode 2 v_theta v_phi."""
    expansion = run([hc_dir / "bin" / "hc_extract_sh_layer", work / "vel.sol.bin", layer, mode, 0], work)
    return [[float(v) for v in row.split()] for row in run([hc_dir / "bin" / "sh_syn", 0, 0, 999], work, expansion).splitlines()]


def build_shells(hc_dir: Path, work: Path) -> list[dict]:
    depths = layer_depths(hc_dir, work)
    shells = []
    for target in SHELL_DEPTHS_KM:
        layer = min(depths, key=lambda i: abs(depths[i] - target))
        if abs(depths[layer] - target) > 1:
            raise ValueError(f"hc has no layer at {target} km (nearest {depths[layer]})")
        grid = fibonacci_grid(POINTS_PER_SHELL)
        (work / "tmp.lonlat").write_text("".join(f"{lon:.6f} {lat:.6f}\n" for lon, lat in grid))
        radial = synthesize(hc_dir, work, layer, 1)
        horizontal = synthesize(hc_dir, work, layer, 2)
        if len(radial) != len(grid) or len(horizontal) != len(grid):
            raise ValueError(f"sh_syn returned {len(radial)}/{len(horizontal)} rows for {len(grid)} points")
        shell = {"depthKm": int(target), "lon": [], "lat": [], "east10": [], "north10": [], "up10": []}
        for (lon, lat), r, h in zip(grid, radial, horizontal):
            if abs(r[0] - lon) > 1e-3 or abs(r[1] - lat) > 1e-3:
                raise ValueError(f"sh_syn point order changed at {lon}, {lat}")
            # cm/yr -> 0.1 mm/yr; theta points south.
            shell["lon"].append(round(lon * QUANTUM_PER_DEG))
            shell["lat"].append(round(lat * QUANTUM_PER_DEG))
            shell["up10"].append(round(r[-1] * 100))
            shell["north10"].append(round(-h[-2] * 100))
            shell["east10"].append(round(h[-1] * 100))
        speeds = [math.hypot(e, n) / 10 for e, n in zip(shell["east10"], shell["north10"])]
        ups = [abs(u) / 10 for u in shell["up10"]]
        print(f"{target} km: horizontal mean {sum(speeds) / len(speeds):.1f} max {max(speeds):.1f} mm/yr, "
              f"radial max {max(ups):.1f} mm/yr", file=sys.stderr)
        shells.append(shell)
    return shells


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    parser.add_argument("--hc-dir", type=Path, required=True, help="built hc checkout at HC_COMMIT")
    parser.add_argument("--plates-dir", type=Path, help="platemotion data directory instead of fetching it")
    args = parser.parse_args()
    hc_dir = args.hc_dir.resolve()
    check_hc(hc_dir)
    with tempfile.TemporaryDirectory(prefix="hc-run-") as tmp:
        work = Path(tmp)
        solve_flow(hc_dir, work, args.plates_dir)
        shells = build_shells(hc_dir, work)
    write_json(OUTPUT_DIR / "mantle-flow.json", {
        "source": "Instantaneous flow model: hc (Hager & O'Connell 1981) driven by SEMUCB-WM1 tomography, "
                  "Steinberger & Holme (2008) viscosity and density scaling, NNR-MORVEL56 plates. "
                  "See ATTRIBUTION.md.",
        "quantumPerDegree": QUANTUM_PER_DEG,
        "arrowMyr": ARROW_MYR,
        "shells": shells,
    })


if __name__ == "__main__":
    main()
