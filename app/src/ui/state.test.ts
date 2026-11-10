import { describe, it, expect } from 'vitest';
import { probeCapabilities, surfaceImageryNote, wantsMultisampling } from './state';

describe('probeCapabilities', () => {
  it('returns at least gyro in jsdom', async () => {
    const modes = await probeCapabilities();
    expect(modes).toContain('gyro');
  });
});

describe('surfaceImageryNote', () => {
  it('says nothing once the base map has loaded', () => {
    expect(surfaceImageryNote('ready', true)).toBe('');
  });

  it('reports a base map that is loading or failed while the globe has no image', () => {
    expect(surfaceImageryNote('loading', false)).toBe(' · surface imagery loading');
    expect(surfaceImageryNote('failed', false)).toBe(' · surface imagery failed');
  });

  it('says so when the baked copy stands in for the live base map', () => {
    expect(surfaceImageryNote('offline', true)).toBe(' · surface imagery: offline copy');
  });

  it('says nothing about a failed base map while another map is showing', () => {
    expect(surfaceImageryNote('failed', true)).toBe('');
    expect(surfaceImageryNote('loading', true)).toBe('');
  });
});

describe('wantsMultisampling', () => {
  it('multisamples a desktop screen and leaves a dense phone screen alone', () => {
    expect(wantsMultisampling(1)).toBe(true);
    expect(wantsMultisampling(1.5)).toBe(true);
    expect(wantsMultisampling(2)).toBe(false);
    expect(wantsMultisampling(2.625)).toBe(false);
  });
});
