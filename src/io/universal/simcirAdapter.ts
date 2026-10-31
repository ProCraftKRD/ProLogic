import { ICircuit, IInputCircuit, IOutputCircuit } from '../../simulation/types';
import { SimulationEngine } from '../../simulation/engine';
import { ParsedCircuitDocument, CircuitMetadata } from '../parser';
import { PinLocationMap } from '../../simulation/circuits/complex';
import { generateUID } from '../../simulation/circuits/base';
import { SwitchCircuit, ConstantHighCircuit, ConstantLowCircuit, PushButtonCircuit } from '../../simulation/circuits/controls';
import { LightBulbCircuit, DigitDisplayCircuit } from '../../simulation/circuits/outputs';
import { ClockCircuit } from '../../simulation/circuits/clock';
import {
  ANDGateCircuit,
  ORGateCircuit,
  NOTGateCircuit,
  NANDGateCircuit,
  NORGateCircuit,
  XORGateCircuit,
  XNORGateCircuit,
  BufferGateCircuit,
  TriStateCircuit,
  BusCircuit
} from '../../simulation/circuits/gates';
import { LabelCircuit } from '../../simulation/circuits/annotation';
import { LogiclyParser } from '../parser';

export interface SimcirDevice {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  label?: string;
  state?: { on?: boolean; [key: string]: any };
  numInputs?: number;
  freq?: number;
  [key: string]: any;
}

export interface SimcirConnector {
  from: string | { device: string; port: number };
  to: string | { device: string; port: number };
}

export interface SimcirCircuitDoc {
  width?: number;
  height?: number;
  devices?: SimcirDevice[];
  connectors?: SimcirConnector[];
  [key: string]: any;
}

export class SimcirAdapter {
  /**
   * Imports a SimcirJS JSON document.
   */
  public static importCircuit(
    jsonString: string,
    options?: { parser?: LogiclyParser; idRemap?: Map<string, string> }
  ): ParsedCircuitDocument {
    const data: SimcirCircuitDoc = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;

    const devices = data.devices || [];
    const connectors = data.connectors || [];

    const engine = new SimulationEngine();
    const circuits = new Map<string, ICircuit>();
    const metadata = new Map<string, CircuitMetadata>();
    const locations: PinLocationMap = { left: [], right: [], top: [], bottom: [] };
    const logiclyParser = options?.parser || new LogiclyParser();

    // Map original Simcir device id to circuit
    const devIdToCircuit = new Map<string, ICircuit>();
    const devIdToUid = new Map<string, string>();

    // 1. Create devices
    for (let idx = 0; idx < devices.length; idx++) {
      const dev = devices[idx];
      const devId = dev.id || `dev${idx}`;
      const uid = generateUID();
      const x = parseFloat(String(dev.x ?? 100));
      const y = parseFloat(String(dev.y ?? 100));
      const label = dev.label || '';

      metadata.set(uid, { x, y, rotation: 0 });

      const instance = this.createComponent(dev, uid, label, logiclyParser);
      if (instance) {
        circuits.set(uid, instance);
        engine.registerCircuit(instance);
        devIdToCircuit.set(devId, instance);
        devIdToUid.set(devId, uid);

        if (instance instanceof SwitchCircuit) {
          locations.left.push(uid);
        } else if (instance instanceof LightBulbCircuit || instance instanceof DigitDisplayCircuit) {
          locations.right.push(uid);
        }
      }
    }

    // 2. Connect devices via connectors
    for (const conn of connectors) {
      const fromEndpoint = parseSimcirEndpoint(conn.from);
      const toEndpoint = parseSimcirEndpoint(conn.to);

      if (!fromEndpoint || !toEndpoint) continue;

      let source = devIdToCircuit.get(fromEndpoint.devId);
      let target = devIdToCircuit.get(toEndpoint.devId);
      let srcIdx = Math.max(0, fromEndpoint.portIdx);
      let dstIdx = Math.max(0, toEndpoint.portIdx);

      if (!source || !target) continue;

      // Handle reversed from/to orientation
      if (typeof (source as any).getOutputAt !== 'function' || typeof (target as any).setInputAt !== 'function') {
        if (typeof (target as any).getOutputAt === 'function' && typeof (source as any).setInputAt === 'function') {
          const tmpCircuit = source;
          source = target;
          target = tmpCircuit;
          const tmpIdx = srcIdx;
          srcIdx = dstIdx;
          dstIdx = tmpIdx;
        }
      }

      if (typeof (source as any).getOutputAt === 'function' && typeof (target as any).setInputAt === 'function') {
        engine.connect(source as IOutputCircuit, srcIdx, target as IInputCircuit, dstIdx);
      }
    }

    // Initial propagation
    engine.propagateAll();

    return {
      engine,
      circuits,
      metadata,
      locations
    };
  }

