import { describe, it, expect, beforeEach } from 'vitest';
import { StereoNotice } from './stereo-notice';

let parent: HTMLElement;
let notice: StereoNotice;
const root = (): HTMLElement => parent.querySelector<HTMLElement>('.stereo-notice')!;
const readouts = (): HTMLElement[] => [...parent.querySelectorAll<HTMLElement>('.stereo-notice__readout')];

beforeEach(() => {
  parent = document.createElement('div');
  notice = new StereoNotice(parent);
});

describe('StereoNotice', () => {
  it('is down until there is something to say', () => {
    expect(root().hidden).toBe(true);
  });

  it('says the same thing to both eyes, and reads it once', () => {
    notice.show('This step could not be played.');
    expect(root().hidden).toBe(false);
    expect(readouts().map((r) => r.textContent)).toEqual(['This step could not be played.', 'This step could not be played.']);
    expect(root().getAttribute('role')).toBe('status');
    expect(readouts()[1].getAttribute('aria-hidden')).toBe('true');
  });

  it('leaves the page alone while the text is the same, and goes down for nothing', () => {
    notice.show('Paused');
    const text = readouts()[0].firstChild;
    notice.show('Paused');
    expect(readouts()[0].firstChild).toBe(text);
    notice.show('');
    expect(root().hidden).toBe(true);
  });

  it("puts each copy over its eye's convergence spot, above the middle", () => {
    notice.place(800, 400, 300);
    expect(readouts().map((r) => r.style.left)).toEqual(['250px', '550px']);
    expect(parseFloat(readouts()[0].style.top)).toBeLessThan(200);
  });

  it('leaves with dispose', () => {
    notice.dispose();
    expect(parent.querySelector('.stereo-notice')).toBeNull();
  });

  it('stands where it is told, and is no live region when it is not to be read out as it changes', () => {
    const chips = new StereoNotice(parent, { topFraction: 0.1, live: false, className: 'stereo-notice--chips' });
    const chipRoot = parent.querySelector<HTMLElement>('.stereo-notice--chips')!;
    expect(chipRoot.getAttribute('role')).toBeNull();
    expect(root().getAttribute('role')).toBe('status');
    chips.show('North Pole');
    chips.place(844, 390, 300);
    expect(chipRoot.querySelector<HTMLElement>('.stereo-notice__readout')!.style.top).toBe('39px');
  });
});

