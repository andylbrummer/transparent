/**
 * Browser sensor wiring for Transparent Earth app.
 * Bridges heading gate logic (packages/core/src/heading) with browser APIs:
 * - Geolocation API for position fix
 * - AbsoluteOrientationSensor / DeviceOrientation for heading
 */

import {
  evaluateHeadingSamples,
  type HeadingSample,
  type FixStatus,
} from '@transparent-earth/core/heading';

export type SensorCallback = (state: { heading: number | null; fix: FixStatus }) => void;

export interface SensorController {
  start(): void;
  stop(): void;
}

/**
 * Create a sensor controller that drives heading and fix state.
 * This is a minimal scaffold — actual sensor polling would use
 * navigator.geolocation.watchPosition and window.addEventListener('deviceorientation').
 */
export function createSensorController(callback: SensorCallback): SensorController {
  // headingSamples will be populated by sensor polling in future iterations
  const headingSamples: HeadingSample[] = [];
  const fixState: FixStatus = { phase: 'acquiring', accuracy: null };
  let running = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function tick() {
    if (!running) return;

    // Evaluate heading if we have enough samples
    const headingResult = evaluateHeadingSamples(headingSamples);
    const heading = headingResult.status === 'ok' ? headingResult.heading : null;

    callback({ heading, fix: fixState });
  }

  return {
    start() {
      if (running) return;
      running = true;
      intervalId = setInterval(tick, 1000);
    },
    stop() {
      running = false;
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  };
}
