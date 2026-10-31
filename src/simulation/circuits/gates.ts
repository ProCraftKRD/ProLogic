import {
  LogicFunctionCircuit,
  MultiLogicFunctionCircuit,
  BaseCircuit
} from './base';
import { IIOCircuit, LogicValue, IOutputCircuit } from '../types';
import * as ops from '../operations';

export class ANDGateCircuit extends LogicFunctionCircuit {
  constructor(inputs: number = 2, uid?: string) {
    super('and@logic.ly', ops.and, inputs, uid);
  }
}

export class ORGateCircuit extends LogicFunctionCircuit {
  constructor(inputs: number = 2, uid?: string) {
    super('or@logic.ly', ops.or, inputs, uid);
  }
}

export class NOTGateCircuit extends LogicFunctionCircuit {
  constructor(uid?: string) {
    super('not@logic.ly', (i) => ops.not(i), 1, uid);
  }
}

export class NANDGateCircuit extends LogicFunctionCircuit {
  constructor(inputs: number = 2, uid?: string) {
    super('nand@logic.ly', ops.nand, inputs, uid);
  }
}

export class NORGateCircuit extends LogicFunctionCircuit {
  constructor(inputs: number = 2, uid?: string) {
    super('nor@logic.ly', ops.nor, inputs, uid);
  }
}

export class XORGateCircuit extends MultiLogicFunctionCircuit {
  constructor(inputs: number = 2, uid?: string, functionIndex: number = 0) {
    super('xor@logic.ly', ops.xor, ops.xor2, inputs, uid, functionIndex);
  }
}

export class XNORGateCircuit extends MultiLogicFunctionCircuit {
  constructor(inputs: number = 2, uid?: string, functionIndex: number = 0) {
    super('xnor@logic.ly', ops.xnor, ops.xnor2, inputs, uid, functionIndex);
  }
}

export class BufferGateCircuit extends LogicFunctionCircuit {
  constructor(uid?: string) {
    super('buffer@logic.ly', (i) => ops.buffer(i), 1, uid);
  }
}

export class TriStateCircuit extends BaseCircuit implements IIOCircuit {
  private _input: LogicValue = undefined;
  private _enable: LogicValue = undefined;
  private _output: LogicValue = undefined;
  public onOutputChange?: (circuit: IOutputCircuit, outputIndex: number) => void;

  constructor(uid?: string) {
    super('tri-state@logic.ly', uid);
  }

  get inputsCount(): number {
    return 2; // [0] = Data Input, [1] = Enable Control
  }

  getInputAt(index: number): LogicValue {
    return index === 0 ? this._input : this._enable;
  }

  setInputAt(index: number, value: LogicValue): void {
    if (index === 0) {
      if (this._input !== value) {
        this._input = value;
        this.recompute();
      }
    } else if (index === 1) {
      if (this._enable !== value) {
        this._enable = value;
        this.recompute();
      }
    }
  }

  get outputsCount(): number {
    return 1;
  }

  getOutputAt(index: number): LogicValue {
    return this._output;
  }

  private recompute(): void {
    const nextVal = ops.triState(this._input, this._enable);
    if (this._output !== nextVal) {
      this._output = nextVal;
      if (this.onOutputChange) {
        this.onOutputChange(this, 0);
      }
    }
  }
}

export class BusCircuit extends LogicFunctionCircuit {
  constructor(inputs: number = 4, uid?: string) {
    super('bus@logic.ly', ops.bus, inputs, uid);
    this.label = 'BUS';
  }
}
