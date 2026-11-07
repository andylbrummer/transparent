import { describe, it, expect } from 'vitest';
import { probeCapabilities } from './state';

describe('probeCapabilities', () => {
  it('returns at least gyro in jsdom', async () => {
    const modes = await probeCapabilities();
    expect(modes).toContain('gyro');
  });
});
