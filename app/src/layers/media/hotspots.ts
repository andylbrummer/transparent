/**
 * The "Stories and clips" layer: the hotspots of public/media/hotspots.json, handed to the app's hotspot field, which
 * draws their markers and opens their clips as it does a guide's. The layer only reads the file and says when to show.
 */

import { GUIDE_FORMAT_VERSION, type MediaHotspots } from '../../guides/format';
import type { LayerContext, LayerInstance } from '../types';

/** The layer's folder under public/: the list and every file its clips name, from here. */
export const MEDIA_FOLDER = 'media/';

export async function createMediaHotspotsLayer(context: Pick<LayerContext, 'assetUrl' | 'fetchJson' | 'addHotspots'>): Promise<LayerInstance> {
  const media = await context.fetchJson<MediaHotspots>(context.assetUrl(`${MEDIA_FOLDER}hotspots.json`));
  // A file from a later app, cached or served beside this one, may mean something this app cannot read.
  if (media.formatVersion !== GUIDE_FORMAT_VERSION) throw new Error(`hotspots.json is format ${media.formatVersion}; this app reads ${GUIDE_FORMAT_VERSION}`);
  const group = context.addHotspots({
    hotspots: media.hotspots,
    language: media.language,
    fileUrl: (path) => context.assetUrl(`${MEDIA_FOLDER}${path}`),
  });
  return {
    setVisible: (visible) => group.setVisible(visible),
    dispose: () => group.remove(),
  };
}
