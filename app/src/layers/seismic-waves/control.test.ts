import { describe, it, expect, vi, afterEach } from 'vitest';
import { PlaybackControl, type PlaybackHandlers, type PlaybackView } from './control';

const VIEW: PlaybackView = {
  playing: false,
  elapsedS: 600,
  spanS: 3600,
  speed: 60,
  origin: 'M9.1 · 29 km deep · 11 Mar 2011, 05:46:24 UTC',
  hereTitle: 'Here, 91.5° away',
  hereNext: 'P wave reaches you in 3 min 03 s',
  hereTimetable: 'P 13:03 · S 24:00',
  antipodeNext: 'core P wave (PKIKP) in 10 min 08 s',
  antipodeTimetable: 'PKIKP 20:07',
  felt: '',
};

function handlers(): PlaybackHandlers {
  return { onSelect: vi.fn(), onToggle: vi.fn(), onSeek: vi.fn(), onSpeed: vi.fn(), onSpan: vi.fn() };
}

function build(): { control: PlaybackControl; calls: PlaybackHandlers } {
  const calls = handlers();
  const control = new PlaybackControl(document.body, calls);
  control.setEvents(
    [
      { key: 'tohoku2011', label: 'Tōhoku, Japan 2011 · M9.1' },
      { key: 'okhotsk2013', label: 'Sea of Okhotsk 2013 · M8.3 · 598 km deep' },
    ],
    'tohoku2011'
  );
  control.update(VIEW);
  return { control, calls };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('PlaybackControl', () => {
  it('starts hidden and shows with the layer', () => {
    const { control } = build();
    expect(control.root.hidden).toBe(true);
    control.setVisible(true);
    expect(control.root.hidden).toBe(false);
  });

  it('names every control for assistive technology', () => {
    const { control } = build();
    expect(control.root.getAttribute('aria-label')).toBe('Seismic wave playback');
    const labels = [...control.root.querySelectorAll('select, input, button')].map((node) => node.getAttribute('aria-label'));
    expect(labels).toEqual(['Earthquake', 'Playback speed', 'Length of the timeline', 'Play', 'Time since the earthquake']);
    expect(control.root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
  });

  it('shows the time since the origin, the real origin time and both readouts', () => {
    const { control } = build();
    const text = control.root.textContent ?? '';
    expect(text).toContain('T+ 10:00');
    expect(text).toContain('11 Mar 2011, 05:46:24 UTC');
    expect(text).toContain('Here, 91.5° away: P wave reaches you in 3 min 03 s');
    expect(text).toContain('Antipode: core P wave (PKIKP) in 10 min 08 s');
    const scrub = control.root.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(scrub.value).toBe('600');
    expect(scrub.max).toBe('3600');
    expect(scrub.getAttribute('aria-valuetext')).toBe('10 min 00 s after the earthquake');
  });

  it('turns the play button into a pause button while playing', () => {
    const { control } = build();
    const button = control.root.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Play');
    control.update({ ...VIEW, playing: true });
    expect(button.getAttribute('aria-label')).toBe('Pause');
  });

  it('announces the wave passing under the user', () => {
    const { control } = build();
    const status = control.root.querySelector('[role="status"]')!;
    expect(status.textContent).toBe('');
    control.update({ ...VIEW, felt: 'P wave is passing under you now' });
    expect(status.textContent).toBe('P wave is passing under you now');
  });

  it('reports what the user does', () => {
    const { control, calls } = build();
    const [event, speed, span] = [...control.root.querySelectorAll('select')];
    event.value = 'okhotsk2013';
    event.dispatchEvent(new Event('change'));
    expect(calls.onSelect).toHaveBeenCalledWith('okhotsk2013');
    speed.value = '600';
    speed.dispatchEvent(new Event('change'));
    expect(calls.onSpeed).toHaveBeenCalledWith(600);
    span.value = '10800';
    span.dispatchEvent(new Event('change'));
    expect(calls.onSpan).toHaveBeenCalledWith(10800);
    control.root.querySelector('button')!.click();
    expect(calls.onToggle).toHaveBeenCalledTimes(1);
    const scrub = control.root.querySelector<HTMLInputElement>('input[type="range"]')!;
    scrub.value = '1212';
    scrub.dispatchEvent(new Event('input'));
    expect(calls.onSeek).toHaveBeenCalledWith(1212);
  });

  it('offers the spec speeds, 60× among them', () => {
    const { control } = build();
    const speed = control.root.querySelectorAll('select')[1];
    expect([...speed.options].map((option) => option.textContent)).toEqual(['30×', '60×', '120×', '600×']);
    expect(speed.value).toBe('60');
  });

  it('keeps its arrow keys from turning the view', () => {
    const { control } = build();
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    control.root.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    window.removeEventListener('keydown', seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it('is hidden in Cardboard mode by its own stylesheet, and leaves nothing behind', () => {
    const { control } = build();
    expect(document.getElementById('seismic-playback-style')?.textContent).toContain('body.stereo .seismic-playback');
    control.dispose();
    expect(document.querySelector('.seismic-playback')).toBeNull();
  });
});
