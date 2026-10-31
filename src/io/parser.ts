import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { ICircuit, IInputCircuit, IOutputCircuit, LogicConnection } from '../simulation/types';
import { SimulationEngine } from '../simulation/engine';
import { ComplexCircuit, PinLocationMap } from '../simulation/circuits/complex';
import { SwitchCircuit, PushButtonCircuit, ConstantHighCircuit, ConstantLowCircuit } from '../simulation/circuits/controls';
import { LightBulbCircuit, DigitDisplayCircuit } from '../simulation/circuits/outputs';
import { ClockCircuit } from '../simulation/circuits/clock';
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
} from '../simulation/circuits/gates';
import { LabelCircuit } from '../simulation/circuits/annotation';
import { generateUID, MultiLogicFunctionCircuit } from '../simulation/circuits/base';
import { BUILTIN_IC_TEMPLATES } from '../simulation/templates';
import { detectCircuitFormat } from './universal/formatDetector';
import { UniversalCircuitImporter } from './universal/universalImporter';

export interface CircuitMetadata {
  x: number;
  y: number;
  rotation: number;
}

export interface CustomTemplateMetadata {
  name: string;
  label?: string;
}

export interface CustomPackage {
  type: string;
  name: string;
  label?: string;
  xml: string;
}

export interface SerializeOptions {
  includeCustomTemplates?: boolean;
  customTemplates?: Map<string, string> | Record<string, string>;
}

export interface ParsedCircuitDocument {
  engine: SimulationEngine;
  circuits: Map<string, ICircuit>;
  metadata: Map<string, CircuitMetadata>;
  locations: PinLocationMap;
  settings?: {
    grid?: { snap: boolean; size: number; visible: boolean };
    gateStandard?: string;
  };
  warnings?: string[];
  unknownTypes?: string[];
}

