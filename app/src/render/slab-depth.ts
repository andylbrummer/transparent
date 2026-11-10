/**
 * The depth the subducting slabs write, shared with what must know whether
 * it lies in front of a slab or behind one.
 *
 * Nothing else in the scene depth-tests, so the depth buffer is the slabs'
 * own. The camera's range (0.1 m to 1e9 m) leaves no precision at these
 * distances, so the value is a logarithm of the distance along the view
 * axis: 1 km to 40,000 km, 6 m apart at 10,000 km in 24 bits.
 */
export const SLAB_DEPTH_GLSL = `
  float slabDepth(float viewDistance) {
    return clamp(log2(max(viewDistance, 1.0e3) / 1.0e3) / log2(4.0e4), 0.0, 1.0);
  }
`;
