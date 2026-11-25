import { describe, it, expect } from 'vitest';
import { DIP_IN_MS, DIP_OUT_MS, Dip } from './dip';

/** Lets every pending callback run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const parent = document.createElement('div');
  const dip = new Dip(parent, '#050510');
  const plate = parent.querySelector<HTMLDivElement>('.dip')!;
  return { parent, dip, plate };
}

describe('Dip', () => {
  it('shows nothing until asked', () => {
    const { dip, plate } = setup();
    dip.update(16);
    expect(plate.hidden).toBe(true);
    expect(dip.isActive()).toBe(false);
    expect(dip.darkness()).toBe(0);
  });

  it('fades to dark, makes the change there, then fades back', async () => {
    const { dip, plate } = setup();
    let changed = false;
    const done = dip.run(() => {
      changed = true;
      return 'moved';
    });
    dip.update(DIP_OUT_MS / 2);
    expect(plate.hidden).toBe(false);
    expect(Number(plate.style.opacity)).toBeCloseTo(0.5, 6);
    expect(changed).toBe(false);
    dip.update(DIP_OUT_MS / 2);
    // Made in the frame that reaches dark.
    expect(changed).toBe(true);
    expect(dip.darkness()).toBe(1);
    expect(await done).toBe('moved');
    await settle();
    dip.update(DIP_IN_MS / 4);
    expect(dip.darkness()).toBeCloseTo(0.75, 6);
    dip.update(DIP_IN_MS);
    expect(dip.darkness()).toBe(0);
    expect(plate.hidden).toBe(true);
    expect(dip.isActive()).toBe(false);
  });

  it('stays dark until the change has finished, the layers it waits for loaded', async () => {
    const { dip } = setup();
    let finish!: () => void;
    const done = dip.run(() => new Promise<void>((resolve) => (finish = resolve)));
    dip.update(DIP_OUT_MS);
    await settle();
    dip.update(1000);
    expect(dip.darkness()).toBe(1);
    finish();
    await done;
    await settle();
    dip.update(DIP_IN_MS);
    expect(dip.darkness()).toBe(0);
  });

  it('makes the changes asked for on the way down together, in order, in one dark', async () => {
    const { dip } = setup();
    const made: string[] = [];
    const first = dip.run(() => made.push('first'));
    dip.update(DIP_OUT_MS / 2);
    const second = dip.run(() => made.push('second'));
    dip.update(DIP_OUT_MS / 2);
    await Promise.all([first, second]);
    expect(made).toEqual(['first', 'second']);
    await settle();
    dip.update(DIP_IN_MS);
    expect(dip.isActive()).toBe(false);
  });

  it('takes a change asked for while dark into the same dark', async () => {
    const { dip } = setup();
    let finish!: () => void;
    const made: string[] = [];
    const first = dip.run(() => new Promise<void>((resolve) => (finish = resolve)));
    dip.update(DIP_OUT_MS);
    const second = dip.run(() => made.push('second'));
    finish();
    await Promise.all([first, second]);
    expect(made).toEqual(['second']);
    expect(dip.darkness()).toBe(1);
  });

  it('turns dark again from where it got to when asked during the fade back', async () => {
    const { dip } = setup();
    await Promise.all([dip.run(() => undefined), Promise.resolve(dip.update(DIP_OUT_MS))]);
    await settle();
    dip.update(DIP_IN_MS / 2);
    expect(dip.darkness()).toBeCloseTo(0.5, 6);
    let changed = false;
    void dip.run(() => (changed = true));
    dip.update(DIP_OUT_MS / 4);
    expect(dip.darkness()).toBeCloseTo(0.75, 6);
    expect(changed).toBe(false);
    dip.update(DIP_OUT_MS / 4);
    expect(changed).toBe(true);
  });

  it('passes a failed change to its caller and still fades back', async () => {
    const { dip } = setup();
    const done = dip.run(() => Promise.reject(new Error('layer failed')));
    dip.update(DIP_OUT_MS);
    await expect(done).rejects.toThrow('layer failed');
    await settle();
    dip.update(DIP_IN_MS);
    expect(dip.isActive()).toBe(false);
  });

  it('is taken out of the page on dispose', () => {
    const { parent, dip } = setup();
    dip.dispose();
    expect(parent.querySelector('.dip')).toBeNull();
  });
});
