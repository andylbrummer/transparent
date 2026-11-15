import type { LayerContext, LayerDefinition, LayerInstance } from '../types';

/** How much of its light the sky below the horizon keeps when seen through the Earth. */
export const BELOW_HORIZON_BRIGHTNESS = 0.35;
/** The whole sky at full strength, as if the Earth were not there: no dimming, no horizon line. */
export const WHOLE_SKY_BRIGHTNESS = 1;

/** Sets the shared below-horizon brightness while on; nothing below the horizon while off. */
const belowHorizonSwitch =
  (brightness: number) =>
  async (context: LayerContext): Promise<LayerInstance> => {
    const uniform = context.skyUniforms.uBelowHorizon;
    return {
      setVisible(visible) {
        uniform.value = visible ? brightness : 0;
      },
      dispose() {
        uniform.value = 0;
      },
    };
  };

/**
 * Not data: switches for how much of the sky shows below the horizon. Both
 * off, the stars stop at the horizon as they do for the eye; one at a time,
 * since both set the same brightness (the panel turns the other off first).
 */
const switches: LayerDefinition[] = [
  {
    id: 'sky-below-horizon',
    label: 'Sky through the Earth',
    section: 'Sky',
    order: 0,
    defaultOn: true,
    exclusiveGroup: 'below-horizon',
    caption: 'the half of the sky below the horizon, dimmed',
    credits: [],
    load: belowHorizonSwitch(BELOW_HORIZON_BRIGHTNESS),
  },
  {
    id: 'sky-whole',
    label: 'Whole sky, undimmed',
    section: 'Sky',
    order: 1,
    exclusiveGroup: 'below-horizon',
    caption: 'the full sphere of the sky at full strength, the Earth and the horizon out of the way',
    credits: [],
    load: belowHorizonSwitch(WHOLE_SKY_BRIGHTNESS),
  },
];

export default switches;
