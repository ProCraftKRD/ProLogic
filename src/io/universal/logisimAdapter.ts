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
  TriStateCircuit,
  BusCircuit
} from '../../simulation/circuits/gates';
import { LabelCircuit } from '../../simulation/circuits/annotation';
import { CoordinateNetlistSolver, TerminalPort } from './netlistSolver';
import { LogiclyParser } from '../parser';

export class LogisimAdapter {
  /**
   * Imports a Logisim or Logisim-Evolution .circ XML project document.
   */
  public static importCircuit(
    xmlString: string,
    options?: { parser?: LogiclyParser; idRemap?: Map<string, string> }
  ): ParsedCircuitDocument {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => ['circuit', 'comp', 'wire', 'a', 'tool', 'lib'].includes(name)
    });

    const parsed = parser.parse(xmlString);
    const project = parsed.project || parsed;
    const circuitsList = project.circuit || [];

    if (!circuitsList || circuitsList.length === 0) {
      throw new Error('No <circuit> definition found in Logisim .circ project file.');
    }

    // Determine target circuit: main specified in project or first circuit
    let targetCircuit = circuitsList[0];
    const mainAttr = project.main?.['@_name'];
    if (mainAttr) {
      const found = circuitsList.find((c: any) => c['@_name'] === mainAttr);
      if (found) targetCircuit = found;
    }

    const engine = new SimulationEngine();
    const circuits = new Map<string, ICircuit>();
    const metadata = new Map<string, CircuitMetadata>();
    const locations: PinLocationMap = { left: [], right: [], top: [], bottom: [] };
    const solver = new CoordinateNetlistSolver(4);
    const logiclyParser = options?.parser || new LogiclyParser();

    // 1. Parse components (<comp>)
    const comps = targetCircuit.comp || [];
    for (const comp of comps) {
      const rawLoc = comp['@_loc'] || '(0,0)';
      const { x, y } = parseCoord(rawLoc);
      const name = comp['@_name'] || '';
      const uid = generateUID();

      // Extract attributes map from `<a name="..." val="..."/>`
      const attrs: Record<string, string> = {};
      if (comp.a && Array.isArray(comp.a)) {
        for (const a of comp.a) {
          const aName = a['@_name'];
          const aVal = a['@_val'] ?? a['#text'] ?? '';
          if (aName) attrs[aName] = String(aVal);
        }
      }

      const facing = (attrs.facing || 'east').toLowerCase();
      let rotation = 0;
      if (facing === 'north') rotation = 270;
      else if (facing === 'south') rotation = 90;
      else if (facing === 'west') rotation = 180;

      metadata.set(uid, { x, y, rotation });

      const instance = this.createComponent(name, uid, attrs, x, y, logiclyParser, solver);
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

    // 2. Parse wires (<wire from="(x1,y1)" to="(x2,y2)"/>)
    const wires = targetCircuit.wire || [];
    for (const wire of wires) {
      const fromStr = wire['@_from'];
      const toStr = wire['@_to'];
      if (fromStr && toStr) {
        const p1 = parseCoord(fromStr);
        const p2 = parseCoord(toStr);
        solver.addWire(p1, p2);
      }
    }

    // 3. Solve all nets and connect components
    solver.solve(engine);

    // Initial propagation to stabilize logic state
    engine.propagateAll();

    return {
      engine,
      circuits,
      metadata,
      locations
    };
  }

  private static createComponent(
    name: string,
    uid: string,
    attrs: Record<string, string>,
    x: number,
    y: number,
    logiclyParser: LogiclyParser,
    solver: CoordinateNetlistSolver
  ): ICircuit | null {
    const facing = (attrs.facing || 'east').toLowerCase();
    const label = attrs.label || '';

    switch (name) {
      case 'AND Gate':
      case 'OR Gate':
      case 'NAND Gate':
      case 'NOR Gate':
      case 'XOR Gate':
      case 'XNOR Gate': {
        const inputsCount = Math.max(2, parseInt(attrs.inputs || '2', 10));
        const size = parseInt(attrs.size || '50', 10);
        let negatedMask = 0;
        for (let i = 0; i < inputsCount; i++) {
          if (attrs[`negate${i}`] === 'true') {
            negatedMask |= (1 << i);
          }
        }

        let circuit: ICircuit;
        if (name === 'AND Gate') circuit = new ANDGateCircuit(inputsCount, uid);
        else if (name === 'OR Gate') circuit = new ORGateCircuit(inputsCount, uid);
        else if (name === 'NAND Gate') circuit = new NANDGateCircuit(inputsCount, uid);
        else if (name === 'NOR Gate') circuit = new NORGateCircuit(inputsCount, uid);
        else if (name === 'XOR Gate') circuit = new XORGateCircuit(inputsCount, uid);
        else circuit = new XNORGateCircuit(inputsCount, uid);

        if (label) circuit.label = label;

        // Output port 0 is at (x, y)
        solver.addTerminal({
          circuit,
          portIndex: 0,
          type: 'source',
          x,
          y
        });

        // Input ports 0..inputsCount-1
        for (let i = 0; i < inputsCount; i++) {
          const offs = getLogisimInputOffset(inputsCount, size, facing, negatedMask, i, false);
          solver.addTerminal({
            circuit,
            portIndex: i,
            type: 'sink',
            x: x + offs.dx,
            y: y + offs.dy
          });
        }

        return circuit;
      }

      case 'NOT Gate': {
        const size = parseInt(attrs.size || '30', 10);
        const circuit = new NOTGateCircuit(uid);
        if (label) circuit.label = label;

        // Output is at (x, y)
        solver.addTerminal({ circuit, portIndex: 0, type: 'source', x, y });

        // Input is translated along facing direction by -size
        const inOffs = translateDirection(facing, -size);
        solver.addTerminal({ circuit, portIndex: 0, type: 'sink', x: x + inOffs.dx, y: y + inOffs.dy });

        return circuit;
      }

      case 'Buffer': {
        const size = parseInt(attrs.size || '20', 10);
        const circuit = new BufferGateCircuit(uid);
        if (label) circuit.label = label;

        solver.addTerminal({ circuit, portIndex: 0, type: 'source', x, y });
        const inOffs = translateDirection(facing, -size);
        solver.addTerminal({ circuit, portIndex: 0, type: 'sink', x: x + inOffs.dx, y: y + inOffs.dy });

        return circuit;
      }

      case 'Controlled Buffer':
      case 'Controlled Inverter': {
        const size = 20;
        const circuit = new TriStateCircuit(uid);
        if (label) circuit.label = label;

        // Output port 0 is at (x, y)
        solver.addTerminal({ circuit, portIndex: 0, type: 'source', x, y });

        const rev = reverseDirection(facing);

        // Data in port 0 (translated reverse facing by size)
        const dataOffs = translateLogisim(rev, size, 0);
        solver.addTerminal({ circuit, portIndex: 0, type: 'sink', x: x + dataOffs.dx, y: y + dataOffs.dy });

        // Enable in port 1 (located on the side matching Logisim geometry)
        const controlSide = (attrs.control || 'right').toLowerCase();
        const rightDist = controlSide === 'left' ? 10 : -10;
        const ctrlOffs = translateLogisim(rev, 10, rightDist);
        solver.addTerminal({ circuit, portIndex: 1, type: 'sink', x: x + ctrlOffs.dx, y: y + ctrlOffs.dy });

        return circuit;
      }

      case 'Pin': {
        const isOutput = attrs.output === 'true';
        if (isOutput) {
          const bulb = new LightBulbCircuit(uid);
          if (label) {
            bulb.label = label;
            bulb.exportName = label;
          }
          solver.addTerminal({ circuit: bulb, portIndex: 0, type: 'sink', x, y });
          return bulb;
        } else {
          const initial = attrs.initial === '0x1' || attrs.initial === '1' || attrs.value === '1';
          const sw = new SwitchCircuit(initial, uid);
          if (label) {
            sw.label = label;
            sw.exportName = label;
          }
          solver.addTerminal({ circuit: sw, portIndex: 0, type: 'source', x, y });
          return sw;
        }
      }

      case 'Clock': {
        const highDur = parseInt(attrs.highDuration || '1', 10);
        const lowDur = parseInt(attrs.lowDuration || '1', 10);
        const periodMs = (highDur + lowDur) * 500;
        const clk = new ClockCircuit(periodMs, uid);
        if (label) clk.label = label;

        solver.addTerminal({ circuit: clk, portIndex: 0, type: 'source', x, y });
        return clk;
      }

      case 'Constant': {
        const valStr = attrs.value || '0x1';
        const isHigh = valStr === '0x1' || valStr === '1';
        const c = isHigh ? new ConstantHighCircuit(uid) : new ConstantLowCircuit(uid);
        if (label) c.label = label;

        solver.addTerminal({ circuit: c, portIndex: 0, type: 'source', x, y });
        return c;
      }

      case 'LED': {
        const bulb = new LightBulbCircuit(uid);
        if (label) bulb.label = label;
        solver.addTerminal({ circuit: bulb, portIndex: 0, type: 'sink', x, y });
        return bulb;
      }

      case '7-Segment Display':
      case 'Hex Digit Display': {
        const disp = new DigitDisplayCircuit(uid);
        if (label) disp.label = label;

        // Logisim Hex Digit Display has input 0 (data bus/nibble) at (x, y)
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
        const txt = attrs.text || label || '';
        return new LabelCircuit(txt, uid);
      }

      case 'D Flip-Flop': {
        const ic = logiclyParser.instantiateCustomIC('d_flip_flop@logic.ly', uid, label);
        // Ports:
        // Input 0 (D): (x - 40, y)
        // Input 1 (Clock): (x - 40, y + 20)
        // Output 0 (Q): (x, y)
        // Output 1 (Q'): (x, y + 20)
        // Input 2 (PRE'): (x - 30, y + 30)
        // Input 3 (CLR'): (x - 10, y + 30)
        solver.addTerminal({ circuit: ic, portIndex: 0, type: 'sink', x: x - 40, y });
        solver.addTerminal({ circuit: ic, portIndex: 1, type: 'sink', x: x - 40, y: y + 20 });
        solver.addTerminal({ circuit: ic, portIndex: 0, type: 'source', x, y });
        solver.addTerminal({ circuit: ic, portIndex: 1, type: 'source', x, y: y + 20 });
        solver.addTerminal({ circuit: ic, portIndex: 2, type: 'sink', x: x - 30, y: y + 30 });
        solver.addTerminal({ circuit: ic, portIndex: 3, type: 'sink', x: x - 10, y: y + 30 });
        return ic;
      }

      case 'J-K Flip-Flop': {
        const ic = logiclyParser.instantiateCustomIC('jk_flip_flop@logic.ly', uid, label);
        // Ports:
        // Input 0 (J): (x - 40, y)
        // Input 1 (Clock): (x - 40, y + 10)
        // Input 2 (K): (x - 40, y + 20)
        // Output 0 (Q): (x, y)
        // Output 1 (Q'): (x, y + 20)
        // Input 3 (PRE'): (x - 30, y + 30)
        // Input 4 (CLR'): (x - 10, y + 30)
        solver.addTerminal({ circuit: ic, portIndex: 0, type: 'sink', x: x - 40, y });
        solver.addTerminal({ circuit: ic, portIndex: 1, type: 'sink', x: x - 40, y: y + 10 });
        solver.addTerminal({ circuit: ic, portIndex: 2, type: 'sink', x: x - 40, y: y + 20 });
        solver.addTerminal({ circuit: ic, portIndex: 0, type: 'source', x, y });
        solver.addTerminal({ circuit: ic, portIndex: 1, type: 'source', x, y: y + 20 });
        solver.addTerminal({ circuit: ic, portIndex: 3, type: 'sink', x: x - 30, y: y + 30 });
        solver.addTerminal({ circuit: ic, portIndex: 4, type: 'sink', x: x - 10, y: y + 30 });
        return ic;
      }

      case 'T Flip-Flop': {
        const ic = logiclyParser.instantiateCustomIC('t_flip_flop@logic.ly', uid, label);
        solver.addTerminal({ circuit: ic, portIndex: 0, type: 'sink', x: x - 40, y });
        solver.addTerminal({ circuit: ic, portIndex: 1, type: 'sink', x: x - 40, y: y + 20 });
        solver.addTerminal({ circuit: ic, portIndex: 0, type: 'source', x, y });
        solver.addTerminal({ circuit: ic, portIndex: 1, type: 'source', x, y: y + 20 });
        return ic;
      }

      case 'S-R Flip-Flop': {
        const ic = logiclyParser.instantiateCustomIC('sr_flip_flop@logic.ly', uid, label);
        solver.addTerminal({ circuit: ic, portIndex: 0, type: 'sink', x: x - 40, y });
        solver.addTerminal({ circuit: ic, portIndex: 1, type: 'sink', x: x - 40, y: y + 10 });
        solver.addTerminal({ circuit: ic, portIndex: 2, type: 'sink', x: x - 40, y: y + 20 });
        solver.addTerminal({ circuit: ic, portIndex: 0, type: 'source', x, y });
        solver.addTerminal({ circuit: ic, portIndex: 1, type: 'source', x, y: y + 20 });
        return ic;
      }

      default:
        // Unknown or custom component
        return null;
    }
  }
}

