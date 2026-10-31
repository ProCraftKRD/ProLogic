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

export class CircuitVerseAdapter {
  /**
   * Imports a CircuitVerse .cdd, .cv, or JSON project document.
   */
  public static importCircuit(
    jsonString: string,
    options?: { parser?: LogiclyParser; idRemap?: Map<string, string> }
  ): ParsedCircuitDocument {
    const data: any = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;

    // Pick target scope: focused scope or first scope, or data itself if flat
    let targetScope = data;
    if (data.scopes && Array.isArray(data.scopes) && data.scopes.length > 0) {
      const idx = data.focussedCircuit !== undefined && data.scopes[data.focussedCircuit]
        ? data.focussedCircuit
        : 0;
      targetScope = data.scopes[idx] || data.scopes[0];
    }

    const engine = new SimulationEngine();
    const circuits = new Map<string, ICircuit>();
    const metadata = new Map<string, CircuitMetadata>();
    const locations: PinLocationMap = { left: [], right: [], top: [], bottom: [] };
    const solver = new CoordinateNetlistSolver(6);
    const logiclyParser = options?.parser || new LogiclyParser();

    // Collect all elements from scope
    const rawElements: any[] = [];
    if (Array.isArray(targetScope.allElementList)) {
      rawElements.push(...targetScope.allElementList);
    }

    // Also collect categorized module lists (e.g. scope.AndGate, scope.Input, etc.)
    const knownModuleKeys = [
      'Input', 'Output', 'AndGate', 'OrGate', 'NotGate', 'NandGate', 'NorGate',
      'XorGate', 'XnorGate', 'Buffer', 'TriState', 'Clock', 'ConstantVal',
      'SevenSegDisplay', 'HexDisplay', 'Button', 'Text', 'DflipFlop', 'JKflipFlop',
      'TflipFlop', 'SRflipFlop'
    ];

    for (const key of knownModuleKeys) {
      if (Array.isArray(targetScope[key])) {
        for (const elem of targetScope[key]) {
          rawElements.push({ ...elem, objectType: elem.objectType || key });
        }
      }
    }

    // If still empty, check for elements/devices array
    if (rawElements.length === 0) {
      if (Array.isArray(targetScope.elements)) rawElements.push(...targetScope.elements);
      if (Array.isArray(targetScope.devices)) rawElements.push(...targetScope.devices);
    }

    // Collect nodes if graph model
    const allNodes: any[] = Array.isArray(targetScope.allNodes) ? targetScope.allNodes : [];

    // Map element node index to circuit port
    interface ElementNodeRef {
      circuit: ICircuit;
      portIndex: number;
      type: 'source' | 'sink';
      nodeIndex?: number;
      x: number;
      y: number;
    }
    const nodeRefs: ElementNodeRef[] = [];
    const elementIdMap: Map<string, ICircuit> = new Map();

    // 1. Instantiate Elements
    for (let i = 0; i < rawElements.length; i++) {
      const elem = rawElements[i];
      const type = elem.objectType || elem.type || elem.name || '';
      const uid = generateUID();
      const elemId = elem.id || elem.customId || `elem_${i}`;
      const x = parseFloat(String(elem.x ?? 100));
      const y = parseFloat(String(elem.y ?? 100));
      const label = elem.label || '';

      metadata.set(uid, { x, y, rotation: 0 });

      const instance = this.createComponent(type, uid, elem, label, logiclyParser);
      if (instance) {
        circuits.set(uid, instance);
        engine.registerCircuit(instance);
        elementIdMap.set(elemId, instance);

        if (instance instanceof SwitchCircuit) {
          locations.left.push(uid);
        } else if (instance instanceof LightBulbCircuit || instance instanceof DigitDisplayCircuit) {
          locations.right.push(uid);
        }

        // Register element terminals from customData.nodes or node references
        this.extractElementTerminals(elem, instance, x, y, allNodes, nodeRefs, solver);
      }
    }

    // 2. Resolve Connections
    // Strategy A: allNodes graph connectivity
    if (allNodes.length > 0 && nodeRefs.some((r) => r.nodeIndex !== undefined)) {
      // Disjoint-set on allNodes indices
      const nodeParent = new Int32Array(allNodes.length);
      for (let i = 0; i < allNodes.length; i++) nodeParent[i] = i;

      function findNode(i: number): number {
        let r = i;
        while (nodeParent[r] !== r) r = nodeParent[r];
        let c = i;
        while (c !== r) {
          const n = nodeParent[c];
          nodeParent[c] = r;
          c = n;
        }
        return r;
      }

      function unionNodes(i: number, j: number): void {
        const rootI = findNode(i);
        const rootJ = findNode(j);
        if (rootI !== rootJ) nodeParent[rootI] = rootJ;
      }

      // Connect nodes via allNodes[i].connections
      for (let i = 0; i < allNodes.length; i++) {
        const n = allNodes[i];
        if (n && Array.isArray(n.connections)) {
          for (const conn of n.connections) {
            const connIdx = typeof conn === 'number' ? conn : allNodes.indexOf(conn);
            if (connIdx >= 0 && connIdx < allNodes.length) {
              unionNodes(i, connIdx);
            }
          }
        }
      }

      // Group node refs by node root
      const netGroups = new Map<number, { sources: ElementNodeRef[]; sinks: ElementNodeRef[] }>();
      for (const ref of nodeRefs) {
        if (ref.nodeIndex !== undefined && ref.nodeIndex >= 0 && ref.nodeIndex < allNodes.length) {
          const root = findNode(ref.nodeIndex);
          if (!netGroups.has(root)) {
            netGroups.set(root, { sources: [], sinks: [] });
          }
          const grp = netGroups.get(root)!;
          if (ref.type === 'source') grp.sources.push(ref);
          else grp.sinks.push(ref);
        }
      }

      for (const [, grp] of netGroups) {
        for (const src of grp.sources) {
          for (const snk of grp.sinks) {
            engine.connect(src.circuit as IOutputCircuit, src.portIndex, snk.circuit as IInputCircuit, snk.portIndex);
          }
        }
      }
    }

    // Strategy B: Wire list (wireList / wires) with coordinate points
    const wireList: any[] = [];
    if (Array.isArray(targetScope.wireList)) wireList.push(...targetScope.wireList);
    if (Array.isArray(targetScope.wires)) wireList.push(...targetScope.wires);

    if (wireList.length > 0) {
      for (const w of wireList) {
        let x1: number | undefined;
        let y1: number | undefined;
        let x2: number | undefined;
        let y2: number | undefined;

        if (w.x1 !== undefined && w.y1 !== undefined && w.x2 !== undefined && w.y2 !== undefined) {
          x1 = parseFloat(w.x1);
          y1 = parseFloat(w.y1);
          x2 = parseFloat(w.x2);
          y2 = parseFloat(w.y2);
        } else if (w.node1 && w.node2) {
          x1 = parseFloat(w.node1.x ?? w.node1.absX ?? '0');
          y1 = parseFloat(w.node1.y ?? w.node1.absY ?? '0');
          x2 = parseFloat(w.node2.x ?? w.node2.absX ?? '0');
          y2 = parseFloat(w.node2.y ?? w.node2.absY ?? '0');
        }

        if (x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) {
          solver.addWire({ x: x1, y: y1 }, { x: x2, y: y2 });
        }
      }

      solver.solve(engine);
    }

    // Strategy C: Direct connections list (if present)
    const directConnections = targetScope.connections || data.connections || [];
    if (Array.isArray(directConnections)) {
      for (const conn of directConnections) {
        let fromId = conn.from || conn.source;
        let toId = conn.to || conn.target;
        let fromPort = 0;
        let toPort = 0;

        if (typeof fromId === 'string' && fromId.includes('.')) {
          const parts = fromId.split('.');
          fromId = parts[0];
          fromPort = parseInt(parts[1].replace(/\D/g, '') || '0', 10);
        }
        if (typeof toId === 'string' && toId.includes('.')) {
          const parts = toId.split('.');
          toId = parts[0];
          toPort = parseInt(parts[1].replace(/\D/g, '') || '0', 10);
        }

        const outCircuit = elementIdMap.get(fromId) as IOutputCircuit;
        const inCircuit = elementIdMap.get(toId) as IInputCircuit;

        if (outCircuit && inCircuit) {
          engine.connect(outCircuit, fromPort, inCircuit, toPort);
        }
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
    type: string,
    uid: string,
    elem: any,
    label: string,
    logiclyParser: LogiclyParser
  ): ICircuit | null {
    const norm = type.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    switch (norm) {
      case 'input': {
        const stateVal = elem.state ?? elem.val ?? elem.value ?? 0;
        const initial = stateVal === 1 || stateVal === '1' || stateVal === true;
        const sw = new SwitchCircuit(initial, uid);
        if (label) {
          sw.label = label;
          sw.exportName = label;
        }
        return sw;
      }

      case 'output': {
        const bulb = new LightBulbCircuit(uid);
        if (label) {
          bulb.label = label;
          bulb.exportName = label;
        }
        return bulb;
      }

      case 'andgate':
      case 'and': {
        const inputs = elem.inputSize || elem.customData?.values?.inputSize || 2;
        const g = new ANDGateCircuit(inputs, uid);
        if (label) g.label = label;
        return g;
      }

      case 'orgate':
      case 'or': {
        const inputs = elem.inputSize || elem.customData?.values?.inputSize || 2;
        const g = new ORGateCircuit(inputs, uid);
        if (label) g.label = label;
        return g;
      }

      case 'notgate':
      case 'not': {
        const g = new NOTGateCircuit(uid);
        if (label) g.label = label;
        return g;
      }

      case 'nandgate':
      case 'nand': {
        const inputs = elem.inputSize || elem.customData?.values?.inputSize || 2;
        const g = new NANDGateCircuit(inputs, uid);
        if (label) g.label = label;
        return g;
      }

      case 'norgate':
      case 'nor': {
        const inputs = elem.inputSize || elem.customData?.values?.inputSize || 2;
        const g = new NORGateCircuit(inputs, uid);
        if (label) g.label = label;
        return g;
      }

      case 'xorgate':
      case 'xor': {
        const inputs = elem.inputSize || elem.customData?.values?.inputSize || 2;
        const g = new XORGateCircuit(inputs, uid);
        if (label) g.label = label;
        return g;
      }

      case 'xnorgate':
      case 'xnor': {
        const inputs = elem.inputSize || elem.customData?.values?.inputSize || 2;
        const g = new XNORGateCircuit(inputs, uid);
        if (label) g.label = label;
        return g;
      }

      case 'buffer': {
        const g = new BufferGateCircuit(uid);
        if (label) g.label = label;
        return g;
      }

      case 'tristate': {
        const g = new TriStateCircuit(uid);
        if (label) g.label = label;
        return g;
      }

      case 'clock': {
        const period = elem.timePeriod || 1000;
        const clk = new ClockCircuit(period, uid);
        if (label) clk.label = label;
        return clk;
      }

      case 'constantval':
      case 'constant': {
        const stateVal = elem.state ?? elem.val ?? elem.value ?? 1;
        const isHigh = stateVal === 1 || stateVal === '1' || stateVal === true;
        const c = isHigh ? new ConstantHighCircuit(uid) : new ConstantLowCircuit(uid);
        if (label) c.label = label;
        return c;
      }

      case 'sevensegdisplay':
      case 'hexdisplay': {
        const disp = new DigitDisplayCircuit(uid);
        if (label) disp.label = label;
        return disp;
      }

      case 'button': {
        const btn = new PushButtonCircuit(uid);
        if (label) btn.label = label;
        return btn;
      }

      case 'text': {
        return new LabelCircuit(label || elem.text || '', uid);
      }

      case 'dflipflop': {
        return logiclyParser.instantiateCustomIC('d_flip_flop@logic.ly', uid, label);
      }

      case 'jkflipflop': {
        return logiclyParser.instantiateCustomIC('jk_flip_flop@logic.ly', uid, label);
      }

      case 'tflipflop': {
        return logiclyParser.instantiateCustomIC('t_flip_flop@logic.ly', uid, label);
      }

      case 'srflipflop': {
        return logiclyParser.instantiateCustomIC('sr_flip_flop@logic.ly', uid, label);
      }

      default:
        return null;
    }
  }

  private static extractElementTerminals(
    elem: any,
    circuit: ICircuit,
    x: number,
    y: number,
    allNodes: any[],
    nodeRefs: any[],
    solver: CoordinateNetlistSolver
  ): void {
    const customNodes = elem.customData?.nodes;

    // 1. Output terminal
    let outNodeIdx: number | undefined;
    if (customNodes?.output1 !== undefined) {
      outNodeIdx = typeof customNodes.output1 === 'number' ? customNodes.output1 : customNodes.output1?.id;
    } else if (elem.output1 !== undefined) {
      outNodeIdx = typeof elem.output1 === 'number' ? elem.output1 : elem.output1?.id;
    }

    let outX = x + 30;
    let outY = y;
    if (outNodeIdx !== undefined && allNodes[outNodeIdx]) {
      outX = allNodes[outNodeIdx].x ?? outX;
      outY = allNodes[outNodeIdx].y ?? outY;
    } else if (circuit instanceof SwitchCircuit || circuit instanceof ConstantHighCircuit || circuit instanceof ConstantLowCircuit) {
      outX = x;
      outY = y;
    }

    nodeRefs.push({ circuit, portIndex: 0, type: 'source', nodeIndex: outNodeIdx, x: outX, y: outY });
    solver.addTerminal({ circuit, portIndex: 0, type: 'source', x: outX, y: outY });

    // 2. Input terminals
    let inNodeIndices: number[] = [];
    if (Array.isArray(customNodes?.inp)) {
      inNodeIndices = customNodes.inp.map((n: any) => (typeof n === 'number' ? n : n?.id));
    } else if (Array.isArray(elem.inputElementList)) {
      inNodeIndices = elem.inputElementList.map((n: any) => (typeof n === 'number' ? n : n?.id));
    }

    const inCount = Math.max((circuit as any).inputsCount || 0, inNodeIndices.length);
    for (let i = 0; i < inCount; i++) {
      const nIdx = inNodeIndices[i];
      let inX = x - 30;
      let inY = y + (i - (inCount - 1) / 2) * 20;

      if (nIdx !== undefined && allNodes[nIdx]) {
        inX = allNodes[nIdx].x ?? inX;
        inY = allNodes[nIdx].y ?? inY;
      } else if (circuit instanceof LightBulbCircuit) {
        inX = x;
        inY = y;
      }

      nodeRefs.push({ circuit, portIndex: i, type: 'sink', nodeIndex: nIdx, x: inX, y: inY });
      solver.addTerminal({ circuit, portIndex: i, type: 'sink', x: inX, y: inY });
    }
  }
}
