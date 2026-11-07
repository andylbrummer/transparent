import { describe, it, expect, vi, afterEach } from 'vitest';
import { CardboardToggle, STEREO_BODY_CLASS, type CardboardPlatform } from './cardboard';

function fakePlatform(overrides: Partial<CardboardPlatform> = {}) {
  let fullscreen = false;
  const release = vi.fn(async () => undefined);
  const platform: CardboardPlatform & { release: typeof release } = {
    requestFullscreen: vi.fn(async () => {
      fullscreen = true;
    }),
    exitFullscreen: vi.fn(async () => {
      fullscreen = false;
    }),
    isFullscreen: () => fullscreen,
    lockLandscape: vi.fn(async () => undefined),
    unlockOrientation: vi.fn(),
    requestWakeLock: vi.fn(async () => ({ release })),
    release,
    ...overrides,
  };
  return { platform, leaveFullscreen: () => (fullscreen = false) };
}

afterEach(() => {
  document.body.className = '';
  vi.restoreAllMocks();
});

describe('CardboardToggle', () => {
  it('enters stereo on its button: fullscreen, landscape, awake, controls hidden', async () => {
    const parent = document.createElement('div');
    const onChange = vi.fn();
    const { platform } = fakePlatform();
    const toggle = new CardboardToggle(parent, onChange, platform);

    (parent.querySelector('#cardboard-toggle') as HTMLButtonElement).click();
    expect(onChange).toHaveBeenCalledWith(true);
    expect(document.body.classList.contains(STEREO_BODY_CLASS)).toBe(true);
    await vi.waitFor(() => expect(platform.requestWakeLock).toHaveBeenCalled());
    expect(platform.requestFullscreen).toHaveBeenCalled();
    expect(platform.lockLandscape).toHaveBeenCalled();
    expect(toggle.isActive()).toBe(true);

    toggle.exit();
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(document.body.classList.contains(STEREO_BODY_CLASS)).toBe(false);
    expect(platform.exitFullscreen).toHaveBeenCalled();
    expect(platform.unlockOrientation).toHaveBeenCalled();
    expect(platform.release).toHaveBeenCalled();
    toggle.dispose();
    expect(parent.children.length).toBe(0);
  });

  it('reports each refusal and still splits the view', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refuse = async (): Promise<never> => {
      throw new Error('refused');
    };
    const { platform } = fakePlatform({ requestFullscreen: refuse, lockLandscape: refuse, requestWakeLock: refuse });
    const toggle = new CardboardToggle(document.createElement('div'), () => undefined, platform);

    await toggle.enter();
    expect(toggle.isActive()).toBe(true);
    expect(errors.mock.calls.map((call) => call[0])).toEqual([
      'cardboard: fullscreen refused',
      'cardboard: landscape lock refused',
      'cardboard: wake lock refused',
    ]);
    toggle.exit();
    // Never entered fullscreen, so never tries to leave it.
    expect(platform.exitFullscreen).not.toHaveBeenCalled();
    toggle.dispose();
  });

  it('leaves stereo when the system back gesture leaves fullscreen', async () => {
    const onChange = vi.fn();
    const { platform, leaveFullscreen } = fakePlatform();
    const toggle = new CardboardToggle(document.createElement('div'), onChange, platform);
    await toggle.enter();

    leaveFullscreen();
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(toggle.isActive()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(platform.exitFullscreen).not.toHaveBeenCalled();
    toggle.dispose();
  });

  it('releases a wake lock granted after it already left', async () => {
    let grant: (lock: { release(): Promise<void> }) => void = () => undefined;
    const release = vi.fn(async () => undefined);
    const { platform } = fakePlatform({
      requestWakeLock: () => new Promise((resolve) => (grant = resolve)),
    });
    const toggle = new CardboardToggle(document.createElement('div'), () => undefined, platform);
    const entering = toggle.enter();
    await vi.waitFor(() => expect(platform.lockLandscape).toHaveBeenCalled());
    toggle.exit();
    grant({ release });
    await entering;
    expect(release).toHaveBeenCalled();
    toggle.dispose();
  });
});
