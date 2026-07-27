import { describe, it, expect } from 'vitest';
import { vec3 } from '../src/index';

describe('vec3', () => {
  it('creates a vector with correct components', () => {
    const v = vec3(1, 2, 3);
    expect(v.x).toBe(1);
    expect(v.y).toBe(2);
    expect(v.z).toBe(3);
  });
});
