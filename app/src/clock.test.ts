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
