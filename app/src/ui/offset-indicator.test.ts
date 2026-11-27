import { describe, expect, it } from 'vitest';
import { OffsetIndicator, RESET_LABEL, offsetLabel } from './offset-indicator';

const DEG = Math.PI / 180;

describe('the offset on the Reset button', () => {
  it('says only what the button does with no offset', () => {
    expect(offsetLabel(0, 0)).toBe(RESET_LABEL);
  });

  it('gives both nudges with their directions', () => {
    expect(offsetLabel(12, -5)).toBe('← 12°  ↓ 5° · Reset');
    expect(offsetLabel(-30, 0)).toBe('→ 30°  ↕ 0° · Reset');
  });

  it('wraps a heading that went round, ignores the nudges while a drag aims, and writes only on a change', () => {
    const button = { textContent: '', classList: { toggle: () => undefined } } as unknown as HTMLElement;
    const indicator = new OffsetIndicator(button);
    indicator.update(true, 370 * DEG, 0.2 * DEG);
    expect(button.textContent).toBe('← 10°  ↕ 0° · Reset');
    button.textContent = 'untouched';
    indicator.update(true, 370.2 * DEG, 0.1 * DEG);
    expect(button.textContent).toBe('untouched');
    indicator.update(false, 370 * DEG, 0);
    expect(button.textContent).toBe(RESET_LABEL);
  });
});
