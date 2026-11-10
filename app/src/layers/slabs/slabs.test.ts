import { describe, it, expect } from 'vitest';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { DEPTH_RAMP_GLSL } from '../../render/interior';
import slabs from './layer';
import type { SlabGrid } from './mesh';
import { SLAB_CONTOUR_KM, SLAB_FRAGMENT_SHADER, slabDepthLabels, slabNameLabels } from './slabs';

/** A slab of one row dipping east from 50 km, 50 km a node, all well inside its outline. */
function grid(name: string, vertexCount: number): SlabGrid {
  const columns = 12;
  return {
    entry: {
      code: name.slice(0, 3).toLowerCase(),
      name,
      lon0: 140,
      lat0: 38,
      stepDeg: 0.2,
      columns,
      rows: 1,
      runCount: 1,
      vertexCount,
      maxDepthKm: 50 + 50 * (columns - 1),
      label: { lon: 141, lat: 38, depthKm: 260 },
      offset: 0,
    },
    stored: new Uint8Array(columns).fill(1),
    depthKm: Float32Array.from({ length: columns }, (_, c) => 50 + 50 * c),
    thicknessKm: new Float32Array(columns).fill(90),
    edgeCells: new Float32Array(columns).fill(1.9),
  };
}

describe('the slab layer', () => {
  it('keeps the id of the contour lines it replaced, and stays on by default', () => {
    expect(slabs.id).toBe('slabs');
    expect(slabs.defaultOn).toBe(true);
    expect(slabs.section).toBe('Inside the Earth');
  });

  it('names what its contours mean in the caption', () => {
    expect(slabs.caption).toContain(`every ${SLAB_CONTOUR_KM.minor} km`);
    expect(slabs.caption).toContain(`every ${SLAB_CONTOUR_KM.major}`);
  });

  it('draws fine contours for a plate close by, and clears its underside there', () => {
    expect(SLAB_CONTOUR_KM.finest).toBeLessThan(SLAB_CONTOUR_KM.fine);
    expect(SLAB_CONTOUR_KM.fine).toBeLessThan(SLAB_CONTOUR_KM.minor);
    expect(SLAB_FRAGMENT_SHADER).toContain(`contour(vDepthKm, ${SLAB_CONTOUR_KM.finest.toFixed(1)}`);
    expect(SLAB_FRAGMENT_SHADER).toContain('if (presence <= 0.0 && (wall || bottom)) discard;');
  });

  it('colours by the shared depth ramp, written to the screen as the legend shows it', () => {
    expect(SLAB_FRAGMENT_SHADER).toContain(DEPTH_RAMP_GLSL);
    expect(SLAB_FRAGMENT_SHADER).toContain('depthRampSrgb(vDepthKm)');
    // The ramp is already display values: converting again would brighten every colour.
    expect(SLAB_FRAGMENT_SHADER).not.toContain('colorspace_fragment');
  });
});

describe('slab labels', () => {
  const grids = [grid('Cascadia', 1900), grid('South America', 13800)];

  it('names each slab on its plate, the bigger slab ranked first', () => {
    const labels = slabNameLabels(grids);
    expect(labels.map((l) => l.text)).toEqual(['Cascadia slab', 'South America slab']);
    expect(labels[1].priority).toBeLessThan(labels[0].priority);
    expect((EARTH_RADIUS_M - labels[0].position.length()) / 1000).toBeCloseTo(260, 3);
  });

  it('writes the depth on each bright contour', () => {
    const labels = slabDepthLabels(grids.slice(0, 1));
    // Nodes at 50, 100, ... 600 km: every second one is on a bright contour.
    expect(labels.map((l) => l.text)).toEqual(['100 km', '200 km', '300 km', '400 km', '500 km', '600 km']);
    expect((EARTH_RADIUS_M - labels[2].position.length()) / 1000).toBeCloseTo(300, 3);
  });
});
