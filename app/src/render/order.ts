/**
 * Draw order. Nothing in the scene depth-tests - the globe is see-through -
 * so order alone decides what covers what.
 */
export const RENDER_ORDER = {
  /** The raymarched Earth. */
  globe: 0,
  /** All-sky images, added over the globe and dimmed below the horizon. */
  skyMap: 0.1,
  /** Stars, sky lines, Sun, Moon, planets. */
  sky: 0.2,
  /** Images draped on or above the surface: clouds, rain, night lights. */
  surfaceShell: 0.5,
  outlines: 1,
  interior: 2,
  quakes: 3,
  /** Things in orbit and around the Earth. */
  nearSpace: 4,
  /** A clip's image in the viewer: over everything, as the page's panel is over the view. */
  clipPanel: 10,
} as const;
