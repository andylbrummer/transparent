import { describe, it, expect, beforeEach } from 'vitest';
import { CaptionOverlay } from './captions';
import { parseVtt, type CaptionCue } from './vtt';

// Two cues adjoining, a gap, then a cue of two lines.
const CUES = parseVtt(
  ['WEBVTT', '', '00:00.000 --> 00:02.000', 'Look down.', '', '00:02.000 --> 00:04.000', 'Through your feet.', '', '00:06.000 --> 00:09.000', 'The far side', 'of the Earth.', ''].join('\n'),
);
const [FIRST, SECOND, THIRD] = CUES;

let parent: HTMLElement;
let overlay: CaptionOverlay;
const root = (): HTMLElement => parent.querySelector<HTMLElement>('.captions')!;
const plate = (): HTMLElement => parent.querySelector<HTMLElement>('.captions__plate')!;
const shownText = (): string | null => (plate().style.display === 'none' ? null : plate().textContent);

beforeEach(() => {
  parent = document.createElement('div');
  overlay = new CaptionOverlay(parent);
});

describe('CaptionOverlay', () => {
  it('shows nothing before it has cues, whatever the time', () => {
    expect(shownText()).toBeNull();
    overlay.update(1);
    expect(shownText()).toBeNull();
  });

  it("shows the cue's lines, one to a line, in the guide's language", () => {
    overlay.setCues({ cues: CUES, lang: 'en-GB' });
    overlay.update(7);
    expect(shownText()).toBe('The far side\nof the Earth.');
    expect(plate().lang).toBe('en-GB');
  });

  it.each<[string, number, CaptionCue | null]>([
    ['at a start', 0, FIRST],
    ['at an end where the next cue starts', 2, SECOND],
    ['at an end before a gap', 4, null],
    ['in a gap', 5, null],
    ['after the last cue', 9, null],
  ])('shows the cue %s (t = %s)', (_, tS, cue) => {
    overlay.setCues({ cues: CUES, lang: 'en' });
    overlay.update(tS);
    expect(shownText()).toBe(cue === null ? null : cue.lines.join('\n'));
  });

  it('leaves the page alone while the cue is the same', () => {
    overlay.setCues({ cues: CUES, lang: 'en' });
    overlay.update(6);
    const text = plate().firstChild;
    overlay.update(8);
    expect(plate().firstChild).toBe(text);
  });

  it('shows the earlier cue after a seek back', () => {
    overlay.setCues({ cues: CUES, lang: 'en' });
    overlay.update(7);
    overlay.update(1);
    expect(shownText()).toBe(FIRST.lines.join('\n'));
  });

  it('takes the caption down when the cues change, without waiting for a time', () => {
    overlay.setCues({ cues: CUES, lang: 'en' });
    overlay.update(1);
    overlay.setCues(null);
    expect(shownText()).toBeNull();
    expect(plate().hasAttribute('lang')).toBe(false);
    overlay.update(1);
    expect(shownText()).toBeNull();

    overlay.setCues({ cues: CUES, lang: 'en' });
    overlay.update(3);
    overlay.setCues({ cues: [THIRD], lang: 'en' });
    expect(shownText()).toBeNull();
  });

  it('is plain text, announcing nothing by itself', () => {
    overlay.setCues({ cues: CUES, lang: 'en' });
    overlay.update(1);
    for (const element of [root(), plate()]) {
      for (const attribute of ['role', 'aria-live', 'aria-hidden']) expect(element.hasAttribute(attribute)).toBe(false);
    }
  });

  it('shows markup in the text as text', () => {
    overlay.setCues({ cues: [{ startS: 0, endS: 1, lines: ['<b>x</b>'] }], lang: 'en' });
    overlay.update(0.5);
    expect(plate().children).toHaveLength(0);
    expect(plate().textContent).toBe('<b>x</b>');
  });

  it('keeps its caption while hidden, and is gone once disposed', () => {
    overlay.setCues({ cues: CUES, lang: 'en' });
    overlay.update(7);
    overlay.setVisible(false);
    expect(root().style.display).toBe('none');
    overlay.setVisible(true);
    expect(root().style.display).toBe('');
    expect(shownText()).toBe(THIRD.lines.join('\n'));

    overlay.dispose();
    expect(parent.querySelector('.captions')).toBeNull();
  });

  describe('in Cardboard', () => {
    const plates = (): HTMLElement[] => [...parent.querySelectorAll<HTMLElement>('.captions__plate')];

    it('shows one plate on one screen, and the same caption on two, one per eye, in stereo', () => {
      overlay.setCues({ cues: CUES, lang: 'en' });
      overlay.update(7);
      overlay.place(false, 800, 400, 300);
      expect(plates().map((p) => p.hidden)).toEqual([false, true]);
      overlay.place(true, 800, 400, 300);
      expect(plates().map((p) => p.hidden)).toEqual([false, false]);
      expect(plates().map((p) => p.textContent)).toEqual(['The far side\nof the Earth.', 'The far side\nof the Earth.']);
      expect(plates().map((p) => p.style.left)).toEqual(['250px', '550px']);
      expect(root().classList.contains('captions--stereo')).toBe(true);
    });

    it("reads once: the right eye's copy is hidden from a screen reader", () => {
      expect(plates()[1].getAttribute('aria-hidden')).toBe('true');
      expect(plates()[0].hasAttribute('aria-hidden')).toBe(false);
    });

    it('stands clear of the voice readout, which hangs from 70% of the height', () => {
      overlay.place(true, 800, 400, 300);
      expect(parseFloat(plates()[0].style.bottom)).toBeGreaterThanOrEqual(400 * 0.3);
    });

    it('goes back to one plate along the foot when the viewer is left', () => {
      overlay.place(true, 800, 400, 300);
      overlay.place(false, 800, 400, 300);
      expect(plates().map((p) => p.hidden)).toEqual([false, true]);
      expect(plates()[0].style.left).toBe('');
      expect(root().classList.contains('captions--stereo')).toBe(false);
    });
  });
});
