import { describe, expect, it } from 'vitest';
import { HOLD_MS, ViewerButton } from './viewer-button';

describe('ViewerButton', () => {
  it('reads a press let go before HOLD_MS as a tap', () => {
    const button = new ViewerButton();
    button.down(1, 0);
    expect(button.held(HOLD_MS - 1)).toBe(false);
    expect(button.up(1)).toBe(true);
  });

  it('reads a press kept down to HOLD_MS as a hold, once, and its letting go as no tap', () => {
    const button = new ViewerButton();
    button.down(1, 100);
    expect(button.held(100 + HOLD_MS)).toBe(true);
    expect(button.held(100 + 2 * HOLD_MS)).toBe(false);
    expect(button.up(1)).toBe(false);
  });

  it('takes no second finger while one is down', () => {
    const button = new ViewerButton();
    button.down(1, 0);
    button.down(2, 10);
    expect(button.up(2)).toBe(false);
    expect(button.up(1)).toBe(true);
  });

  it('reads a cancelled press as nothing', () => {
    const button = new ViewerButton();
    button.down(1, 0);
    button.cancel(1);
    expect(button.held(HOLD_MS)).toBe(false);
    expect(button.up(1)).toBe(false);
  });

  it('reads nothing with no press', () => {
    const button = new ViewerButton();
    expect(button.held(HOLD_MS)).toBe(false);
    expect(button.up(1)).toBe(false);
  });
});
