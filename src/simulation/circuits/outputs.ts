import { InputOnlyCircuit } from './base';
import { LogicValue } from '../types';

export class LightBulbCircuit extends InputOnlyCircuit {
  constructor(uid?: string) {
    super('light_bulb@logic.ly', 1, uid);
  }

  get isOn(): boolean {
    return this._inputs[0] === true;
  }

  get state(): LogicValue {
    return this._inputs[0];
  }
}

export class DigitDisplayCircuit extends InputOnlyCircuit {
  constructor(uid?: string) {
    super('digit@logic.ly', 4, uid);
  }

  /**
   * Calculates the numeric value (0 to 15) represented by the 4 inputs.
   * Input [0] = Bit 0 (LSB)
   * Input [1] = Bit 1
   * Input [2] = Bit 2
   * Input [3] = Bit 3 (MSB)
   * Returns null if any bit is undefined.
   */
  get numericValue(): number | null {
    let val = 0;
    for (let i = 0; i < 4; i++) {
      const bit = this._inputs[i];
      if (bit === undefined || bit === null) {
        return null;
      }
      if (bit === true) {
        val |= (1 << i);
      }
    }
    return val;
  }

  get hexChar(): string {
    const num = this.numericValue;
    if (num === null) return '-';
    return num.toString(16).toUpperCase();
  }
}
