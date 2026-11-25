import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SKY_RADIUS_M } from '../layers/types';
import type { LabelGroupSpec } from '../render/labels';
import { CAPTURE_DEG, DWELL_MS, FUSE_DELAY_MS } from '../ui/spyglass';
import type { Located, Target, TargetUnresolved } from '../view/actions';
import type { Hotspot } from './format';
import { createHotspotField, REFRESH_MS, TAP_DEG, type FieldHotspot, type HotspotSource } from './hotspot-field';

const CREDIT = { what: 'Diagram', source: 'USGS', licence: 'public domain', url: 'https://www.usgs.gov/' };

/** A hotspot whose anchor is a horizon target: the fake locate reads its azimuth as a direction in the x-y plane. */
const hotspot = (id: string, azDeg: number, layer?: string): Hotspot => ({
  id,
  title: `About ${id}`,
  anchor: { kind: 'horizon', azDeg, altDeg: 0 },
  ...(layer === undefined ? {} : { layer }),
  clip: { kind: 'image', src: `images/${id}.webp`, alt: id, caption: id, credit: CREDIT },
});

const source = (...hotspots: Hotspot[]): HotspotSource => ({ hotspots, fileUrl: (path) => `/g/${path}`, language: 'en' });

/** The unit vector `azDeg` round from +x toward +y. */
const toward = (azDeg: number): THREE.Vector3 => {
  const rad = THREE.MathUtils.degToRad(azDeg);
  return new THREE.Vector3(Math.cos(rad), Math.sin(rad), 0);
};

function field(options: { positioned?: boolean } = {}) {
  const groups: { spec: LabelGroupSpec; visible: boolean; removed: boolean }[] = [];
  const opened: FieldHotspot[] = [];
  const layersOn = new Set<string>();
  const world = { positioned: options.positioned ?? true, locates: 0 };
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(10, 0, 0);
  const locate = (target: Target): Located | TargetUnresolved => {
    world.locates++;
    if (!world.positioned || target.kind !== 'horizon') return { ok: false, code: 'target-unresolved', message: 'no position yet' };
    return { ok: true, direction: toward(target.azDeg), azDeg: target.azDeg, altDeg: 0, offCentreDeg: 0 };
  };
  const hotspots = createHotspotField({
    locate,
    camera,
    addLabels(spec) {
      const group = { spec, visible: true, removed: false };
      groups.push(group);
      return {
        setVisible: (visible) => (group.visible = visible),
        remove: () => (group.removed = true),
      };
    },
    isLayerOn: (id) => layersOn.has(id),
    open: (hit) => opened.push(hit),
  });
  return { hotspots, groups, opened, layersOn, world, camera };
}