  private static createComponent(
    dev: SimcirDevice,
    uid: string,
    label: string,
    logiclyParser: LogiclyParser
  ): ICircuit | null {
    const rawType = (dev.type || '').toUpperCase();
    const inputsCount = dev.numInputs || 2;

    switch (rawType) {
      case 'TOGGLE': {
        const initial = dev.state?.on === true;
        const sw = new SwitchCircuit(initial, uid);
        if (label) {
          sw.label = label;
          sw.exportName = label;
        }
        return sw;
      }

      case 'DC': {
        const c = new ConstantHighCircuit(uid);
        if (label) c.label = label;
        return c;
      }

      case 'GND': {
        const c = new ConstantLowCircuit(uid);
        if (label) c.label = label;
        return c;
      }

      case 'PUSHOFF':
      case 'PUSHON': {
        const btn = new PushButtonCircuit(uid);
        if (label) btn.label = label;
        return btn;
      }

      case 'AND': {
        const g = new ANDGateCircuit(inputsCount, uid);
        if (label) g.label = label;
        return g;
      }

      case 'OR': {
        const g = new ORGateCircuit(inputsCount, uid);
        if (label) g.label = label;
        return g;
      }

      case 'NOT': {
        const g = new NOTGateCircuit(uid);
        if (label) g.label = label;
        return g;
      }

      case 'NAND': {
        const g = new NANDGateCircuit(inputsCount, uid);
        if (label) g.label = label;
        return g;
      }

      case 'NOR': {
        const g = new NORGateCircuit(inputsCount, uid);
        if (label) g.label = label;
        return g;
      }

      case 'XOR': {
        const g = new XORGateCircuit(inputsCount, uid);
        if (label) g.label = label;
        return g;
      }

      case 'XNOR': {
        const g = new XNORGateCircuit(inputsCount, uid);
        if (label) g.label = label;
        return g;
      }

      case 'BUF': {
        const g = new BufferGateCircuit(uid);
        if (label) g.label = label;
        return g;
      }

      case 'TRISTATE': {
        const g = new TriStateCircuit(uid);
        if (label) g.label = label;
        return g;
      }

      case 'LED':
      case 'LIGHTBULB': {
        const bulb = new LightBulbCircuit(uid);
        if (label) {
          bulb.label = label;
          bulb.exportName = label;
        }
        return bulb;
      }

      case '7SEG':
      case '4BIT7SEG': {
        const disp = new DigitDisplayCircuit(uid);
        if (label) disp.label = label;
        return disp;
      }

      case 'OSCILLATOR': {
        const freq = dev.freq || 1;
        const periodMs = freq > 0 ? (1000 / freq) : 1000;
        const clk = new ClockCircuit(periodMs, uid);
        if (label) clk.label = label;
        return clk;
      }

      case 'BUS': {
        const b = new BusCircuit(inputsCount, uid);
        if (label) b.label = label;
        return b;
      }

      case 'D-FF': {
        return logiclyParser.instantiateCustomIC('d_flip_flop@logic.ly', uid, label);
      }

      case 'JK-FF': {
        return logiclyParser.instantiateCustomIC('jk_flip_flop@logic.ly', uid, label);
      }

      case 'T-FF': {
        return logiclyParser.instantiateCustomIC('t_flip_flop@logic.ly', uid, label);
      }

      case 'SR-FF': {
        return logiclyParser.instantiateCustomIC('sr_flip_flop@logic.ly', uid, label);
      }

      default:
        return null;
    }
  }
}

function parseSimcirEndpoint(endpoint: string | { device: string; port: number }): { devId: string; portIdx: number } | null {
  if (!endpoint) return null;

  if (typeof endpoint === 'object') {
    return {
      devId: endpoint.device,
      portIdx: endpoint.port ?? 0
    };
  }

  // Parse "dev0.out0" or "dev1.in2" or "dev0.0"
  const dotIdx = endpoint.indexOf('.');
  if (dotIdx === -1) {
    return { devId: endpoint, portIdx: 0 };
  }

  const devId = endpoint.substring(0, dotIdx);
  const portPart = endpoint.substring(dotIdx + 1);
  const portDigits = portPart.replace(/\D/g, '');
  const portIdx = portDigits.length > 0 ? parseInt(portDigits, 10) : 0;

  return { devId, portIdx };
}
