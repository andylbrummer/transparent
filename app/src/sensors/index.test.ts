import { describe, it, expect } from 'vitest';
import { createSensorController } from './index';

describe('createSensorController', () => {
  it('starts and stops without error', () => {
    const controller = createSensorController(() => {});
    controller.start();
    controller.stop();
    expect(true).toBe(true);
  });

  it('calls callback with initial state', () => {
    return new Promise<void>((resolve) => {
      const controller = createSensorController((state) => {
        expect(state.heading).toBeNull();
        expect(state.fix.phase).toBe('acquiring');
        controller.stop();
        resolve();
      });
      controller.start();
    });
  });
});
