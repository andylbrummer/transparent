import { describe, expect, it } from 'vitest';
import { ScreenAwake, type WakeLockPlatform } from './screen-awake';

function fakePlatform(options: { refuse?: boolean } = {}) {
  let listener: () => void = () => undefined;
  const state = {
    visible: true,
    refuse: options.refuse ?? false,
    requests: 0,
    held: 0,
    lose: null as (() => void) | null,
  };
  const platform: WakeLockPlatform = {
    requestWakeLock: (onLost) => {
      state.requests++;
      if (state.refuse) return Promise.reject(new Error('NotAllowedError'));
      state.held++;
      state.lose = () => {
        state.held--;
        onLost();
      };
      return Promise.resolve({
        release: () => {
          state.held--;
          return Promise.resolve();
        },
      });
    },
    isPageVisible: () => state.visible,
    listen: (l) => {
      listener = l;
      return () => undefined;
    },
  };
  return { platform, state, fire: () => listener() };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('keeping the screen on', () => {
  it('holds a lock while wanted and lets it go when not', async () => {
    const { platform, state } = fakePlatform();
    const awake = new ScreenAwake(platform);
    awake.want(true);
    await settled();
    expect(awake.isHeld()).toBe(true);
    expect(state.held).toBe(1);
    awake.want(false);
    await settled();
    expect(awake.isHeld()).toBe(false);
    expect(state.held).toBe(0);
  });

  it('asks once, however many frames want it', async () => {
    const { platform, state } = fakePlatform();
    const awake = new ScreenAwake(platform);
    for (let i = 0; i < 60; i++) awake.want(true);
    await settled();
    expect(state.requests).toBe(1);
  });

  it('takes the lock again when the page shows after the system dropped it', async () => {
    const { platform, state, fire } = fakePlatform();
    const awake = new ScreenAwake(platform);
    awake.want(true);
    await settled();
    state.visible = false;
    state.lose?.();
    expect(awake.isHeld()).toBe(false);
    fire();
    await settled();
    expect(state.requests).toBe(1);
    state.visible = true;
    fire();
    await settled();
    expect(awake.isHeld()).toBe(true);
    expect(state.requests).toBe(2);
  });

  it('says why it was refused, and asks again on the next tap', async () => {
    const { platform, state, fire } = fakePlatform({ refuse: true });
    const awake = new ScreenAwake(platform);
    awake.want(true);
    await settled();
    expect(awake.getProblem()).toBe('NotAllowedError');
    state.refuse = false;
    fire();
    await settled();
    expect(awake.isHeld()).toBe(true);
    expect(awake.getProblem()).toBeNull();
  });

  it('does not keep a lock that arrives after it stopped being wanted', async () => {
    const { platform, state } = fakePlatform();
    const awake = new ScreenAwake(platform);
    awake.want(true);
    awake.want(false);
    await settled();
    expect(awake.isHeld()).toBe(false);
    expect(state.held).toBe(0);
  });
});