describe('the hotspot field', () => {
  it('draws a marker for each hotspot, along its anchor at the sky’s distance', () => {
    const { hotspots, groups, camera } = field();
    hotspots.set('guide', source(hotspot('prem', 0), hotspot('waves', 90)));
    expect(groups.map((g) => g.spec.labels[0].text)).toEqual(['▶ About prem', '▶ About waves']);
    // Hidden until placed: a marker with no direction yet has nowhere to be.
    expect(groups.map((g) => g.visible)).toEqual([false, false]);
    hotspots.update(16);
    expect(groups.map((g) => g.visible)).toEqual([true, true]);
    const expected = camera.position.clone().addScaledVector(toward(90), SKY_RADIUS_M);
    expect(groups[1].spec.labels[0].position.distanceTo(expected)).toBeLessThan(1e-3);
  });

  it('finds anchors again only every so often', () => {
    const { hotspots, world } = field();
    hotspots.set('guide', source(hotspot('prem', 0)));
    hotspots.update(16);
    expect(world.locates).toBe(1);
    hotspots.update(REFRESH_MS - 16);
    expect(world.locates).toBe(1);
    hotspots.update(16);
    expect(world.locates).toBe(2);
  });

  it('keeps a marker hidden until its anchor resolves', () => {
    const { hotspots, groups, world } = field({ positioned: false });
    hotspots.set('guide', source(hotspot('prem', 0)));
    hotspots.update(16);
    expect(groups[0].visible).toBe(false);
    expect(hotspots.tap(toward(0))).toBe(false);
    world.positioned = true;
    hotspots.update(REFRESH_MS);
    expect(groups[0].visible).toBe(true);
  });

  it('shows a marker on a switch only while the switch is on', () => {
    const { hotspots, groups, layersOn } = field();
    hotspots.set('media', source(hotspot('prem', 0, 'shell-core')));
    hotspots.update(16);
    expect(groups[0].visible).toBe(false);
    expect(hotspots.nearest(toward(0), 1)).toBeNull();
    layersOn.add('shell-core');
    hotspots.update(16);
    expect(groups[0].visible).toBe(true);
    expect(hotspots.nearest(toward(0), 1)?.hotspot.id).toBe('prem');
  });

  it('lists only the markers shown, for a spoken title', () => {
    const { hotspots, layersOn } = field();
    hotspots.set('media', source(hotspot('prem', 0, 'shell-core'), hotspot('waves', 90)));
    hotspots.update(16);
    expect(hotspots.shown().map((hit) => hit.hotspot.id)).toEqual(['waves']);
    layersOn.add('shell-core');
    hotspots.update(16);
    expect(hotspots.shown().map((hit) => hit.hotspot.id)).toEqual(['prem', 'waves']);
  });

  it('replaces what a source showed, and takes it down with null', () => {
    const { hotspots, groups } = field();
    hotspots.set('guide', source(hotspot('a', 0)));
    hotspots.set('media', source(hotspot('m', 45)));
    hotspots.set('guide', source(hotspot('b', 90)));
    expect(groups.map((g) => [g.spec.labels[0].text, g.removed])).toEqual([
      ['▶ About a', true],
      ['▶ About m', false],
      ['▶ About b', false],
    ]);
    expect(hotspots.find('a')).toBeNull();
    expect(hotspots.find('b')?.source.fileUrl('x')).toBe('/g/x');
    hotspots.set('guide', null);
    expect(groups[2].removed).toBe(true);
    hotspots.dispose();
    expect(groups[1].removed).toBe(true);
  });

  it('opens the marker a tap is within 3° of, the nearest of two', () => {
    const { hotspots, opened } = field();
    hotspots.set('guide', source(hotspot('a', 0), hotspot('b', 2)));
    hotspots.update(16);
    expect(hotspots.tap(toward(-TAP_DEG - 0.5))).toBe(false);
    expect(hotspots.tap(toward(0.6))).toBe(true);
    expect(hotspots.tap(toward(1.6))).toBe(true);
    expect(opened.map((hit) => hit.hotspot.id)).toEqual(['a', 'b']);
  });

  describe('the stare', () => {
    /** Hold the gaze on `azDeg` for `ms` in frames of 20 ms; the last fuse. */
    const hold = (hotspots: ReturnType<typeof field>['hotspots'], azDeg: number, ms: number) => {
      let fuse = null;
      for (let t = 0; t < ms; t += 20) fuse = hotspots.dwell(toward(azDeg), 20);
      return fuse;
    };

    it('opens a marker held within CAPTURE_DEG for DWELL_MS, its ring filling from FUSE_DELAY_MS', () => {
      const { hotspots, opened } = field();
      hotspots.set('guide', source(hotspot('a', 0)));
      hotspots.update(16);
      expect(hold(hotspots, CAPTURE_DEG - 0.5, FUSE_DELAY_MS - 20)).toBeNull();
      const fuse = hold(hotspots, CAPTURE_DEG - 0.5, 200);
      expect(fuse?.fraction).toBeGreaterThan(0);
      expect(fuse?.fraction).toBeLessThan(1);
      expect(opened).toEqual([]);
      hold(hotspots, CAPTURE_DEG - 0.5, DWELL_MS);
      expect(opened.map((hit) => hit.hotspot.id)).toEqual(['a']);
    });

    it('does not open again until the gaze has left the marker', () => {
      const { hotspots, opened } = field();
      hotspots.set('guide', source(hotspot('a', 0)));
      hotspots.update(16);
      hold(hotspots, 0, DWELL_MS + 100);
      hold(hotspots, 0, 3 * DWELL_MS);
      expect(opened).toHaveLength(1);
      hold(hotspots, 30, 100);
      hold(hotspots, 0, DWELL_MS + 100);
      expect(opened).toHaveLength(2);
    });

    it('starts again when the head moves, and ignores bare sky', () => {
      const { hotspots, opened } = field();
      hotspots.set('guide', source(hotspot('a', 0)));
      hotspots.update(16);
      // Swinging from one edge of the capture to the other, 2° a frame: 100°/s, far from still.
      for (let i = 0; i < 200; i++) hotspots.dwell(toward(i % 2 === 0 ? -1 : 1), 20);
      expect(opened).toEqual([]);
      expect(hold(hotspots, 20, 3 * DWELL_MS)).toBeNull();
      expect(opened).toEqual([]);
    });

    it('leaves a marker under the gaze shut after resetDwell, as a clip closed there', () => {
      const { hotspots, opened } = field();
      hotspots.set('guide', source(hotspot('a', 0)));
      hotspots.update(16);
      hold(hotspots, 0, DWELL_MS / 2);
      hotspots.resetDwell();
      hold(hotspots, 0, 2 * DWELL_MS);
      expect(opened).toEqual([]);
    });
  });
});
