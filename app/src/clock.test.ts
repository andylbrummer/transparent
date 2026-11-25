import { describe, it, expect, vi } from 'vitest';
import { createClock } from './clock';

describe('createClock', () => {
  it('follows wall time when nothing is pinned', () => {
    let wall = 1000;
    const clock = createClock('', () => wall);
    expect(clock.pinned).toBe(false);
    expect(clock.now().getTime()).toBe(1000);
    wall = 5000;
    expect(clock.now().getTime()).toBe(5000);
  });

  it('starts at ?time= and runs forward at the real rate', () => {
    let wall = 1000;
    const clock = createClock('?time=2026-11-09T06:00:00Z', () => wall);
    expect(clock.pinned).toBe(true);
    expect(clock.now().toISOString()).toBe('2026-11-09T06:00:00.000Z');
    wall += 90_000;
    expect(clock.now().toISOString()).toBe('2026-11-09T06:01:30.000Z');
  });

  it('reports and ignores an unreadable ?time=', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const clock = createClock('?time=yesterday-ish', () => 42);
    expect(clock.pinned).toBe(false);
    expect(clock.now().getTime()).toBe(42);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});

describe('setting the app clock', () => {
  const iso = (clock: { now(): Date }): string => clock.now().toISOString();
  const at = (text: string): number => Date.parse(text);

  it('is live until set, and set runs on from the new instant at the rate it had', () => {
    let wall = at('2026-11-25T12:00:00Z');
    const clock = createClock('', () => wall);
    expect(clock.isLive()).toBe(true);
    clock.set(at('2011-03-11T05:46:00Z'));
    expect(clock.isLive()).toBe(false);
    wall += 60_000;
    expect(iso(clock)).toBe('2011-03-11T05:47:00.000Z');
    expect(clock.rate()).toBe(1);
  });

  it('is not live after ?time=, and goLive goes back to wall time', () => {
    let wall = at('2026-11-25T12:00:00Z');
    const clock = createClock('?time=2026-11-09T06:00:00Z', () => wall);
    expect(clock.isLive()).toBe(false);
    clock.setRate(3600);
    wall += 1000;
    expect(iso(clock)).toBe('2026-11-09T07:00:00.000Z');
    clock.goLive();
    expect(clock.isLive()).toBe(true);
    expect(clock.rate()).toBe(1);
    wall += 1000;
    expect(clock.now().getTime()).toBe(wall);
  });

  it('runs fast, back or not at all from where it is', () => {
    let wall = 0;
    const clock = createClock('?time=2026-01-01T00:00:00Z', () => wall);
    clock.setRate(3600);
    wall += 2000;
    expect(iso(clock)).toBe('2026-01-01T02:00:00.000Z');
    clock.setRate(-60);
    wall += 1000;
    expect(iso(clock)).toBe('2026-01-01T01:59:00.000Z');
    clock.setRate(0);
    wall += 10_000;
    expect(iso(clock)).toBe('2026-01-01T01:59:00.000Z');
  });

  it('leaves live time at any rate but the real one', () => {
    const clock = createClock('', () => 0);
    clock.setRate(1);
    expect(clock.isLive()).toBe(true);
    clock.setRate(2);
    expect(clock.isLive()).toBe(false);
    clock.setRate(1);
    expect(clock.isLive()).toBe(false);
  });

  it('stops at the stop, for good, in either direction', () => {
    let wall = 0;
    const clock = createClock('?time=2026-01-01T00:00:00Z', () => wall);
    clock.setRate(3600, at('2026-01-01T06:00:00Z'));
    wall += 5000;
    expect(iso(clock)).toBe('2026-01-01T05:00:00.000Z');
    wall += 5000;
    expect(iso(clock)).toBe('2026-01-01T06:00:00.000Z');
    expect(clock.rate()).toBe(0);
    wall += 5000;
    expect(iso(clock)).toBe('2026-01-01T06:00:00.000Z');
    clock.setRate(-3600, at('2026-01-01T05:00:00Z'));
    wall += 2000;
    expect(iso(clock)).toBe('2026-01-01T05:00:00.000Z');
  });

  it('refuses a stop that is not ahead, and a rate or instant that is not a number', () => {
    const clock = createClock('?time=2026-01-01T00:00:00Z', () => 0);
    expect(() => clock.setRate(60, at('2025-12-31T00:00:00Z'))).toThrow(RangeError);
    expect(() => clock.setRate(-60, at('2026-01-02T00:00:00Z'))).toThrow(RangeError);
    expect(() => clock.setRate(0, at('2026-01-02T00:00:00Z'))).toThrow(RangeError);
    expect(() => clock.setRate(NaN)).toThrow(RangeError);
    expect(() => clock.set(NaN)).toThrow(RangeError);
    expect(iso(clock)).toBe('2026-01-01T00:00:00.000Z');
  });

  it('drops the stop when set', () => {
    let wall = 0;
    const clock = createClock('?time=2026-01-01T00:00:00Z', () => wall);
    clock.setRate(3600, at('2026-01-01T01:00:00Z'));
    clock.set(at('2027-01-01T00:00:00Z'));
    wall += 2000;
    expect(iso(clock)).toBe('2027-01-01T02:00:00.000Z');
  });

  it('stands still while held and runs on toward its stop on release', () => {
    let wall = 0;
    const clock = createClock('?time=2026-01-01T00:00:00Z', () => wall);
    clock.setRate(3600, at('2026-01-01T03:00:00Z'));
    wall += 1000;
    clock.hold(true);
    wall += 60_000;
    expect(iso(clock)).toBe('2026-01-01T01:00:00.000Z');
    expect(clock.rate()).toBe(3600);
    clock.hold(false);
    wall += 1000;
    expect(iso(clock)).toBe('2026-01-01T02:00:00.000Z');
    wall += 10_000;
    expect(iso(clock)).toBe('2026-01-01T03:00:00.000Z');
  });

  it('takes a set while held, and holds it', () => {
    let wall = 0;
    const clock = createClock('', () => wall);
    clock.hold(true);
    clock.set(at('2011-03-11T05:46:00Z'));
    clock.setRate(60);
    wall += 1000;
    expect(iso(clock)).toBe('2011-03-11T05:46:00.000Z');
    clock.hold(false);
    wall += 1000;
    expect(iso(clock)).toBe('2011-03-11T05:47:00.000Z');
  });

  it('lets go of a hold to go live: live time does not stand still', () => {
    let wall = 0;
    const clock = createClock('?time=2011-03-11T05:46:00Z', () => wall);
    clock.hold(true);
    clock.goLive();
    wall += 1000;
    expect(clock.now().getTime()).toBe(1000);
  });

  it('goes on from a save as though nothing had changed it', () => {
    let wall = 0;
    const clock = createClock('?time=2026-01-01T00:00:00Z', () => wall);
    const saved = clock.save();
    clock.set(at('1999-01-01T00:00:00Z'));
    clock.setRate(1000);
    wall += 60_000;
    clock.restore(saved);
    expect(iso(clock)).toBe('2026-01-01T00:01:00.000Z');
    expect(clock.isLive()).toBe(false);
    expect(clock.rate()).toBe(1);

    const liveClock = createClock('', () => wall);
    const liveSave = liveClock.save();
    liveClock.set(0);
    wall += 5000;
    liveClock.restore(liveSave);
    expect(liveClock.isLive()).toBe(true);
    expect(liveClock.now().getTime()).toBe(wall);
  });
});

describe('a rate cap', () => {
  it('slows a fast run to the cap while it holds, and lets it run at its own rate again once lifted', () => {
    let wall = 0;
    const clock = createClock('?time=2011-03-11T05:46:00Z', () => wall);
    const start = clock.now().getTime();
    clock.setRate(3600);
    clock.capRate(2400);
    wall += 1000;
    expect(clock.now().getTime() - start).toBe(2400 * 1000);
    expect(clock.rate()).toBe(3600);
    clock.capRate(null);
    wall += 1000;
    expect(clock.now().getTime() - start).toBe((2400 + 3600) * 1000);
  });

  it('caps a run backward the same, and leaves a slower run alone', () => {
    let wall = 0;
    const clock = createClock('?time=2011-03-11T05:46:00Z', () => wall);
    const start = clock.now().getTime();
    clock.capRate(2400);
    clock.setRate(-10_000);
    wall += 1000;
    expect(clock.now().getTime() - start).toBe(-2400 * 1000);
    clock.setRate(60);
    wall += 1000;
    expect(clock.now().getTime() - start).toBe((-2400 + 60) * 1000);
  });

  it('still stops a capped run at its stop', () => {
    let wall = 0;
    const clock = createClock('?time=2011-03-11T05:46:00Z', () => wall);
    const start = clock.now().getTime();
    clock.capRate(2400);
    clock.setRate(3600, start + 3_600_000);
    wall += 1000 * 1000;
    expect(clock.now().getTime()).toBe(start + 3_600_000);
    expect(clock.rate()).toBe(0);
  });

  it('refuses a cap of nothing', () => {
    expect(() => createClock('').capRate(0)).toThrow(RangeError);
  });
});

