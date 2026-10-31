/**
 * ProLogic Core Types
 * Clean-room multi-valued discrete simulation specification
 */

export type LogicValue = boolean | undefined;

export interface ICircuit {
  uid: string;
  type: string;
  label?: string;
  exportName?: string;
}

export interface IInputCircuit extends ICircuit {
  readonly inputsCount: number;
  getInputAt(index: number): LogicValue;
  setInputAt(index: number, value: LogicValue): void;
}

export interface IOutputCircuit extends ICircuit {
  readonly outputsCount: number;
  getOutputAt(index: number): LogicValue;
  onOutputChange?: (circuit: IOutputCircuit, outputIndex: number) => void;
}

export interface IIOCircuit extends IInputCircuit, IOutputCircuit {}

export interface IVariableInputCircuit extends IInputCircuit {
  setInputsCount(count: number): void;
}

export interface IEditableOutputCircuit extends IOutputCircuit {
  setOutputAt(index: number, value: LogicValue): void;
}

export interface ITickedCircuit extends ICircuit {
  advance(deltaMs: number): void;
  reset(): void;
}

export interface IReleasableCircuit extends ICircuit {
  release(): void;
}

export interface LogicConnection {
  outputCircuit: IOutputCircuit;
  outputIndex: number;
  inputCircuit: IInputCircuit;
  inputIndex: number;
  points?: Array<{ x: number; y: number }>;
}

export interface QueueItem {
  circuit: IOutputCircuit;
  outputIndex: number;
}
