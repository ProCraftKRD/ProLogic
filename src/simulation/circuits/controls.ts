import { OutputOnlyCircuit } from './base';
import { LogicValue } from '../types';

export class SwitchCircuit extends OutputOnlyCircuit {
  private _state: boolean = false;
  private _defaultState: boolean = false;

  constructor(initialState: boolean = false, uid?: string) {
    super('switch@logic.ly', 1, uid);
    this._state = initialState;
    this._defaultState = initialState;
    this._outputs[0] = this._state;
  }

  get state(): boolean {
    return this._state;
  }

  set state(value: boolean) {
    this.toggle(value);
  }

  get defaultState(): boolean {
    return this._defaultState;
  }

  set defaultState(value: boolean) {
    this._defaultState = value;
  }

  public toggle(forceValue?: boolean): void {
    const next = forceValue !== undefined ? forceValue : !this._state;
    if (this._state !== next) {
      this._state = next;
      this.setOutputAt(0, this._state);
    }
  }

  public reset(): void {
    this.toggle(this._defaultState);
  }
}

export class PushButtonCircuit extends OutputOnlyCircuit {
  private _pressed: boolean = false;

  constructor(uid?: string) {
    super('push_button@logic.ly', 1, uid);
    this._outputs[0] = false;
  }

  get isPressed(): boolean {
    return this._pressed;
  }

  public press(): void {
    if (!this._pressed) {
      this._pressed = true;
      this.setOutputAt(0, true);
    }
  }

  public release(): void {
    if (this._pressed) {
      this._pressed = false;
      this.setOutputAt(0, false);
    }
  }

  public reset(): void {
    this.release();
  }
}

export class ConstantHighCircuit extends OutputOnlyCircuit {
  constructor(uid?: string) {
    super('constant_high@logic.ly', 1, uid);
    this._outputs[0] = true;
  }

  override setOutputAt(index: number, value: LogicValue): void {
    // Constant high cannot be altered
  }
}

export class ConstantLowCircuit extends OutputOnlyCircuit {
  constructor(uid?: string) {
    super('constant_low@logic.ly', 1, uid);
    this._outputs[0] = false;
  }

  override setOutputAt(index: number, value: LogicValue): void {
    // Constant low cannot be altered
  }
}
