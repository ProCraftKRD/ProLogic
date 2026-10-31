import {
  ICircuit,
  IInputCircuit,
  IOutputCircuit,
  ITickedCircuit,
  LogicConnection,
  QueueItem,
  LogicValue
} from './types';

export class SimulationEngine {
  private _circuits: Set<ICircuit> = new Set();
  private _tickedCircuits: Set<ITickedCircuit> = new Set();
  private _connections: LogicConnection[] = [];

  private _propagationQueue: QueueItem[] = [];
  private _backupQueue: QueueItem[] = [];
  private _queueItemPool: QueueItem[] = [];

  public isRunning: boolean = true;
  public stopAllPropagation: boolean = false;
  public maxPropagationStepsPerTick: number = 500; // Oscillation runaway guard
  public defaultFloatSignal: LogicValue = undefined;

  public onOutputChangeDispatched?: (circuit: IOutputCircuit, outputIndex: number, value: LogicValue) => void;

  constructor() {}

  get circuits(): ICircuit[] {
    return Array.from(this._circuits);
  }

  get connections(): LogicConnection[] {
    return [...this._connections];
  }

  public setDefaultFloatSignal(signal: 'undefined' | 'false' | 'true' | LogicValue): void {
    if (signal === 'true' || signal === true) {
      this.defaultFloatSignal = true;
    } else if (signal === 'false' || signal === false) {
      this.defaultFloatSignal = false;
    } else {
      this.defaultFloatSignal = undefined;
    }

    // Iterate through all registered circuits with inputs
    for (const circuit of this._circuits) {
      const inCircuit = circuit as unknown as IInputCircuit;
      if (inCircuit.inputsCount !== undefined && typeof inCircuit.setInputAt === 'function') {
        for (let i = 0; i < inCircuit.inputsCount; i++) {
          const hasConn = this._connections.some(
            (c) => c.inputCircuit === inCircuit && c.inputIndex === i
          );
          if (!hasConn) {
            inCircuit.setInputAt(i, this.defaultFloatSignal);
          }
        }
      }
      if ('internalEngine' in circuit && (circuit as any).internalEngine instanceof SimulationEngine) {
        (circuit as any).internalEngine.setDefaultFloatSignal(signal);
      }
    }

    // Step and propagate any resulting output changes
    this.propagateAll();
  }

  public registerCircuit(circuit: ICircuit): void {
    if (this._circuits.has(circuit)) return;
    this._circuits.add(circuit);

    // Check if clocked / ticked
    if ('advance' in circuit && typeof (circuit as any).advance === 'function') {
      this._tickedCircuits.add(circuit as unknown as ITickedCircuit);
    }

    // Initialize unconnected inputs with defaultFloatSignal
    const inCircuit = circuit as unknown as IInputCircuit;
    if (inCircuit.inputsCount !== undefined && typeof inCircuit.setInputAt === 'function') {
      for (let i = 0; i < inCircuit.inputsCount; i++) {
        const hasConn = this._connections.some(
          (c) => c.inputCircuit === inCircuit && c.inputIndex === i
        );
        if (!hasConn) {
          inCircuit.setInputAt(i, this.defaultFloatSignal);
        }
      }
    }

    if ('internalEngine' in circuit && (circuit as any).internalEngine instanceof SimulationEngine) {
      (circuit as any).internalEngine.setDefaultFloatSignal(this.defaultFloatSignal);
    }

    // Attach output listener if circuit has outputs
    const outCircuit = circuit as IOutputCircuit;
    if (outCircuit.outputsCount !== undefined) {
      outCircuit.onOutputChange = (c, outputIndex) => {
        this.circuit_onOutputChange(c, outputIndex);
      };
      // Queue initial outputs for propagation
      for (let i = 0; i < outCircuit.outputsCount; i++) {
        this.circuit_onOutputChange(outCircuit, i);
      }
    }
  }

  public unregisterCircuit(circuit: ICircuit): void {
    if (!this._circuits.has(circuit)) return;
    this.disconnectAll(circuit);
    this._circuits.delete(circuit);

    if (this._tickedCircuits.has(circuit as any)) {
      this._tickedCircuits.delete(circuit as any);
    }

    const outCircuit = circuit as IOutputCircuit;
    if (outCircuit.onOutputChange) {
      outCircuit.onOutputChange = undefined;
    }
  }

  public connect(
    outputCircuit: IOutputCircuit,
    outputIndex: number,
    inputCircuit: IInputCircuit,
    inputIndex: number,
    points?: Array<{ x: number; y: number }>
  ): LogicConnection {
    // Standard inputs only allow 1 incoming connection
    this.disconnectInput(inputCircuit, inputIndex);

    const conn: LogicConnection = {
      outputCircuit,
      outputIndex,
      inputCircuit,
      inputIndex,
      points: points ? [...points] : undefined
    };

    this._connections.push(conn);

    // Immediately push current output value to the connected input
    const initialVal = outputCircuit.getOutputAt(outputIndex);
    inputCircuit.setInputAt(inputIndex, initialVal);

    return conn;
  }

