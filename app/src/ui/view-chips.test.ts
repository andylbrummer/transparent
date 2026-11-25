// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createClock } from '../clock';
import type { Place } from '../view/actions';
import { createStandingPlace } from '../view/standing-place';
import { chipPlace, chipTime, ViewChips } from './view-chips';

const QUAKE_MS = Date.parse('2011-03-11T05:46:24Z');

function setup(search = '') {
  const wall = { ms: QUAKE_MS };
  const clock = createClock(search, () => wall.ms);
  const standing = createStandingPlace(() => ({ lat: 30.27, lon: -97.74 }));
  const guide = { open: false };
  const parent = document.createElement('div');
  const chips = new ViewChips(parent, { standing, clock, guideOpen: () => guide.open });
  const chip = (kind: 'place' | 'time') => parent.querySelector<HTMLElement>(`.view-chip--${kind}`)!;
  const frame = () => chips.update(clock.now().getTime());
  return { wall, clock, standing, guide, parent, chips, chip, frame };
}

describe('the view chips', () => {
  it('write the time in UTC with the month in words', () => {
    expect(chipTime(QUAKE_MS)).toBe('11 Mar 2011 05:46 UTC');
    expect(chipTime(Date.parse('1999-12-31T23:59:59.999Z'))).toBe('31 Dec 1999 23:59 UTC');
  });

  it.each<[Place, string | null]>([
    [{ kind: 'here' }, null],
    [{ kind: 'antipode' }, 'The far side of the Earth'],
    [{ kind: 'at', lat: 38.3, lon: 142.4, name: 'Off Tohoku' }, 'Off Tohoku'],
  ])('name the place %o as %s', (place, text) => {
    expect(chipPlace(place)).toBe(text);
  });

  it('show nothing while the view stands here and the clock is live', () => {
    const t = setup();
    t.frame();
    expect(t.chip('place').hidden).toBe(true);
    expect(t.chip('time').hidden).toBe(true);
  });

  it('show the place while the view stands elsewhere, and go when it comes back', () => {
    const t = setup();
    t.standing.set({ kind: 'at', lat: 38.3, lon: 142.4, name: 'Off Tohoku' });
    t.frame();
    expect(t.chip('place').hidden).toBe(false);
    expect(t.chip('place').textContent).toBe('Off Tohoku');
    t.standing.set({ kind: 'here' });
    t.frame();
    expect(t.chip('place').hidden).toBe(true);
  });

  it("say a guide's time is the guide's, with its rate, and go when the clock is live again", () => {
    const t = setup();
    t.guide.open = true;
    t.clock.set(QUAKE_MS);
    t.frame();
    expect(t.chip('time').textContent).toBe('11 Mar 2011 05:46 UTC · guide');
    t.clock.setRate(3600);
    t.frame();
    expect(t.chip('time').textContent).toBe('11 Mar 2011 05:46 UTC · 3,600× · guide');
    t.clock.setRate(0);
    t.frame();
    expect(t.chip('time').textContent).toBe('11 Mar 2011 05:46 UTC · stopped · guide');
    t.clock.goLive();
    t.frame();
    expect(t.chip('time').hidden).toBe(true);
  });

  it('say a time pinned by the link is the link’s', () => {
    const t = setup('?time=2011-03-11T05:46:24Z');
    t.frame();
    expect(t.chip('time').textContent).toBe('11 Mar 2011 05:46 UTC · link');
  });

  it('write the time again only when its minute changes', () => {
    const t = setup('?time=2011-03-11T05:46:24Z');
    t.frame();
    const text = t.chip('time').firstChild;
    t.wall.ms += 30_000;
    t.frame();
    expect(t.chip('time').firstChild).toBe(text);
    t.wall.ms += 10_000;
    t.frame();
    expect(t.chip('time').textContent).toBe('11 Mar 2011 05:47 UTC · link');
  });

  it('hide together, as in Cardboard, and leave the page when disposed', () => {
    const t = setup('?time=2011-03-11T05:46:24Z');
    t.chips.setVisible(false);
    expect(t.parent.querySelector<HTMLElement>('.view-chips')!.hidden).toBe(true);
    t.chips.dispose();
    expect(t.parent.querySelector('.view-chips')).toBeNull();
  });
});
