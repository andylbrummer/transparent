/**
 * Thermal-proxy state machine for VR performance management.
 *
 * Since navigator.thermal is unavailable, we use frame-time trend as a proxy:
 * - Track rolling frame times (ms)
 * - Compute EWMA (exponentially weighted moving average)
 * - State transitions: normal → warming → critical with hysteresis
 * - Degrade shell quality before dropping frames
 * - Restore quality when frame times improve
 */

export type ThermalState = 'normal' | 'warming' | 'critical' | 'recovering';

export interface ThermalConfig {
  /** Target frame time in ms (e.g., 16.67 for 60fps) */
  readonly targetFrameTimeMs: number;
  /** EWMA alpha (smoothing factor, 0-1) */
  readonly ewmaAlpha: number;
  /** Frame-time multiplier to trigger warming state */
  readonly warmingThreshold: number;
  /** Frame-time multiplier to trigger critical state */
  readonly criticalThreshold: number;
  /** Frame-time multiplier to restore from critical → warming */
  readonly criticalRestoreThreshold: number;
  /** Frame-time multiplier to restore from warming → normal */
  readonly warmingRestoreThreshold: number;
  /** Minimum samples before state can change from normal */
  readonly minSamples: number;
  /** Rolling window size for frame-time history */
  readonly windowSize: number;
}

export const DEFAULT_THERMAL_CONFIG: ThermalConfig = {
  targetFrameTimeMs: 16.67,
  ewmaAlpha: 0.3,
  warmingThreshold: 1.3,
  criticalThreshold: 1.8,
  criticalRestoreThreshold: 1.4,
  warmingRestoreThreshold: 1.1,
  minSamples: 10,
  windowSize: 60,
};

export interface ThermalSnapshot {
  readonly state: ThermalState;
  readonly ewmaFrameTimeMs: number;
  readonly currentFrameTimeMs: number;
  readonly shellQuality: number; // 0-1, 1 = full quality
  readonly trend: 'improving' | 'stable' | 'degrading';
}

export class ThermalProxy {
  private config: ThermalConfig;
  private state: ThermalState = 'normal';
  private frameTimes: number[] = [];
  private ewma = 0;
  private sampleCount = 0;
  private lastStateChangeTime = 0;
  private hysteresisMs = 500; // Minimum time between state changes

  constructor(config: Partial<ThermalConfig> = {}) {
    this.config = { ...DEFAULT_THERMAL_CONFIG, ...config };
  }

  /**
   * Submit a new frame time sample and update state.
   */
  tick(frameTimeMs: number, now = performance.now()): ThermalSnapshot {
    this.frameTimes.push(frameTimeMs);
    if (this.frameTimes.length > this.config.windowSize) {
      this.frameTimes.shift();
    }

    this.sampleCount++;

    // Update EWMA
    if (this.ewma === 0) {
      this.ewma = frameTimeMs;
    } else {
      this.ewma = this.config.ewmaAlpha * frameTimeMs + (1 - this.config.ewmaAlpha) * this.ewma;
    }

    // Compute trend from last 5 frames vs previous 5
    const trend = this.computeTrend();

    // State transitions with hysteresis
    if (this.sampleCount >= this.config.minSamples) {
      this.updateState(now);
    }

    return {
      state: this.state,
      ewmaFrameTimeMs: this.ewma,
      currentFrameTimeMs: frameTimeMs,
      shellQuality: this.shellQuality(),
      trend,
    };
  }

  private computeTrend(): 'improving' | 'stable' | 'degrading' {
    const len = this.frameTimes.length;
    if (len < 10) return 'stable';

    const recent = this.frameTimes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const previous = this.frameTimes.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;

    const delta = recent - previous;
    const threshold = this.config.targetFrameTimeMs * 0.1;

    if (delta < -threshold) return 'improving';
    if (delta > threshold) return 'degrading';
    return 'stable';
  }

  private updateState(now: number): void {
    // Hysteresis: prevent rapid oscillation
    if (now - this.lastStateChangeTime < this.hysteresisMs) return;

    const ratio = this.ewma / this.config.targetFrameTimeMs;

    switch (this.state) {
      case 'normal':
        if (ratio >= this.config.criticalThreshold) {
          this.state = 'critical';
          this.lastStateChangeTime = now;
        } else if (ratio >= this.config.warmingThreshold) {
          this.state = 'warming';
          this.lastStateChangeTime = now;
        }
        break;

      case 'warming':
        if (ratio >= this.config.criticalThreshold) {
          this.state = 'critical';
          this.lastStateChangeTime = now;
        } else if (ratio <= this.config.warmingRestoreThreshold) {
          this.state = 'normal';
          this.lastStateChangeTime = now;
        }
        break;

      case 'critical':
        if (ratio <= this.config.criticalRestoreThreshold) {
          this.state = 'recovering';
          this.lastStateChangeTime = now;
        }
        break;

      case 'recovering':
        if (ratio >= this.config.criticalThreshold) {
          this.state = 'critical';
          this.lastStateChangeTime = now;
        } else if (ratio <= this.config.warmingRestoreThreshold) {
          this.state = 'normal';
          this.lastStateChangeTime = now;
        } else if (ratio <= this.config.warmingThreshold) {
          this.state = 'warming';
          this.lastStateChangeTime = now;
        }
        break;
    }
  }

  /**
   * Map thermal state to shell rendering quality (0-1).
   * Degrades before dropping frames.
   */
  shellQuality(): number {
    switch (this.state) {
      case 'normal':
        return 1.0;
      case 'warming':
        return 0.7;
      case 'recovering':
        return 0.5;
      case 'critical':
        return 0.3;
    }
  }

  /**
   * Get current thermal state.
   */
  getState(): ThermalState {
    return this.state;
  }

  /**
   * Get the EWMA frame time.
   */
  getEwma(): number {
    return this.ewma;
  }

  /**
   * Reset the proxy to initial state.
   */
  reset(): void {
    this.state = 'normal';
    this.frameTimes = [];
    this.ewma = 0;
    this.sampleCount = 0;
    this.lastStateChangeTime = 0;
  }

  /**
   * Get a soft-cap message based on current state.
   */
  sessionMessage(): string | null {
    switch (this.state) {
      case 'normal':
        return null;
      case 'warming':
        return 'Session warming — consider a break soon.';
      case 'recovering':
        return 'Cooling down — quality restoring.';
      case 'critical':
        return 'Thermal limit — quality reduced. End session soon.';
    }
  }
}

/**
 * Factory for creating a thermal proxy with the default config.
 */
export function createThermalProxy(config?: Partial<ThermalConfig>): ThermalProxy {
  return new ThermalProxy(config);
}
