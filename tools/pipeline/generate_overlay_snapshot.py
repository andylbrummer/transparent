#!/usr/bin/env python3
"""
Bake the one Earth overlay that never changes, for when NASA GIBS cannot be reached.

Output
    app/public/geo/overlay-lightning.png   1024x512 equirectangular (lon -180..180, north up), GIBS's own colours,
                                           transparent where the instruments saw no lightning or did not look

Source
    Lightning flash rate climatology, 0.5 degree, from the Lightning Imaging Sensor on TRMM and the Optical
    Transient Detector on OrbView-1, combined: LIS/OTD 0.5 Degree High Resolution Full Climatology (HRFC)
    V2.3.2015, NASA Global Hydrometeorology Resource Center DAAC, doi:10.5067/LIS/LIS-OTD/DATA302. GIBS dates
    it 1995-05-04 for 6817 days, that is to the end of 2013. NASA data, free and open.
    Image by NASA GIBS, layer LIS_High_Resolution_Full_Climatology_Combined_Flash_Rate_Climatology:
    https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi

The app asks GIBS for the same layer at twice this size and falls back to
this copy (app/src/layers/earth-overlays/). The other overlays are dated
and have no baked copy: an old day shown as today's would mislead.

Usage:
    python3 tools/pipeline/generate_overlay_snapshot.py

Pillow. The download is cached in tools/pipeline/.cache/.
"""

from pathlib import Path

from PIL import Image

from fetch_cache import cached_fetch

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "app" / "public" / "geo" / "overlay-lightning.png"
LAYER = "LIS_High_Resolution_Full_Climatology_Combined_Flash_Rate_Climatology"
WIDTH = 1024
URL = (
    "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
    f"&LAYERS={LAYER}&STYLES=&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH={WIDTH}&HEIGHT={WIDTH // 2}"
    "&FORMAT=image/png&TRANSPARENT=true"
)


def main() -> None:
    image = Image.open(cached_fetch(URL, "overlay-lightning-1024.png")).convert("RGBA")
    if image.size != (WIDTH, WIDTH // 2):
        raise SystemExit(f"GIBS answered {image.size}, not {WIDTH}x{WIDTH // 2}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUT, optimize=True)
    print(f"{OUT.name} {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
