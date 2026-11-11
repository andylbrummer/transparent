import { describe, it, expect, vi, afterEach } from 'vitest';
import { AR_BODY_CLASS, ARControls } from './ar-controls';

afterEach(() => {
  document.body.className = '';
  document.body.innerHTML = '';
});

describe('ARControls', () => {
  it('offers the button only when told AR can run', () => {
    const parent = document.createElement('div');
    const controls = new ARControls(parent, vi.fn(), vi.fn());
    const button = parent.querySelector('#ar-toggle') as HTMLButtonElement;
    expect(button.hidden).toBe(true);
    controls.setAvailable(true);
    expect(button.hidden).toBe(false);
    controls.setAvailable(false);
    expect(button.hidden).toBe(true);
  });

  it('enters on the button and leaves on the overlay exit', () => {
    const parent = document.createElement('div');
    const onEnter = vi.fn();
    const onExit = vi.fn();
    const controls = new ARControls(parent, onEnter, onExit);
    (parent.querySelector('#ar-toggle') as HTMLButtonElement).click();
    expect(onEnter).toHaveBeenCalledOnce();

    controls.setActive(true);
    controls.setStatus('Point the phone at the floor');
    const overlay = document.getElementById('ar-overlay') as HTMLDivElement;
    expect(overlay.hidden).toBe(false);
    expect(overlay.textContent).toContain('Point the phone at the floor');
    expect(document.body.classList.contains(AR_BODY_CLASS)).toBe(true);
    (overlay.querySelector('.ar-exit') as HTMLButtonElement).click();
    expect(onExit).toHaveBeenCalledOnce();

    controls.setActive(false);
    expect(overlay.hidden).toBe(true);
    expect(document.body.classList.contains(AR_BODY_CLASS)).toBe(false);
  });

  it('keeps a tap on its own buttons from placing the portal', () => {
    new ARControls(document.createElement('div'), vi.fn(), vi.fn());
    const overlay = document.getElementById('ar-overlay') as HTMLDivElement;
    const onButton = new Event('beforexrselect', { bubbles: true, cancelable: true });
    overlay.querySelector('.ar-exit')!.dispatchEvent(onButton);
    expect(onButton.defaultPrevented).toBe(true);
    const onBackground = new Event('beforexrselect', { bubbles: true, cancelable: true });
    overlay.dispatchEvent(onBackground);
    expect(onBackground.defaultPrevented).toBe(false);
  });

  it('takes everything away on dispose', () => {
    const parent = document.createElement('div');
    const controls = new ARControls(parent, vi.fn(), vi.fn());
    controls.setActive(true);
    controls.dispose();
    expect(parent.querySelector('#ar-toggle')).toBeNull();
    expect(document.getElementById('ar-overlay')).toBeNull();
    expect(document.body.classList.contains(AR_BODY_CLASS)).toBe(false);
  });
});