  public disconnect(connection: LogicConnection): void {
    const idx = this._connections.indexOf(connection);
    if (idx !== -1) {
      this._connections.splice(idx, 1);
      // Floating / disconnected input receives defaultFloatSignal
      connection.inputCircuit.setInputAt(connection.inputIndex, this.defaultFloatSignal);
    }
  }

  public disconnectInput(inputCircuit: IInputCircuit, inputIndex: number): void {
    for (let i = this._connections.length - 1; i >= 0; i--) {
      const conn = this._connections[i];
      if (conn.inputCircuit === inputCircuit && conn.inputIndex === inputIndex) {
        this.disconnect(conn);
      }
    }
  }

  public disconnectOutput(outputCircuit: IOutputCircuit, outputIndex: number): void {
    for (let i = this._connections.length - 1; i >= 0; i--) {
      const conn = this._connections[i];
      if (conn.outputCircuit === outputCircuit && conn.outputIndex === outputIndex) {
        this.disconnect(conn);
      }
    }
  }

  public disconnectAll(circuit: ICircuit): void {
    for (let i = this._connections.length - 1; i >= 0; i--) {
      const conn = this._connections[i];
      if (conn.outputCircuit === circuit || conn.inputCircuit === circuit) {
        this.disconnect(conn);
      }
    }
  }

  public circuit_onOutputChange(circuit: IOutputCircuit, outputIndex: number): void {
    if (this.stopAllPropagation) return;
    this.addToPropagationQueueIfNotPresent(circuit, outputIndex);
    if (this.onOutputChangeDispatched) {
      this.onOutputChangeDispatched(circuit, outputIndex, circuit.getOutputAt(outputIndex));
    }
  }

  private addToPropagationQueueIfNotPresent(circuit: IOutputCircuit, outputIndex: number): void {
    for (const item of this._propagationQueue) {
      if (item.circuit === circuit && item.outputIndex === outputIndex) {
        return; // Already queued
      }
    }
    const item = this._queueItemPool.pop() || { circuit, outputIndex };
    item.circuit = circuit;
    item.outputIndex = outputIndex;
    this._propagationQueue.push(item);
  }

  public propagateNext(): boolean {
    if (this._propagationQueue.length === 0) return false;

    // Swap queues
    const queueToProcess = this._propagationQueue;
    this._propagationQueue = this._backupQueue;
    this._backupQueue = queueToProcess;

    while (queueToProcess.length > 0) {
      const item = queueToProcess.shift()!;
      const value = item.circuit.getOutputAt(item.outputIndex);

      // Distribute to all connected inputs
      for (const conn of this._connections) {
        if (conn.outputCircuit === item.circuit && conn.outputIndex === item.outputIndex) {
          conn.inputCircuit.setInputAt(conn.inputIndex, value);
        }
      }

      this._queueItemPool.push(item);
    }

    return true;
  }

  public propagateAll(): number {
    let steps = 0;
    while (this.propagateNext() && steps < this.maxPropagationStepsPerTick) {
      steps++;
    }
    return steps;
  }

  public advance(deltaMs: number): void {
    if (!this.isRunning) return;

    // 1. Advance all clocked elements
    for (const clocked of this._tickedCircuits) {
      clocked.advance(deltaMs);
    }

    // 2. Propagate changes throughout the entire circuit
    this.propagateAll();
  }

  public step(): void {
    this.propagateAll();
  }

  public reset(): void {
    this._propagationQueue.length = 0;
    this._backupQueue.length = 0;
    const previousStop = this.stopAllPropagation;
    this.stopAllPropagation = true;

    // 1. Reset all registered circuits (clocks, switches, push buttons, complex circuits)
    for (const circuit of this._circuits) {
      if ('reset' in circuit && typeof (circuit as any).reset === 'function') {
        (circuit as any).reset();
      }
    }

    // 2. Multi-pass stabilization for sequential, cascading, and ripple dependencies
    const passes = Math.max(4, Math.min(this._circuits.size, 16));
    for (let p = 0; p < passes; p++) {
      for (const conn of this._connections) {
        const val = conn.outputCircuit.getOutputAt(conn.outputIndex);
        conn.inputCircuit.setInputAt(conn.inputIndex, val);
      }
      for (const circuit of this._circuits) {
        if ('reset' in circuit && typeof (circuit as any).reset === 'function') {
          (circuit as any).reset();
        }
      }
    }

    // 3. Push final steady-state outputs to all connections
    for (const conn of this._connections) {
      const val = conn.outputCircuit.getOutputAt(conn.outputIndex);
      conn.inputCircuit.setInputAt(conn.inputIndex, val);
    }

    this._propagationQueue.length = 0;
    this._backupQueue.length = 0;
    this.stopAllPropagation = previousStop;

    // 4. Settle combinational logic to quiescence at t=0
    this.propagateAll();
  }
}
