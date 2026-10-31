import { OutputOnlyCircuit } from './base';
import { ITickedCircuit } from '../types';

export class ClockCircuit extends OutputOnlyCircuit implements ITickedCircuit {
  private _accumulatedDelta: number = 0;
  private _updateInterval: number = 500; // ms per half-cycle (1000ms period = 1Hz)

  constructor(frequencyMs: number = 1000, uid?: string) {
    super('clock@logic.ly', 1, uid);
    this.frequency = frequencyMs;
    this._outputs[0] = false;
  }

  get frequency(): number {
    return this._updateInterval * 2;
  }

  set frequency(periodMs: number) {
    if (periodMs < 10) periodMs = 10;
    this._updateInterval = periodMs / 2;
  }

  get updateInterval(): number {
    return this._updateInterval;
  }

  public advance(deltaMs: number): void {
    this._accumulatedDelta += deltaMs;
    while (this._accumulatedDelta >= this._updateInterval) {
      const current = Boolean(this.getOutputAt(0));
      this.setOutputAt(0, !current);
      this._accumulatedDelta -= this._updateInterval;
    }
  }

  public reset(): void {
    this._accumulatedDelta = 0;
    this.setOutputAt(0, false);
  }
}