/**
 * Parses "(x,y)" string into numerical {x, y} coordinate object.
 */
function parseCoord(coordStr: string): { x: number; y: number } {
  const match = coordStr.match(/\((-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\)/);
  if (match) {
    return {
      x: parseFloat(match[1]),
      y: parseFloat(match[2])
    };
  }
  return { x: 0, y: 0 };
}

/**
 * Calculates gate input pin offset matching Logisim's AbstractGate.getInputOffset.
 */
function getLogisimInputOffset(
  inputs: number,
  size: number,
  facing: string,
  negatedBitmask: number,
  index: number,
  negateOutput: boolean = false
): { dx: number; dy: number } {
  const axisLength = size + (negateOutput ? 10 : 0);
  let skipStart: number;
  let skipDist: number;
  let skipLowerEven: number;

  if (inputs <= 3) {
    if (size < 40) {
      skipStart = -5;
      skipDist = 10;
      skipLowerEven = 10;
    } else if (size < 60 || inputs <= 2) {
      skipStart = -10;
      skipDist = 20;
      skipLowerEven = 20;
    } else {
      skipStart = -15;
      skipDist = 30;
      skipLowerEven = 30;
    }
  } else if (inputs === 4 && size >= 60) {
    skipStart = -5;
    skipDist = 20;
    skipLowerEven = 0;
  } else {
    skipStart = -5;
    skipDist = 10;
    skipLowerEven = 10;
  }

  let dy: number;
  if ((inputs & 1) === 1) {
    dy = skipStart * (inputs - 1) + skipDist * index;
  } else {
    dy = skipStart * inputs + skipDist * index;
    if (index >= inputs / 2) dy += skipLowerEven;
    if (inputs === 4 && size >= 60) dy -= 10;
  }

  let dx = axisLength;
  const isNegated = (negatedBitmask >> index) & 1;
  if (isNegated) {
    dx += 10;
  }

  if (facing === 'north') {
    return { dx: dy, dy: dx };
  } else if (facing === 'south') {
    return { dx: dy, dy: -dx };
  } else if (facing === 'west') {
    return { dx: dx, dy: dy };
  } else {
    return { dx: -dx, dy: dy };
  }
}

function translateDirection(facing: string, distance: number): { dx: number; dy: number } {
  if (facing === 'north') return { dx: 0, dy: -distance };
  if (facing === 'south') return { dx: 0, dy: distance };
  if (facing === 'west') return { dx: -distance, dy: 0 };
  return { dx: distance, dy: 0 };
}

function translateLogisim(dir: string, dist: number, right: number): { dx: number; dy: number } {
  if (dir === 'east') return { dx: dist, dy: right };
  if (dir === 'west') return { dx: -dist, dy: -right };
  if (dir === 'south') return { dx: -right, dy: dist };
  if (dir === 'north') return { dx: right, dy: -dist };
  return { dx: dist, dy: right };
}

function reverseDirection(dir: string): string {
  if (dir === 'east') return 'west';
  if (dir === 'west') return 'east';
  if (dir === 'north') return 'south';
  if (dir === 'south') return 'north';
  return 'west';
}
