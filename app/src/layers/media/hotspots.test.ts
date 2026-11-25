import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HotspotSource } from '../../guides/hotspot-field';
import type { MediaHotspots } from '../../guides/format';
import { createMediaHotspotsLayer } from './hotspots';
import mediaHotspots from './layer';

const SHIPPED = JSON.parse(readFileSync('public/media/hotspots.json', 'utf8')) as MediaHotspots;

/** A context serving `file` as hotspots.json, recording what the layer hands the field and asks of it. */
function context(file: unknown) {
  const handed: HotspotSource[] = [];
  const calls: string[] = [];
  return {
    handed,
    calls,
    assetUrl: (path: string) => `/base/${path}`,
    fetchJson: <T>(url: string): Promise<T> => (calls.push(`fetch ${url}`), Promise.resolve(file as T)),
    addHotspots: (source: HotspotSource) => {
      handed.push(source);
      return { setVisible: (visible: boolean) => void calls.push(`visible ${visible}`), remove: () => void calls.push('remove') };
    },
  };
}

describe('the Stories and clips layer', () => {
  it("hands the file's hotspots to the field, its files found beside it, and shows them with its switch", async () => {
    const c = context(SHIPPED);
    const layer = await createMediaHotspotsLayer(c);
    expect(c.handed).toHaveLength(1);
    expect(c.handed[0].hotspots).toBe(SHIPPED.hotspots);
    expect(c.handed[0].language).toBe(SHIPPED.language);
    expect(c.handed[0].fileUrl('images/x.webp')).toBe('/base/media/images/x.webp');
    layer.setVisible(true);
    layer.setVisible(false);
    layer.dispose();
    expect(c.calls).toEqual(['fetch /base/media/hotspots.json', 'visible true', 'visible false', 'remove']);
  });

  it('refuses a file of another format, so the switch says it failed', async () => {
    await expect(createMediaHotspotsLayer(context({ ...SHIPPED, formatVersion: 2 }))).rejects.toThrow('hotspots.json is format 2; this app reads 1');
  });

  it("credits every clip's maker in the credits list", () => {
    const listed = mediaHotspots.credits.map((credit) => credit.url);
    for (const hotspot of SHIPPED.hotspots) expect(listed, hotspot.id).toContain(hotspot.clip.credit.url);
  });
});
