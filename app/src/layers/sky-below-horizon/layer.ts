import type { LayerDefinition } from '../types';

/** How much of its light the sky below the horizon keeps when seen through the Earth. */
export const BELOW_HORIZON_BRIGHTNESS = 0.35;

/**
 * Not data: a switch for whether the sky shows through the planet. Off,
 * the stars stop at the horizon as they do for the eye.
 */
const skyBelowHorizon: LayerDefinition = {
  id: 'sky-below-horizon',
  label: 'Sky through the Earth',
  section: 'Sky',
  order: 0,
  defaultOn: true,
  caption: 'the half of the sky below the horizon, dimmed',
  credits: [],
  load: async (context) => {
    const uniform = context.skyUniforms.uBelowHorizon;
    return {
      setVisible(visible) {
        uniform.value = visible ? BELOW_HORIZON_BRIGHTNESS : 0;
      },
      dispose() {
        uniform.value = 0;
      },
    };
  },
};

export default skyBelowHorizon;
