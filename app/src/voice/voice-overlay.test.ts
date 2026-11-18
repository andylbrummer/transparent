import { describe, it, expect, beforeEach } from 'vitest';
import { VoiceOverlay } from './voice-overlay';

let parent: HTMLElement;
let overlay: VoiceOverlay;
const readouts = (): HTMLElement[] => [...parent.querySelectorAll<HTMLElement>('.voice-status__readout')];

beforeEach(() => {
  parent = document.createElement('div');
  overlay = new VoiceOverlay(parent);
});

describe('VoiceOverlay.place', () => {
  it('leaves one eye\'s readout to the stylesheet, which stands it above the captions', () => {
    overlay.place(false, 360, 640, 0);
    const [first, second] = readouts();
    expect(first.style.top).toBe('');
    expect(first.style.bottom).toBe('');
    expect(second.hidden).toBe(true);
  });

  it("hangs each eye's readout from 70% of the height in stereo", () => {
    overlay.place(true, 800, 400, 300);
    for (const readout of readouts()) {
      expect(readout.hidden).toBe(false);
      expect(readout.style.top).toBe('280px');
      expect(readout.style.bottom).toBe('auto');
    }
  });

  it('hands the readout back to the stylesheet on leaving stereo', () => {
    overlay.place(true, 800, 400, 300);
    overlay.place(false, 800, 400, 300);
    const [first] = readouts();
    expect(first.style.top).toBe('');
    expect(first.style.bottom).toBe('');
  });
});
