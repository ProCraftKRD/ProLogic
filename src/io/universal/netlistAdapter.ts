import { XMLParser } from 'fast-xml-parser';
import { ICircuit, IInputCircuit, IOutputCircuit } from '../../simulation/types';
import { SimulationEngine } from '../../simulation/engine';
import { ParsedCircuitDocument, CircuitMetadata, LogiclyParser } from '../parser';
import { PinLocationMap } from '../../simulation/circuits/complex';
import { generateUID } from '../../simulation/circuits/base';
import { LabelCircuit } from '../../simulation/circuits/annotation';

export interface NetlistNode {
  component: string;
  pin: string;
}

export interface NetlistNet {
  name?: string;
  Node?: NetlistNode[];
  node?: NetlistNode[];
}

export interface NetlistComponent {
  id?: string;
  name?: string;
  type: string;
  role?: string;
  voltage?: string;
  [key: string]: any;
}

export class NetlistAdapter {
  /**
   * Imports a declarative XML Schematic Netlist document (<Circuit><Components>...<Connections><Net>...).
   */
  public static importCircuit(
    xmlString: string,
    options?: { parser?: LogiclyParser; idRemap?: Map<string, string> }
  ): ParsedCircuitDocument {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => ['Component', 'component', 'Net', 'net', 'Node', 'node'].includes(name)
    });

    const parsed = parser.parse(xmlString);
    const root = parsed.Circuit || parsed.circuit || parsed.Netlist || parsed.netlist || parsed;

    const engine = new SimulationEngine();
    const circuits = new Map<string, ICircuit>();
    const metadata = new Map<string, CircuitMetadata>();
    const locations: PinLocationMap = { left: [], right: [], top: [], bottom: [] };
    const logiclyParser = options?.parser || new LogiclyParser();

    const rawComponents: any[] =
      root.Components?.Component ||
      root.components?.component ||
      root.Components?.component ||
      root.Component ||
      root.component ||
      [];

    const rawNets: any[] =
      root.Connections?.Net ||
      root.connections?.net ||
      root.Connections?.net ||
      root.Nets?.Net ||
      root.nets?.net ||
      root.Net ||
      root.net ||
      [];

    // Store component lookup by ID
    const compMap = new Map<string, { circuit: ICircuit; type: string; normalizedType: string }>();

    // Partition components for smart schematic autolayout
    const sources: Array<{ id: string; type: string; raw: any }> = [];
    const activeICs: Array<{ id: string; type: string; raw: any }> = [];
    const indicators: Array<{ id: string; type: string; raw: any }> = [];
    const others: Array<{ id: string; type: string; raw: any }> = [];

    for (const comp of rawComponents) {
      const id = comp['@_id'] || comp['@_name'] || generateUID();
      const rawType = comp['@_type'] || '';
      const norm = logiclyParser.normalizeComponentType(rawType);

      if (norm.startsWith('constant_') || norm.startsWith('clock@') || norm.startsWith('switch@')) {
        sources.push({ id, type: rawType, raw: comp });
      } else if (norm.includes('flip_flop') || norm.startsWith('custom_') || norm.startsWith('%custom')) {
        activeICs.push({ id, type: rawType, raw: comp });
      } else if (norm.startsWith('light_bulb@') || norm.startsWith('digit@')) {
        indicators.push({ id, type: rawType, raw: comp });
      } else {
        others.push({ id, type: rawType, raw: comp });
      }
    }

    // Place Banner Title / Description if provided
    const circuitName = root['@_name'] || root['@_title'] || '';
    if (circuitName) {
      const bannerUid = generateUID();
      const bannerCircuit = new LabelCircuit(circuitName, bannerUid, {
        fontSize: 16,
        bold: true
      });
      circuits.set(bannerUid, bannerCircuit);
      metadata.set(bannerUid, { x: 80, y: 40, rotation: 0 });
      engine.registerCircuit(bannerCircuit);
    }

    // Layout Sources on left column
    let sourceY = 120;
    for (const s of sources) {
      const uid = options?.idRemap?.get(s.id) || s.id;
      const circuit = logiclyParser.createCircuitInstance(s.type, uid, {
        exportName: s.id,
        label: s.raw['@_role'] || s.id
      });
      if (circuit) {
        circuits.set(s.id, circuit);
        metadata.set(uid, { x: 80, y: sourceY, rotation: 0 });
        engine.registerCircuit(circuit);
        compMap.set(s.id, { circuit, type: s.type, normalizedType: circuit.type });
        sourceY += 130;
      }
    }

    // Layout Active ICs horizontally (e.g. Flip-Flops in ripple order)
    const icStartX = 240;
    const icY = 220;
    const icSpacingX = 190;
    activeICs.forEach((ic, idx) => {
      const uid = options?.idRemap?.get(ic.id) || ic.id;
      const circuit = logiclyParser.createCircuitInstance(ic.type, uid, {
        exportName: ic.id,
        label: ic.raw['@_role'] || ic.id
      });
      if (circuit) {
        circuits.set(ic.id, circuit);
        metadata.set(uid, { x: icStartX + idx * icSpacingX, y: icY, rotation: 0 });
        engine.registerCircuit(circuit);
        compMap.set(ic.id, { circuit, type: ic.type, normalizedType: circuit.type });
      }
    });

    // Layout Indicators below or aligned with ICs
    const ledY = 380;
    indicators.forEach((ind, idx) => {
      const uid = options?.idRemap?.get(ind.id) || ind.id;
      const circuit = logiclyParser.createCircuitInstance(ind.type, uid, {
        exportName: ind.id,
        label: ind.raw['@_role'] || ind.id
      });
      if (circuit) {
        circuits.set(ind.id, circuit);
        const posX = activeICs.length > 0 ? icStartX + 80 + idx * icSpacingX : 400 + idx * 100;
        metadata.set(uid, { x: posX, y: ledY, rotation: 0 });
        engine.registerCircuit(circuit);
        compMap.set(ind.id, { circuit, type: ind.type, normalizedType: circuit.type });
      }
    });

    // Layout any other components in a grid
    let otherX = 300;
    let otherY = 500;
    others.forEach((o) => {
      const uid = options?.idRemap?.get(o.id) || o.id;
      const circuit = logiclyParser.createCircuitInstance(o.type, uid, {
        exportName: o.id,
        label: o.raw['@_role'] || o.id
      });
      if (circuit) {
        circuits.set(o.id, circuit);
        metadata.set(uid, { x: otherX, y: otherY, rotation: 0 });
        engine.registerCircuit(circuit);
        compMap.set(o.id, { circuit, type: o.type, normalizedType: circuit.type });
        otherX += 160;
        if (otherX > 1000) {
          otherX = 300;
          otherY += 100;
        }
      }
    });

    // 2. Resolve Connections / Nets
    for (const net of rawNets) {
      const rawNodes: any[] = net.Node || net.node || [];
      const drivers: Array<{ circuit: IOutputCircuit; pinIndex: number }> = [];
      const receivers: Array<{ circuit: IInputCircuit; pinIndex: number }> = [];

      for (const node of rawNodes) {
        const compId = node['@_component'] || node['@_id'] || '';
        const pinName = node['@_pin'] || node['@_port'] || '0';
        const compInfo = compMap.get(compId);
        if (!compInfo) continue;

        const resolved = this.resolvePinInfo(compInfo.normalizedType, pinName);
        if (resolved) {
          if (resolved.isOutput) {
            drivers.push({
              circuit: compInfo.circuit as IOutputCircuit,
              pinIndex: resolved.pinIndex
            });
          } else {
            receivers.push({
              circuit: compInfo.circuit as IInputCircuit,
              pinIndex: resolved.pinIndex
            });
          }
        }
      }

      // Connect each driver to each receiver in this net
      for (const driver of drivers) {
        for (const receiver of receivers) {
          try {
            engine.connect(driver.circuit, driver.pinIndex, receiver.circuit, receiver.pinIndex);
          } catch (e) {
            console.warn(`Net connection failed:`, e);
          }
        }
      }
    }

    engine.propagateAll();

    return {
      engine,
      circuits,
      metadata,
      locations
    };
  }

  /**
   * Resolves a named or numeric pin into a driver/receiver pin index.
   */
  private static resolvePinInfo(
    normalizedType: string,
    pinName: string
  ): { isOutput: boolean; pinIndex: number } | null {
    const raw = (pinName || '').trim();
    const clean = raw.toLowerCase().replace(/['’_]/g, '');

    // Flip-Flops
    if (normalizedType.includes('jk_flip_flop')) {
      if (clean === 'j' || clean === '0' || clean === 'in0') {
        return { isOutput: false, pinIndex: 0 };
      }
      if (raw === '>' || clean === 'clk' || clean === 'clock' || clean === 'cp' || clean === '1') {
        return { isOutput: false, pinIndex: 1 };
      }
      if (clean === 'k' || clean === '2' || clean === 'in1') {
        return { isOutput: false, pinIndex: 2 };
      }
      if (clean === 'pre' || clean === 'preset' || clean === 'set' || clean === '3') {
        return { isOutput: false, pinIndex: 3 };
      }
      if (clean === 'clr' || clean === 'clear' || clean === 'reset' || clean === '4') {
        return { isOutput: false, pinIndex: 4 };
      }
      if (clean === 'q' || clean === '0' || clean === 'out') {
        return { isOutput: true, pinIndex: 0 };
      }
      if (clean === 'q' || clean === 'qbar' || clean === 'nq' || clean === '!q' || clean === '~q' || clean === '1') {
        // Distinguish Q vs Q' by checking raw string for prime/bar
        if (raw.includes("'") || raw.includes("’") || raw.includes("bar") || raw.startsWith("!") || raw.startsWith("~")) {
          return { isOutput: true, pinIndex: 1 };
        }
        return { isOutput: true, pinIndex: 0 };
      }
    }

    if (normalizedType.includes('d_flip_flop')) {
      if (clean === 'd' || clean === '0') return { isOutput: false, pinIndex: 0 };
      if (raw === '>' || clean === 'clk' || clean === 'clock' || clean === '1') return { isOutput: false, pinIndex: 1 };
      if (clean === 'pre' || clean === 'preset' || clean === '2') return { isOutput: false, pinIndex: 2 };
      if (clean === 'clr' || clean === 'clear' || clean === '3') return { isOutput: false, pinIndex: 3 };
      if (raw.includes("'") || raw.includes("bar") || clean === 'qbar') return { isOutput: true, pinIndex: 1 };
      if (clean === 'q' || clean === 'out') return { isOutput: true, pinIndex: 0 };
    }

    if (normalizedType.includes('t_flip_flop')) {
      if (clean === 't' || clean === '0') return { isOutput: false, pinIndex: 0 };
      if (raw === '>' || clean === 'clk' || clean === 'clock' || clean === '1') return { isOutput: false, pinIndex: 1 };
      if (clean === 'pre' || clean === 'preset' || clean === '2') return { isOutput: false, pinIndex: 2 };
      if (clean === 'clr' || clean === 'clear' || clean === '3') return { isOutput: false, pinIndex: 3 };
      if (raw.includes("'") || raw.includes("bar") || clean === 'qbar') return { isOutput: true, pinIndex: 1 };
      if (clean === 'q' || clean === 'out') return { isOutput: true, pinIndex: 0 };
    }

    // Sources: Constant High, Constant Low, Clock, PowerSupply, PulseGenerator
    if (normalizedType.startsWith('constant_') || normalizedType.startsWith('clock@') || normalizedType.startsWith('switch@')) {
      return { isOutput: true, pinIndex: 0 };
    }

    // Sinks: Light Bulb, LED, OutputIndicator, DigitDisplay
    if (normalizedType.startsWith('light_bulb@') || normalizedType.startsWith('digit@')) {
      const idx = parseInt(clean, 10);
      return { isOutput: false, pinIndex: isNaN(idx) ? 0 : idx };
    }

    // Logic Gates
    if (clean === 'out' || clean === 'y' || clean === 'q') {
      return { isOutput: true, pinIndex: 0 };
    }
    if (clean === 'a' || clean === 'in0') return { isOutput: false, pinIndex: 0 };
    if (clean === 'b' || clean === 'in1') return { isOutput: false, pinIndex: 1 };
    if (clean === 'c' || clean === 'in2') return { isOutput: false, pinIndex: 2 };
    if (clean === 'd' || clean === 'in3') return { isOutput: false, pinIndex: 3 };

    // Numerical index fallback
    const num = parseInt(clean, 10);
    if (!isNaN(num)) {
      return { isOutput: false, pinIndex: num };
    }

    return null;
  }
}
