# Platform Constraints (Quest 3S)

These device facts drive the whole design.

| Constraint | Consequence |
|---|---|
| No GPS hardware | Location comes from the companion phone app (primary), IP geolocation, or manual map entry. See [geospatial.md](geospatial.md), [companion-app.md](companion-app.md). |
| No magnetometer exposed to apps; no compass | True-north alignment via companion-phone compass transfer (primary), sun-assist, or manual calibration. |
| No active depth projector (unlike Quest 3) | Depth API still available (stereo/ML-derived) but noisier; floor-portal occlusion must rely on MRUK floor plane anchor, not per-pixel depth. |
| Passthrough is color but ~18 PPD, latency ~35 ms | Portal edge treatment should feather/glow rather than attempt razor-sharp compositing. |
| Snapdragon XR2 Gen 2, 8 GB RAM | Budget: ≤ 2 ms GPU for portal stencil pass, streaming imagery tiles kept ≤ 512 MB resident. |
| 1832×1920 per eye, Fresnel lenses | Fine text on the globe (labels) must use distance-scaled SDF text; avoid sub-pixel detail. |

## Performance budget (72 Hz ⇒ 13.8 ms)

| Item | Budget |
|---|---|
| Passthrough + portal stencil | 1.5 ms |
| Earth surface + interior shells (≤ 6 transparent layers, overdraw-capped by portal area) | 4.0 ms |
| Seismic wavefronts (≤ 8 events × 2 shells) | 2.0 ms |
| Weather (clouds + precip + 20 k wind particles) | 2.5 ms |
| UI + text | 1.0 ms |
| Headroom | 2.8 ms |

Techniques: portal-area scissoring (interior scene only rasterizes inside the
stencil), shell LOD (drop mantle sublayers when window small), tile mip
streaming, 16-bit HDR target OFF (LDR + dither is fine for this palette).

Memory: ≤ 512 MB streamed tiles, ≤ 300 MB baked textures (Blue Marble 8k×4k
BC7 + night + normals), travel-time texture 1024×512 R16G16B16 (~3 MB).

Vulkan, Application SpaceWarp OFF (transparent shells + ASW motion vectors
interact badly), fixed foveated rendering level 2 (portal center is where the
user looks — nadir — which is screen-center when looking down, comfortable
with FFR).
