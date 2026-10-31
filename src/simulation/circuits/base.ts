import {
  ICircuit,
  IInputCircuit,
  IOutputCircuit,
  IIOCircuit,
  IVariableInputCircuit,
  IEditableOutputCircuit,
  LogicValue
} from '../types';

let nextAutoId = 1;
export function generateUID(): string {
  // Generates 8-4-4-4-12 hex UUID format compatible with Logicly's mx.utils.UIDUtil
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1).toUpperCase();
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

export abstract class BaseCircuit implements ICircuit {
  public uid: string;
  public type: string;
  public label?: string;
  public exportName?: string;

  constructor(type: string, uid?: string) {
    this.type = type;
    this.uid = uid || generateUID();
  }
}

export class InputOnlyCircuit extends BaseCircuit implements IInputCircuit {
  protected _inputs: LogicValue[];

  constructor(type: string, inputCount: number = 1, uid?: string) {
    super(type, uid);
    this._inputs = new Array(inputCount).fill(undefined);
  }

  get inputsCount(): number {
    return this._inputs.length;
  }

  getInputAt(index: number): LogicValue {
    return this._inputs[index];
  }

  setInputAt(index: number, value: LogicValue): void {
    if (index >= 0 && index < this._inputs.length) {
      if (this._inputs[index] !== value) {
        this._inputs[index] = value;
        this.onInputChange(index, value);
      }
    }
  }

  protected onInputChange(index: number, value: LogicValue): void {
    // Subclasses can react to input changes
  }
}

export class OutputOnlyCircuit extends BaseCircuit implements IOutputCircuit, IEditableOutputCircuit {
  protected _outputs: LogicValue[];
  public onOutputChange?: (circuit: IOutputCircuit, outputIndex: number) => void;

  constructor(type: string, outputCount: number = 1, uid?: string) {
    super(type, uid);
    this._outputs = new Array(outputCount).fill(undefined);
  }

  get outputsCount(): number {
    return this._outputs.length;
  }

  getOutputAt(index: number): LogicValue {
    return this._outputs[index];
  }

  setOutputAt(index: number, value: LogicValue): void {
    if (index >= 0 && index < this._outputs.length) {
      if (this._outputs[index] !== value) {
        this._outputs[index] = value;
        if (this.onOutputChange) {
          this.onOutputChange(this, index);
        }
      }
    }
  }
}

export type LogicOp = (...inputs: LogicValue[]) => LogicValue;

export class LogicFunctionCircuit extends BaseCircuit implements IIOCircuit, IVariableInputCircuit {
  protected _inputs: LogicValue[];
  protected _outputs: LogicValue[];
  protected _operation: LogicOp;
  public onOutputChange?: (circuit: IOutputCircuit, outputIndex: number) => void;

  constructor(type: string, operation: LogicOp, inputCount: number = 2, uid?: string) {
    super(type, uid);
    this._operation = operation;
    this._inputs = new Array(inputCount).fill(undefined);
    this._outputs = [undefined];
    this.recompute();
  }

  get inputsCount(): number {
    return this._inputs.length;
  }

  setInputsCount(count: number): void {
    if (count < 1) count = 1;
    if (count === this._inputs.length) return;
    const old = this._inputs;
    this._inputs = new Array(count).fill(undefined);
    for (let i = 0; i < Math.min(old.length, count); i++) {
      this._inputs[i] = old[i];
    }
    this.recompute();
  }

  getInputAt(index: number): LogicValue {
    return this._inputs[index];
  }

  setInputAt(index: number, value: LogicValue): void {
    if (index >= 0 && index < this._inputs.length) {
      if (this._inputs[index] !== value) {
        this._inputs[index] = value;
        this.recompute();
      }
    }
  }

  get outputsCount(): number {
    return this._outputs.length;
  }

  getOutputAt(index: number): LogicValue {
    return this._outputs[index];
  }

  protected recompute(): void {
    const nextVal = this._operation(...this._inputs);
    if (this._outputs[0] !== nextVal) {
      this._outputs[0] = nextVal;
      if (this.onOutputChange) {
        this.onOutputChange(this, 0);
      }
    }
  }
}

export class MultiLogicFunctionCircuit extends LogicFunctionCircuit {
  protected _secondaryOp?: LogicOp;
  protected _functionIndex: number = 0;

  constructor(
    type: string,
    primaryOp: LogicOp,
    secondaryOp?: LogicOp,
    inputCount: number = 2,
    uid?: string,
    functionIndex: number = 0
  ) {
    super(type, primaryOp, inputCount, uid);
    this._secondaryOp = secondaryOp;
    this._functionIndex = functionIndex;
    this.recompute();
  }

  get functionIndex(): number {
    return this._functionIndex;
  }

  set functionIndex(value: number) {
    if (this._functionIndex !== value) {
      this._functionIndex = value;
      this.recompute();
    }
  }

  protected override recompute(): void {
    const op = (this._functionIndex === 1 && this._secondaryOp) ? this._secondaryOp : this._operation;
    const nextVal = op(...this._inputs);
    if (this._outputs[0] !== nextVal) {
      this._outputs[0] = nextVal;
      if (this.onOutputChange) {
        this.onOutputChange(this, 0);
      }
    }
  }
}
