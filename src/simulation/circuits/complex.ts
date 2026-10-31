import { BaseCircuit } from './base';
import {
  IIOCircuit,
  IOutputCircuit,
  LogicValue,
  IReleasableCircuit,
  ICircuit
} from '../types';
import { SimulationEngine } from '../engine';
import { SwitchCircuit } from './controls';
import { LightBulbCircuit } from './outputs';

export interface PinLocationMap {
  left: string[];   // Array of component UIDs
  right: string[];
  top: string[];
  bottom: string[];
}

export class ComplexCircuit extends BaseCircuit implements IIOCircuit, IReleasableCircuit {
  private _internalEngine: SimulationEngine;
  private _inputSwitches: SwitchCircuit[] = [];
  private _outputBulbs: LightBulbCircuit[] = [];
  private _locationMap: PinLocationMap = {
    left: [],
    right: [],
    top: [],
    bottom: []
  };

  public onOutputChange?: (circuit: IOutputCircuit, outputIndex: number) => void;
  private _isReleased: boolean = false;

  constructor(
    type: string,
    internalEngine: SimulationEngine,
    inputSwitches: SwitchCircuit[],
    outputBulbs: LightBulbCircuit[],
    locationMap?: PinLocationMap,
    uid?: string,
    label?: string
  ) {
    super(type, uid);
    if (!label && (type === 'rs_flip_flop@logic.ly' || type === 'sr_flip_flop@logic.ly')) {
      this.label = 'SR FLIP FLOP';
    } else if (label === 'RS FLIP FLOP' || label === 'RS Flip-Flop' || label === 'rs_flip_flop') {
      this.label = 'SR FLIP FLOP';
    } else {
      this.label = label;
    }
    this._internalEngine = internalEngine;
    this._inputSwitches = [...inputSwitches];
    this._outputBulbs = [...outputBulbs];
    if (locationMap) {
      this._locationMap = {
        left: [...locationMap.left],
        right: [...locationMap.right],
        top: [...locationMap.top],
        bottom: [...locationMap.bottom]
      };
    }

    // Monitor internal light bulbs to notify external listeners when an output changes
    this._outputBulbs.forEach((bulb, idx) => {
      // LightBulb has an input; when input changes, notify external circuit
      const originalSetInput = bulb.setInputAt.bind(bulb);
      bulb.setInputAt = (index: number, val: LogicValue) => {
        const oldVal = bulb.getInputAt(0);
        originalSetInput(index, val);
        if (oldVal !== val && this.onOutputChange) {
          this.onOutputChange(this, idx);
        }
      };
    });

    // Run initial propagation pass for internal circuits
    this._internalEngine.propagateAll();
  }

  get isReleased(): boolean {
    return this._isReleased;
  }

  get internalEngine(): SimulationEngine {
    return this._internalEngine;
  }

  get locationMap(): PinLocationMap {
    return this._locationMap;
  }

  get inputsCount(): number {
    return this._inputSwitches.length;
  }

  getInputAt(index: number): LogicValue {
    if (index >= 0 && index < this._inputSwitches.length) {
      return this._inputSwitches[index].getOutputAt(0);
    }
    return undefined;
  }

  setInputAt(index: number, value: LogicValue): void {
    if (index >= 0 && index < this._inputSwitches.length) {
      const sw = this._inputSwitches[index];
      sw.setOutputAt(0, value);
      this._internalEngine.propagateAll();
    }
  }

  get outputsCount(): number {
    return this._outputBulbs.length;
  }

  getOutputAt(index: number): LogicValue {
    if (index >= 0 && index < this._outputBulbs.length) {
      return this._outputBulbs[index].getInputAt(0);
    }
    return undefined;
  }

  getInputExportNameAt(index: number): string | undefined {
    return this._inputSwitches[index]?.exportName;
  }

  getOutputExportNameAt(index: number): string | undefined {
    return this._outputBulbs[index]?.exportName;
  }

  public release(): void {
    this._isReleased = true;
    for (const c of this._internalEngine.circuits) {
      this._internalEngine.unregisterCircuit(c);
    }
  }

  public reset(): void {
    // 1. Recursively reset internal engine
    this._internalEngine.reset();

    // 2. Reset internal switches to default state
    for (const sw of this._inputSwitches) {
      if (typeof (sw as any).reset === 'function') {
        (sw as any).reset();
      }
    }

    // 3. For flip-flop subcircuits, stabilize to quiescent state (Q=0, Q'=1)
    const clrSw = this._internalEngine.circuits.find(
      (c) => (c.exportName === "CLR'" || c.exportName === 'CLR') && c.type.includes('switch')
    );
    if (clrSw && 'setOutputAt' in clrSw) {
      (clrSw as any).setOutputAt(0, false);
      this._internalEngine.propagateAll();
      (clrSw as any).setOutputAt(0, true);
      this._internalEngine.propagateAll();
    }
    const rSw = this._internalEngine.circuits.find(
      (c) => c.exportName === 'R' && c.type.includes('switch')
    );
    if (rSw && 'setOutputAt' in rSw) {
      (rSw as any).setOutputAt(0, true);
      this._internalEngine.propagateAll();
      (rSw as any).setOutputAt(0, false);
      this._internalEngine.propagateAll();
    }

    // 4. Ensure output bulbs reflect quiescent state
    for (const c of this._internalEngine.circuits) {
      if (c.exportName === 'Q' && c.type.includes('light_bulb')) {
        (c as any).setInputAt(0, false);
      }
      if (c.exportName === "Q'" && c.type.includes('light_bulb')) {
        (c as any).setInputAt(0, true);
      }
    }
  }
}
