import { XMLParser } from 'fast-xml-parser';
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
  TriStateCircuit
} from '../../simulation/circuits/gates';
import { LabelCircuit } from '../../simulation/circuits/annotation';
import { CoordinateNetlistSolver } from './netlistSolver';
import { LogiclyParser } from '../parser';

export class DigitalAdapter {
  /**
   * Imports a Digital by Helmut Neemann .dig XML circuit document.
   */
  public static importCircuit(
    xmlString: string,
    options?: { parser?: LogiclyParser; idRemap?: Map<string, string> }
  ): ParsedCircuitDocument {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => ['visualElement', 'wire', 'entry', 'string'].includes(name)
    });

    const parsed = parser.parse(xmlString);
    const circuitNode = parsed.circuit || parsed;
    const visualElements = circuitNode.visualElements?.visualElement || circuitNode.visualElement || [];

    const engine = new SimulationEngine();
    const circuits = new Map<string, ICircuit>();
    const metadata = new Map<string, CircuitMetadata>();
    const locations: PinLocationMap = { left: [], right: [], top: [], bottom: [] };
    const solver = new CoordinateNetlistSolver(4);
    const logiclyParser = options?.parser || new LogiclyParser();

    // 1. Parse Visual Elements
    for (const elem of visualElements) {
      const elementName = elem.elementName || '';
      const pos = elem.pos || {};
      const x = parseFloat(pos['@_x'] || '0');
      const y = parseFloat(pos['@_y'] || '0');
      const uid = generateUID();

      const attrs = parseDigitalAttributes(elem.elementAttributes);
      const rot = parseInt(attrs['rotation'] || '0', 10);
      const rotation = rot * 90;

      metadata.set(uid, { x, y, rotation });

      const instance = this.createComponent(elementName, uid, attrs, x, y, logiclyParser, solver);
      if (instance) {
        circuits.set(uid, instance);
        engine.registerCircuit(instance);

        if (instance instanceof SwitchCircuit) {
          locations.left.push(uid);
        } else if (instance instanceof LightBulbCircuit || instance instanceof DigitDisplayCircuit) {
          locations.right.push(uid);
        }
      }
    }

    // 2. Parse Wires
    const wiresNode = circuitNode.wires?.wire || circuitNode.wire || [];
    for (const w of wiresNode) {
      const p1Node = w.p1 || {};
      const p2Node = w.p2 || {};
      const x1 = parseFloat(p1Node['@_x'] || '0');
      const y1 = parseFloat(p1Node['@_y'] || '0');
      const x2 = parseFloat(p2Node['@_x'] || '0');
      const y2 = parseFloat(p2Node['@_y'] || '0');

      solver.addWire({ x: x1, y: y1 }, { x: x2, y: y2 });
    }

    // 3. Solve all nets and wire up components
    solver.solve(engine);

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
    elementName: string,
    uid: string,
    attrs: Record<string, string>,
    x: number,
    y: number,
    logiclyParser: LogiclyParser,
    solver: CoordinateNetlistSolver
  ): ICircuit | null {
    const label = attrs['Label'] || attrs['label'] || '';
    const wideShape = attrs['wideShape'] === 'true';

    switch (elementName) {
      case 'In': {
        const def = attrs['Default'] || attrs['default'] || '0';
        const initial = def === '1' || def === 'true';
        const sw = new SwitchCircuit(initial, uid);
        if (label) {
          sw.label = label;
          sw.exportName = label;
        }

        // Digital In pin is at (x, y)
        solver.addTerminal({ circuit: sw, portIndex: 0, type: 'source', x, y });
        return sw;
      }

      case 'Out': {
        const bulb = new LightBulbCircuit(uid);
        if (label) {
          bulb.label = label;
          bulb.exportName = label;
        }

        // Digital Out pin is at (x, y)
        solver.addTerminal({ circuit: bulb, portIndex: 0, type: 'sink', x, y });
        return bulb;
      }

      case 'Led': {
        const bulb = new LightBulbCircuit(uid);
        if (label) bulb.label = label;
        solver.addTerminal({ circuit: bulb, portIndex: 0, type: 'sink', x, y });
        return bulb;
      }

      case 'Clock': {
        const freq = parseFloat(attrs['Frequency'] || '1');
        const periodMs = freq > 0 ? (1000 / freq) : 1000;
        const clk = new ClockCircuit(periodMs, uid);
        if (label) clk.label = label;

        solver.addTerminal({ circuit: clk, portIndex: 0, type: 'source', x, y });
        return clk;
      }

      case 'Const': {
        const valStr = attrs['Value'] || attrs['val'] || '1';
        const isHigh = valStr !== '0' && valStr !== 'false';
        const c = isHigh ? new ConstantHighCircuit(uid) : new ConstantLowCircuit(uid);
        if (label) c.label = label;

        solver.addTerminal({ circuit: c, portIndex: 0, type: 'source', x, y });
        return c;
      }

      case 'Not': {
        const circuit = new NOTGateCircuit(uid);
        if (label) circuit.label = label;

        const width = wideShape ? 60 : 40;
        // Input at (x, y), output at (x + width, y)
        solver.addTerminal({ circuit, portIndex: 0, type: 'sink', x, y });
        solver.addTerminal({ circuit, portIndex: 0, type: 'source', x: x + width, y });
        return circuit;
      }

      case 'Buffer': {
        const circuit = new BufferGateCircuit(uid);
        if (label) circuit.label = label;

        const width = wideShape ? 60 : 40;
        solver.addTerminal({ circuit, portIndex: 0, type: 'sink', x, y });
        solver.addTerminal({ circuit, portIndex: 0, type: 'source', x: x + width, y });
        return circuit;
      }

      case 'Driver': {
        const circuit = new TriStateCircuit(uid);
        if (label) circuit.label = label;

        // Digital Driver has input at (x - 20, y), control at (x, y + 20), output at (x + 20, y)
        solver.addTerminal({ circuit, portIndex: 0, type: 'sink', x: x - 20, y });
        solver.addTerminal({ circuit, portIndex: 1, type: 'sink', x, y: y + 20 });
        solver.addTerminal({ circuit, portIndex: 0, type: 'source', x: x + 20, y });
        return circuit;
      }

      case 'And':
      case 'Or':
      case 'NAnd':
      case 'NOr':
      case 'XOr':
      case 'XNOr': {
        const inputsCount = Math.max(2, parseInt(attrs['Inputs'] || '2', 10));
        const invert = elementName.startsWith('N') || elementName === 'XNOr';

        let circuit: ICircuit;
        if (elementName === 'And') circuit = new ANDGateCircuit(inputsCount, uid);
        else if (elementName === 'Or') circuit = new ORGateCircuit(inputsCount, uid);
        else if (elementName === 'NAnd') circuit = new NANDGateCircuit(inputsCount, uid);
        else if (elementName === 'NOr') circuit = new NORGateCircuit(inputsCount, uid);
        else if (elementName === 'XOr') circuit = new XORGateCircuit(inputsCount, uid);
        else circuit = new XNORGateCircuit(inputsCount, uid);

        if (label) circuit.label = label;

        const SIZE = 20;
        const offs = Math.floor(inputsCount / 2) * SIZE;

        // Input terminals
        for (let i = 0; i < inputsCount; i++) {
          const correct = (inputsCount % 2 === 0 && i >= inputsCount / 2) ? SIZE : 0;
          const inY = y + i * SIZE + correct;
          solver.addTerminal({
            circuit,
            portIndex: i,
            type: 'sink',
            x,
            y: inY
          });
        }

        // Output terminal
        const outWidth = invert ? (wideShape ? 100 : 80) : (wideShape ? 80 : 60);
        solver.addTerminal({
          circuit,
          portIndex: 0,
          type: 'source',
          x: x + outWidth,
          y: y + offs
        });

        return circuit;
      }

      case 'Seven-Seg-Hex':
      case 'SevenSegHex': {
        const disp = new DigitDisplayCircuit(uid);
        if (label) disp.label = label;

        // Port (data input)
        solver.addTerminal({ circuit: disp, portIndex: 0, type: 'sink', x: x + 40, y: y + 60 });
        // Also support base (x, y)
        solver.addTerminal({ circuit: disp, portIndex: 0, type: 'sink', x, y });
        return disp;
      }

      case 'Button': {
        const btn = new PushButtonCircuit(uid);
        if (label) btn.label = label;
        solver.addTerminal({ circuit: btn, portIndex: 0, type: 'source', x, y });
        return btn;
      }

      case 'Text': {
        const txt = attrs['Description'] || attrs['text'] || label || '';
        return new LabelCircuit(txt, uid);
      }

      case 'D_FF': {
        const ic = logiclyParser.instantiateCustomIC('d_flip_flop@logic.ly', uid, label);
        // Digital D_FF: D at (x, y), Clock at (x, y + 20), Q at (x + 60, y), Q' at (x + 60, y + 20)
        solver.addTerminal({ circuit: ic, portIndex: 0, type: 'sink', x, y });
        solver.addTerminal({ circuit: ic, portIndex: 1, type: 'sink', x, y: y + 20 });
        solver.addTerminal({ circuit: ic, portIndex: 0, type: 'source', x: x + 60, y });
        solver.addTerminal({ circuit: ic, portIndex: 1, type: 'source', x: x + 60, y: y + 20 });
        return ic;
      }

      case 'JK_FF': {
        const ic = logiclyParser.instantiateCustomIC('jk_flip_flop@logic.ly', uid, label);
        // Digital JK_FF: J at (x, y), Clock at (x, y + 20), K at (x, y + 40), Q at (x + 60, y), Q' at (x + 60, y + 20)
        solver.addTerminal({ circuit: ic, portIndex: 0, type: 'sink', x, y });
        solver.addTerminal({ circuit: ic, portIndex: 1, type: 'sink', x, y: y + 20 });
        solver.addTerminal({ circuit: ic, portIndex: 2, type: 'sink', x, y: y + 40 });
        solver.addTerminal({ circuit: ic, portIndex: 0, type: 'source', x: x + 60, y });
        solver.addTerminal({ circuit: ic, portIndex: 1, type: 'source', x: x + 60, y: y + 20 });
        return ic;
      }

      default:
        return null;
    }
  }
}

/**
 * Extracts key-value attribute dictionary from Digital's <elementAttributes><entry>...
 */
function parseDigitalAttributes(elementAttributesNode: any): Record<string, string> {
  const result: Record<string, string> = {};
  if (!elementAttributesNode) return result;

  const entries = elementAttributesNode.entry || [];
  for (const entry of entries) {
    if (!entry) continue;

    let key = '';
    let val = '';

    if (Array.isArray(entry.string)) {
      key = entry.string[0] || '';
      val = entry.string[1] || '';
    } else if (typeof entry.string === 'string') {
      key = entry.string;
      if (entry.int !== undefined) val = String(entry.int);
      else if (entry.boolean !== undefined) val = String(entry.boolean);
      else if (entry.rotation !== undefined) val = String(entry.rotation['@_val'] ?? entry.rotation.val ?? entry.rotation);
      else if (entry['#text'] !== undefined) val = String(entry['#text']);
    }

    if (key) {
      result[key] = val;
    }
  }

  return result;
}