export function decodeXmlEntities(val: string): string {
  if (!val || typeof val !== 'string') return val;
  return val
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export class LogiclyParser {
  private _customTemplates: Map<string, string> = new Map();
  private _customMetadata: Map<string, CustomTemplateMetadata> = new Map();

  constructor() {
    // Automatically register all built-in IC subcircuits
    for (const [type, xml] of Object.entries(BUILTIN_IC_TEMPLATES)) {
      this._customTemplates.set(type, xml);
    }
    if (BUILTIN_IC_TEMPLATES['sr_flip_flop@logic.ly'] && !this._customTemplates.has('rs_flip_flop@logic.ly')) {
      this._customTemplates.set('rs_flip_flop@logic.ly', BUILTIN_IC_TEMPLATES['sr_flip_flop@logic.ly']);
    }
    if (BUILTIN_IC_TEMPLATES['rs_flip_flop@logic.ly'] && !this._customTemplates.has('sr_flip_flop@logic.ly')) {
      this._customTemplates.set('sr_flip_flop@logic.ly', BUILTIN_IC_TEMPLATES['rs_flip_flop@logic.ly']);
    }
  }

  public registerCustomTemplate(typeId: string, xmlContent: string, meta?: CustomTemplateMetadata | string): void {
    this._customTemplates.set(typeId, xmlContent);
    if (typeof meta === 'string') {
      this._customMetadata.set(typeId, { name: typeId, label: meta });
    } else if (meta) {
      this._customMetadata.set(typeId, meta);
    }
  }

  public unregisterCustomTemplate(typeId: string): boolean {
    const deletedTemplate = this._customTemplates.delete(typeId);
    const deletedMeta = this._customMetadata.delete(typeId);
    return deletedTemplate || deletedMeta;
  }

  public getCustomTemplate(typeId: string): string | undefined {
    return this._customTemplates.get(typeId);
  }

  public get customTemplates(): Map<string, string> {
    return this._customTemplates;
  }

  public get customMetadata(): Map<string, CustomTemplateMetadata> {
    return this._customMetadata;
  }

  public getCustomMetadata(typeId: string): CustomTemplateMetadata | undefined {
    return this._customMetadata.get(typeId);
  }

  /**
   * Checks whether the XML string is a Logicly IC library document (.logiclylib / .logiclylibx).
   */
  public isLibrary(xmlString: string): boolean {
    if (!xmlString || typeof xmlString !== 'string') return false;
    if (xmlString.includes('http://ns.logic.ly/library/')) {
      return true;
    }
    try {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_'
      });
      const parsed = parser.parse(xmlString);
      const root = parsed.logicly || parsed.circuit || parsed;
      const xmlns = root?.['@_xmlns'] || '';
      if (xmlns.includes('/library/')) return true;
      if (root?.custom && !root?.object) return true;
    } catch {
      return false;
    }
    return false;
  }

  /**
   * Parses a Logicly IC library document, extracts all <custom> packages,
   * registers them into _customTemplates, and returns the package list.
   */
  public parseLibrary(xmlString: string): CustomPackage[] {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => ['custom', 'object', 'connection', 'location', 'point', 'waypoint'].includes(name)
    });

    const parsed = parser.parse(xmlString);
    const root = parsed.logicly || parsed.circuit || parsed;
    const results: CustomPackage[] = [];

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      suppressBooleanAttributes: false,
      format: true,
      indentBy: '  '
    });

    const customs = root.custom || [];
    for (const c of customs) {
      const type = c['@_type'] || c['@_name'] || generateUID();
      const name = c['@_name'] || type;
      let label = c['@_label'];
      if (label) {
        label = label.replace(/\\n/g, '\n');
      }

      const innerDoc = {
        logicly: {
          '@_xmlns': 'http://ns.logic.ly/1.2',
          object: c.object || [],
          connection: c.connection || [],
          location: c.location || []
        }
      };

      const customXml = builder.build(innerDoc);
      this.registerCustomTemplate(type, customXml, { name, label });

      results.push({
        type,
        name,
        label,
        xml: customXml
      });
    }

    return results;
  }

  public parse(content: string, idRemap?: Map<string, string>, filename?: string): ParsedCircuitDocument {
    const detection = detectCircuitFormat(content, filename);
    if (detection.format !== 'logicly' && detection.format !== 'unknown') {
      return UniversalCircuitImporter.importCircuit(content, filename, { parser: this, idRemap });
    }
    const trimmed = (content || '').trim();
    if (
      trimmed.startsWith('{') ||
      trimmed.startsWith('[') ||
      trimmed.includes('<project') ||
      trimmed.includes('<visualElements>') ||
      trimmed.includes('<visualElement>') ||
      trimmed.includes('<Components') ||
      trimmed.includes('<components') ||
      trimmed.includes('<Connections') ||
      trimmed.includes('<connections')
    ) {
      return UniversalCircuitImporter.importCircuit(content, filename, { parser: this, idRemap });
    }
    return this.parseNative(content, idRemap);
  }

  public parseNative(xmlString: string, idRemap?: Map<string, string>): ParsedCircuitDocument {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => ['custom', 'object', 'connection', 'location', 'point', 'waypoint'].includes(name)
    });

    const parsed = parser.parse(xmlString);
    const root = parsed.logicly || parsed.circuit || parsed;

    // 0. Auto-parse and register any embedded <custom> packages BEFORE parsing objects
    if (root.custom && Array.isArray(root.custom)) {
      const builder = new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        format: true,
        indentBy: '  '
      });

      for (const c of root.custom) {
        const type = c['@_type'] || c['@_name'] || generateUID();
        const name = c['@_name'] || type;
        let label = c['@_label'];
        if (label) {
          label = label.replace(/\\n/g, '\n');
        }

        const innerDoc = {
          logicly: {
            '@_xmlns': 'http://ns.logic.ly/1.2',
            object: c.object || [],
            connection: c.connection || [],
            location: c.location || []
          }
        };

        const customXml = builder.build(innerDoc);
        this.registerCustomTemplate(type, customXml, { name, label });
      }
    }

    const engine = new SimulationEngine();
    const circuits = new Map<string, ICircuit>();
    const metadata = new Map<string, CircuitMetadata>();
    const locations: PinLocationMap = {
      left: [],
      right: [],
      top: [],
      bottom: []
    };

    // 1. Parse objects
    const objects = root.object || [];
    const unknownTypes: string[] = [];
    for (const obj of objects) {
      const origUid = obj['@_uid'] || generateUID();
      const uid = idRemap ? (idRemap.get(origUid) || origUid) : origUid;
      const type = obj['@_type'] || '';
      const x = parseFloat(obj['@_x'] || '0');
      const y = parseFloat(obj['@_y'] || '0');
      const rotation = parseFloat(obj['@_rotation'] || '0');
      const exportName = obj['@_exportName'];
      const inputsAttr = obj['@_inputs'] !== undefined ? parseInt(obj['@_inputs'], 10) : undefined;
      const functionIndexAttr = obj['@_functionIndex'] !== undefined ? parseInt(String(obj['@_functionIndex']), 10) : undefined;
      const outputsAttr = obj['@_outputs'];
      const freqAttr = obj['@_frequency'] ? parseFloat(obj['@_frequency']) : undefined;
      const textAttr = decodeXmlEntities(obj['@_text'] || '');
      const fontSizeAttr = obj['@_fontSize'] !== undefined ? parseInt(String(obj['@_fontSize']), 10) : undefined;
      const boldAttr = obj['@_bold'] !== undefined ? (String(obj['@_bold']).toLowerCase() === 'true' || obj['@_bold'] === '' || obj['@_bold'] === true) : undefined;
      const italicAttr = obj['@_italic'] !== undefined ? (String(obj['@_italic']).toLowerCase() === 'true' || obj['@_italic'] === '' || obj['@_italic'] === true) : undefined;
      const alignmentAttr = (obj['@_alignment'] === 'center' || obj['@_alignment'] === 'right' || obj['@_alignment'] === 'left') ? (obj['@_alignment'] as 'left' | 'center' | 'right') : undefined;
      const colorAttr = typeof obj['@_color'] === 'string' && obj['@_color'].trim().length > 0 ? obj['@_color'].trim() : undefined;

      metadata.set(uid, { x, y, rotation });

      const circuit = this.createCircuitInstance(type, uid, {
        inputs: inputsAttr,
        functionIndex: functionIndexAttr,
        outputs: outputsAttr,
        frequency: freqAttr,
        text: textAttr,
        fontSize: fontSizeAttr,
        bold: boldAttr,
        italic: italicAttr,
        alignment: alignmentAttr,
        color: colorAttr,
        exportName
      });

      if (circuit) {
        if (exportName) circuit.exportName = exportName;
        circuits.set(uid, circuit);
        engine.registerCircuit(circuit);
      } else {
        unknownTypes.push(type);
      }
    }

    if (objects.length > 0 && circuits.size === 0) {
      const uniqueTypes = Array.from(new Set(unknownTypes)).join(', ');
      throw new Error(`Failed to parse circuit: None of the ${objects.length} component(s) in the file could be recognized. Unrecognized component types: ${uniqueTypes || 'none'}.`);
    }

    // 2. Parse connections
    const connections = root.connection || [];
    for (const conn of connections) {
      let outUID = conn['@_outputUID'];
      let inUID = conn['@_inputUID'];
      if (idRemap) {
        outUID = idRemap.get(outUID) || outUID;
        inUID = idRemap.get(inUID) || inUID;
      }
      const outIdx = parseInt(conn['@_outputIndex'] || '0', 10);
      const inIdx = parseInt(conn['@_inputIndex'] || '0', 10);

      const outCircuit = circuits.get(outUID) as IOutputCircuit;
      const inCircuit = circuits.get(inUID) as IInputCircuit;

      if (outCircuit && inCircuit) {
        const pointsList: Array<{ x: number; y: number }> = [];
        const rawPointsStr = conn['@_points'];
        if (typeof rawPointsStr === 'string' && rawPointsStr.trim().length > 0) {
          const parts = rawPointsStr.split(',').map((p: string) => parseFloat(p.trim()));
          for (let i = 0; i < parts.length - 1; i += 2) {
            if (!isNaN(parts[i]) && !isNaN(parts[i + 1])) {
              pointsList.push({ x: parts[i], y: parts[i + 1] });
            }
          }
        } else {
          const rawPoints = conn.point || conn.waypoint;
          if (rawPoints) {
            const pointArray = Array.isArray(rawPoints) ? rawPoints : [rawPoints];
            for (const pt of pointArray) {
              pointsList.push({
                x: parseFloat(pt['@_x'] || '0'),
                y: parseFloat(pt['@_y'] || '0')
              });
            }
          }
        }
        engine.connect(outCircuit, outIdx, inCircuit, inIdx, pointsList);
      }
    }

    // 3. Parse pin locations
    const locs = root.location || [];
    for (const loc of locs) {
      const locId = loc['@_id'] as keyof PinLocationMap;
      const uidsStr = loc['@_uids'] || '';
      if (locId && locations[locId] !== undefined) {
        const uidList = uidsStr.split(',').map((u: string) => u.trim()).filter((u: string) => u.length > 0);
        locations[locId] = idRemap
          ? uidList.map((u: string) => idRemap.get(u) || u)
          : uidList;
      }
    }

    // Reset engine to ensure clean quiescent initial state across all components and sequential feedback loops
    engine.reset();

    return {
      engine,
      circuits,
      metadata,
      locations,
      unknownTypes: unknownTypes.length > 0 ? unknownTypes : undefined
    };
  }

  public normalizeComponentType(type: string): string {
    if (!type || typeof type !== 'string') return '';
    const trimmed = type.trim();
    if (!trimmed) return '';

    // Direct match in custom templates or canonical types
    if (this._customTemplates.has(trimmed)) {
      return trimmed;
    }

    // Strip namespace suffix if present to inspect the base
    const hasLogiclySuffix = trimmed.endsWith('@logic.ly');
    const baseName = hasLogiclySuffix ? trimmed.substring(0, trimmed.length - 9) : trimmed;

    // Convert PascalCase/camelCase to snake_case, e.g. HighConstant -> high_constant, JK_Flip_Flop -> jk_flip_flop
    const snake = baseName
      .replace(/([a-z\d])([A-Z])/g, '$1_$2')
      .replace(/[\s\-_]+/g, '_')
      .toLowerCase();

    // Map common aliases to canonical names
    switch (snake) {
      // Gates
      case 'and':
      case 'and_gate':
      case 'andgate':
        return 'and@logic.ly';
      case 'or':
      case 'or_gate':
      case 'orgate':
        return 'or@logic.ly';
      case 'not':
      case 'not_gate':
      case 'notgate':
      case 'inverter':
      case 'inv':
        return 'not@logic.ly';
      case 'nand':
      case 'nand_gate':
      case 'nandgate':
        return 'nand@logic.ly';
      case 'nor':
      case 'nor_gate':
      case 'norgate':
        return 'nor@logic.ly';
      case 'xor':
      case 'xor_gate':
      case 'xorgate':
        return 'xor@logic.ly';
      case 'xnor':
      case 'xnor_gate':
      case 'xnorgate':
        return 'xnor@logic.ly';
      case 'buffer':
      case 'buffer_gate':
      case 'buffergate':
        return 'buffer@logic.ly';
      case 'tri_state':
      case 'tristate':
      case 'tri_state_gate':
      case 'tristate_gate':
      case 'three_state':
        return 'tri-state@logic.ly';
      case 'bus':
        return 'bus@logic.ly';

      // Controls / Inputs
      case 'high_constant':
      case 'constant_high':
      case 'power_supply':
      case 'powersupply':
      case 'power':
      case 'high':
      case 'vcc':
      case 'one':
      case 'source_1':
        return 'constant_high@logic.ly';
      case 'low_constant':
      case 'constant_low':
      case 'low':
      case 'gnd':
      case 'ground':
      case 'zero':
      case 'source_0':
        return 'constant_low@logic.ly';
      case 'clock':
      case 'clk':
      case 'pulse_generator':
      case 'pulsegenerator':
      case 'generator':
      case 'oscillator':
      case 'pulse':
        return 'clock@logic.ly';
      case 'switch':
      case 'toggle_switch':
      case 'toggle':
      case 'input_switch':
        return 'switch@logic.ly';
      case 'push_button':
      case 'button':
      case 'pushbutton':
      case 'momentary_switch':
        return 'push_button@logic.ly';

      // Outputs
      case 'light_bulb':
      case 'lightbulb':
      case 'bulb':
      case 'led':
      case 'lamp':
      case 'indicator':
      case 'output_indicator':
      case 'outputindicator':
        return 'light_bulb@logic.ly';
      case 'digit':
      case 'digit_display':
      case 'seven_segment':
      case '7_segment':
      case 'hex_display':
      case 'display':
      case 'four_bit_display':
        return 'digit@logic.ly';

      // Built-in flip-flops / ICs
      case 'jk_flip_flop':
      case 'jk_flipflop':
      case 'jk':
      case 'jkff':
        return 'jk_flip_flop@logic.ly';
      case 'd_flip_flop':
      case 'd_flipflop':
      case 'd':
      case 'dff':
        return 'd_flip_flop@logic.ly';
      case 't_flip_flop':
      case 't_flipflop':
      case 't':
      case 'tff':
        return 't_flip_flop@logic.ly';
      case 'sr_flip_flop':
      case 'sr_flipflop':
      case 'sr':
      case 'srff':
      case 'rs_flip_flop':
      case 'rs_flipflop':
      case 'rs':
      case 'rsff':
        return 'sr_flip_flop@logic.ly';

      // Annotations
      case 'label':
      case 'text':
      case 'annotation':
      case 'comment':
        return 'label@logic.ly';
    }

    // Check if snake + '@logic.ly' matches a custom template or built-in
    const withSuffix = `${snake}@logic.ly`;
    if (this._customTemplates.has(withSuffix)) {
      return withSuffix;
    }

    // Check case-insensitive in _customTemplates
    for (const [key] of this._customTemplates) {
      if (key.toLowerCase() === trimmed.toLowerCase() || key.toLowerCase() === snake) {
        return key;
      }
    }

    return trimmed;
  }

  public createCircuitInstance(type: string, uid: string = generateUID(), props: any = {}): ICircuit | null {
    const normalizedType = this.normalizeComponentType(type);
    switch (normalizedType) {
      case 'and@logic.ly':
        return new ANDGateCircuit(props.inputs || 2, uid);
      case 'or@logic.ly':
        return new ORGateCircuit(props.inputs || 2, uid);
      case 'not@logic.ly':
        return new NOTGateCircuit(uid);
      case 'nand@logic.ly':
        return new NANDGateCircuit(props.inputs || 2, uid);
      case 'nor@logic.ly':
        return new NORGateCircuit(props.inputs || 2, uid);
      case 'xor@logic.ly': {
        const funcIdx = props.functionIndex !== undefined
          ? (typeof props.functionIndex === 'number' ? props.functionIndex : parseInt(props.functionIndex, 10))
          : 0;
        return new XORGateCircuit(props.inputs || 2, uid, isNaN(funcIdx) ? 0 : funcIdx);
      }
      case 'xnor@logic.ly': {
        const funcIdx = props.functionIndex !== undefined
          ? (typeof props.functionIndex === 'number' ? props.functionIndex : parseInt(props.functionIndex, 10))
          : 0;
        return new XNORGateCircuit(props.inputs || 2, uid, isNaN(funcIdx) ? 0 : funcIdx);
      }
      case 'buffer@logic.ly':
        return new BufferGateCircuit(uid);
      case 'tri-state@logic.ly':
        return new TriStateCircuit(uid);
      case 'bus@logic.ly':
      case 'bus':
        return new BusCircuit(props.inputs !== undefined ? props.inputs : 4, uid);
      case 'switch@logic.ly': {
        const initial = props.outputs === 'true' || props.outputs === true;
        const sw = new SwitchCircuit(initial, uid);
        sw.defaultState = initial;
        return sw;
      }
      case 'push_button@logic.ly':
        return new PushButtonCircuit(uid);
      case 'clock@logic.ly':
        return new ClockCircuit(props.frequency || 1000, uid);
      case 'constant_high@logic.ly':
        return new ConstantHighCircuit(uid);
      case 'constant_low@logic.ly':
        return new ConstantLowCircuit(uid);
      case 'light_bulb@logic.ly':
        return new LightBulbCircuit(uid);
      case 'digit@logic.ly':
        return new DigitDisplayCircuit(uid);
      case 'label@logic.ly':
        return new LabelCircuit(props.text || '', uid, {
          fontSize: props.fontSize,
          bold: props.bold,
          italic: props.italic,
          alignment: props.alignment,
          color: props.color
        });
      default: {
        let lookupType = normalizedType;
        if (
          lookupType === 'sr_flip_flop@logic.ly' &&
          !this._customTemplates.has(lookupType) &&
          this._customTemplates.has('rs_flip_flop@logic.ly')
        ) {
          lookupType = 'rs_flip_flop@logic.ly';
        } else if (
          lookupType === 'rs_flip_flop@logic.ly' &&
          !this._customTemplates.has(lookupType) &&
          this._customTemplates.has('sr_flip_flop@logic.ly')
        ) {
          lookupType = 'sr_flip_flop@logic.ly';
        }

        // Check custom templates or built-in IC subcircuits
        if (this._customTemplates.has(lookupType)) {
          return this.instantiateCustomIC(lookupType, uid, props.label || props.exportName);
        }
        if (this._customTemplates.has(type)) {
          return this.instantiateCustomIC(type, uid, props.label || props.exportName);
        }

        // Support %custom@logic.ly abstract type by instantiating the first available user custom template
        if (type === '%custom@logic.ly' || normalizedType === '%custom@logic.ly') {
          for (const [key] of this._customTemplates) {
            if (!BUILTIN_IC_TEMPLATES[key] && key !== 'sr_flip_flop@logic.ly' && key !== '%custom@logic.ly') {
              return this.instantiateCustomIC(key, uid, props.label || props.exportName);
            }
          }
        }

        return null;
      }
    }
  }

  public instantiateCustomIC(type: string, uid: string, label?: string): ComplexCircuit {
    let templateKey = this.normalizeComponentType(type);
    if (!this._customTemplates.has(templateKey)) {
      if (this._customTemplates.has(type)) {
        templateKey = type;
      } else if (templateKey === 'sr_flip_flop@logic.ly' && this._customTemplates.has('rs_flip_flop@logic.ly')) {
        templateKey = 'rs_flip_flop@logic.ly';
      } else if (templateKey === 'rs_flip_flop@logic.ly' && this._customTemplates.has('sr_flip_flop@logic.ly')) {
        templateKey = 'sr_flip_flop@logic.ly';
      }
    }

    const xml = this._customTemplates.get(templateKey)!;
    if (!xml) {
      throw new Error(`Custom IC template for type '${type}' not found.`);
    }

    // Remap all internal UIDs to avoid ID collisions
    const remap = new Map<string, string>();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => ['custom', 'object', 'connection', 'location'].includes(name)
    });
    const parsed = parser.parse(xml);
    const root = parsed.logicly || parsed.circuit || parsed.custom || parsed;
    for (const obj of (root.object || [])) {
      if (obj['@_uid']) {
        remap.set(obj['@_uid'], generateUID());
      }
    }

    const subDoc = this.parse(xml, remap);
    const inputSwitches: SwitchCircuit[] = [];
    const outputBulbs: LightBulbCircuit[] = [];

    // Find switches with exportName
    for (const [, c] of subDoc.circuits) {
      if (c instanceof SwitchCircuit && c.exportName) {
        inputSwitches.push(c);
      } else if (c instanceof LightBulbCircuit && c.exportName) {
        outputBulbs.push(c);
      }
    }

    // Order pins according to subcircuit location map if defined
    const orderedInputUids = [
      ...(subDoc.locations.left || []),
      ...(subDoc.locations.top || []),
      ...(subDoc.locations.bottom || [])
    ];
    const orderedOutputUids = [
      ...(subDoc.locations.right || [])
    ];

    if (orderedInputUids.length > 0) {
      inputSwitches.sort((a, b) => {
        const idxA = orderedInputUids.indexOf(a.uid);
        const idxB = orderedInputUids.indexOf(b.uid);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return 0;
      });
    }

    if (orderedOutputUids.length > 0) {
      outputBulbs.sort((a, b) => {
        const idxA = orderedOutputUids.indexOf(a.uid);
        const idxB = orderedOutputUids.indexOf(b.uid);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return 0;
      });
    }

    const meta = this._customMetadata.get(templateKey);
    let effectiveLabel = label || meta?.label;
    if (!effectiveLabel) {
      if (templateKey === 'sr_flip_flop@logic.ly' || templateKey === 'rs_flip_flop@logic.ly') {
        effectiveLabel = 'SR FLIP FLOP';
      }
    } else if (effectiveLabel === 'RS FLIP FLOP' || effectiveLabel === 'RS Flip-Flop') {
      effectiveLabel = 'SR FLIP FLOP';
    }

    return new ComplexCircuit(
      type,
      subDoc.engine,
      inputSwitches,
      outputBulbs,
      subDoc.locations,
      uid,
      effectiveLabel
    );
  }

  public serialize(doc: ParsedCircuitDocument, options?: SerializeOptions): string {
    const root: any = {
      logicly: {
        '@_xmlns': 'http://ns.logic.ly/1.2'
      }
    };

    // Determine custom IC templates to serialize
    const shouldIncludeCustoms = options?.includeCustomTemplates ?? false;
    const customTypesToSerialize = new Set<string>();

    if (shouldIncludeCustoms) {
      for (const type of this._customTemplates.keys()) {
        if (!BUILTIN_IC_TEMPLATES[type] && type !== 'sr_flip_flop@logic.ly') {
          customTypesToSerialize.add(type);
        }
      }
    }

    // Include custom types used by components in this document
    for (const [, circuit] of doc.circuits) {
      if (
        this._customTemplates.has(circuit.type) &&
        !BUILTIN_IC_TEMPLATES[circuit.type] &&
        circuit.type !== 'sr_flip_flop@logic.ly'
      ) {
        customTypesToSerialize.add(circuit.type);
      }
    }

    if (options?.customTemplates) {
      const explicitTemplates =
        options.customTemplates instanceof Map
          ? options.customTemplates.keys()
          : Object.keys(options.customTemplates);
      for (const t of explicitTemplates) {
        customTypesToSerialize.add(t);
      }
    }

    if (customTypesToSerialize.size > 0) {
      root.logicly.custom = [];
      const customParser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        isArray: (name) => ['custom', 'object', 'connection', 'location', 'point'].includes(name)
      });

      for (const type of customTypesToSerialize) {
        const tmplXml =
          (options?.customTemplates instanceof Map
            ? options.customTemplates.get(type)
            : (options?.customTemplates as any)?.[type]) ||
          this._customTemplates.get(type);

        if (!tmplXml) continue;

        const parsedTmpl = customParser.parse(tmplXml);
        const innerRoot = parsedTmpl.logicly || parsedTmpl.circuit || parsedTmpl.custom || parsedTmpl;
        const meta = this._customMetadata.get(type);

        const customObj: any = {
          '@_type': type,
          '@_name': meta?.name || type,
          object: innerRoot.object || [],
          connection: innerRoot.connection || [],
          location: innerRoot.location || []
        };

        if (meta?.label) {
          customObj['@_label'] = meta.label;
        }

        root.logicly.custom.push(customObj);
      }
    }

    root.logicly.object = [];
    root.logicly.connection = [];
    root.logicly.location = [];

    // 1. Serialize objects
    for (const [uid, circuit] of doc.circuits) {
      const meta = doc.metadata.get(uid) || { x: 0, y: 0, rotation: 0 };
      const objNode: any = {
        '@_type': circuit.type,
        '@_uid': uid,
        '@_x': meta.x,
        '@_y': meta.y,
        '@_rotation': meta.rotation
      };

      if (circuit.exportName) objNode['@_exportName'] = circuit.exportName;

      const isMultiInputGate =
        circuit.type === 'and@logic.ly' ||
        circuit.type === 'or@logic.ly' ||
        circuit.type === 'nand@logic.ly' ||
        circuit.type === 'nor@logic.ly' ||
        circuit.type === 'xor@logic.ly' ||
        circuit.type === 'xnor@logic.ly';

      if (isMultiInputGate) {
        const count = (circuit as any).inputsCount ?? 2;
        if (count !== 2) {
          objNode['@_inputs'] = count;
        }
      } else if (circuit.type === 'bus@logic.ly' || circuit instanceof BusCircuit) {
        const count = (circuit as any).inputsCount ?? 4;
        if (count !== 4) {
          objNode['@_inputs'] = count;
        }
      }

      if (circuit instanceof MultiLogicFunctionCircuit) {
        if (circuit.functionIndex !== 0) {
          objNode['@_functionIndex'] = circuit.functionIndex;
        }
      }

      if (circuit instanceof SwitchCircuit) {
        objNode['@_outputs'] = (circuit.defaultState !== undefined ? circuit.defaultState : circuit.state).toString();
      }
      if (circuit instanceof ClockCircuit) {
        objNode['@_frequency'] = circuit.frequency;
      }
      if (circuit instanceof LabelCircuit) {
        objNode['@_text'] = circuit.text;
        if (circuit.fontSize !== undefined) {
          objNode['@_fontSize'] = circuit.fontSize;
        }
        if (circuit.bold !== undefined) {
          objNode['@_bold'] = circuit.bold ? 'true' : 'false';
        }
        if (circuit.italic !== undefined) {
          objNode['@_italic'] = circuit.italic ? 'true' : 'false';
        }
        if (circuit.alignment !== undefined) {
          objNode['@_alignment'] = circuit.alignment;
        }
        if (circuit.color !== undefined && circuit.color) {
          objNode['@_color'] = circuit.color;
        }
      }

      root.logicly.object.push(objNode);
    }

    // 2. Serialize connections
    for (const conn of doc.engine.connections) {
      const connNode: any = {
        '@_outputUID': conn.outputCircuit.uid,
        '@_outputIndex': conn.outputIndex,
        '@_inputUID': conn.inputCircuit.uid,
        '@_inputIndex': conn.inputIndex
      };

      if (conn.points && conn.points.length > 0) {
        connNode['@_points'] = conn.points.map((pt) => `${pt.x},${pt.y}`).join(',');
      }

      root.logicly.connection.push(connNode);
    }

    // 3. Serialize pin locations
    for (const locKey of ['left', 'right', 'top', 'bottom'] as (keyof PinLocationMap)[]) {
      const uids = doc.locations[locKey];
      if (uids && uids.length > 0) {
        root.logicly.location.push({
          '@_id': locKey,
          '@_uids': uids.join(',')
        });
      }
    }

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      suppressBooleanAttributes: false,
      format: true,
      indentBy: '  '
    });

    return builder.build(root);
  }

  /**
   * Serializes a library of custom packages into a Logicly library XML document.
   */
  public serializeLibrary(customs?: CustomPackage[]): string {
    const list =
      customs ||
      Array.from(this._customTemplates.entries())
        .filter(([type]) => !BUILTIN_IC_TEMPLATES[type] && type !== 'sr_flip_flop@logic.ly')
        .map(([type, xml]) => {
          const meta = this._customMetadata.get(type);
          return {
            type,
            name: meta?.name || type,
            label: meta?.label,
            xml
          };
        });

    const root: any = {
      '?xml': { '@_version': '1.0', '@_encoding': 'utf-8' },
      logicly: {
        '@_xmlns': 'http://ns.logic.ly/library/1.3',
        custom: [] as any[]
      }
    };

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => ['custom', 'object', 'connection', 'location', 'point', 'waypoint'].includes(name)
    });

    for (const c of list) {
      const parsed = parser.parse(c.xml);
      const innerRoot = parsed.logicly || parsed.circuit || parsed.custom || parsed;
      const customNode: any = {
        '@_type': c.type,
        '@_name': c.name,
        object: innerRoot.object || [],
        connection: innerRoot.connection || [],
        location: innerRoot.location || []
      };
      if (c.label) {
        customNode['@_label'] = c.label;
      }
      root.logicly.custom.push(customNode);
    }

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      suppressBooleanAttributes: false,
      format: true,
      indentBy: '  '
    });

    return builder.build(root);
  }
}
